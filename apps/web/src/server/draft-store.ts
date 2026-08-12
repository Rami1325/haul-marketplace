import {
  BOOKING_DRAFT_VERSION,
  BookingDraftSchema,
  newBookingDraft,
  type BookingDraft,
} from '@haul/contracts';
import { bookingDrafts, type Database } from '@haul/db';
import { ID_PREFIX, newId, type Locale } from '@haul/types';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { BOOKING_SESSION_MAX_AGE_SECONDS } from '@/booking/session.js';

/**
 * ---------------------------------------------------------------------------
 * Reading and writing one browser's draft
 * ---------------------------------------------------------------------------
 * Everything here is keyed by a **session token hash** and takes its clock as a
 * parameter. No cookies, no `next/headers`, no `new Date()` — which is what
 * makes it testable against a real Postgres without a request around it, and
 * `drafts.ts` next door is the twelve lines that supply the request.
 *
 * Two rules run through it.
 *
 * **The blob is parsed, never read.** A jsonb column returns whatever was
 * written into it by whichever build was deployed at the time, and the shape
 * this app expects is `BookingDraftSchema` as of *this* build. Casting would
 * make every field access a lie that holds until the first customer with a
 * week-old draft.
 *
 * **A write is a read-modify-write under a row lock.** Steps post
 * independently and a customer with the flow open in two tabs is ordinary, not
 * adversarial — an unlocked read-modify-write there is a basket silently losing
 * the item added in the other tab. `select … for update` inside a transaction
 * costs one round trip and removes the whole class.
 * ---------------------------------------------------------------------------
 */

/** An open draft — never one that has become a job, and never an expired one. */
export interface OpenDraft {
  /** `drf_…`. Public: it travels in `CreateQuoteRequest.draftId`. */
  readonly id: string;
  readonly cityId: string;
  readonly locale: Locale;
  readonly draft: BookingDraft;
  readonly expiresAt: Date;
  readonly updatedAt: Date;
}

export interface DraftKey {
  /** SHA-256 hex of the token in the customer's cookie. */
  readonly sessionTokenHash: string;
  /** Which city's card this draft is priced against, when one is created. */
  readonly cityId: string;
  readonly locale: Locale;
}

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + BOOKING_SESSION_MAX_AGE_SECONDS * 1000);
}

/**
 * The one place a stored blob becomes a `BookingDraft`.
 *
 * Returns null when the document cannot be read as one — which is not a
 * hypothetical: `version` is a `z.literal`, so the day `BOOKING_DRAFT_VERSION`
 * moves to 2, every row written yesterday fails here until a migration
 * rewrites them. That is the design working. `draft.ts` says it in a sentence:
 * bump the version and write the migration.
 */
function parseDraft(document: unknown): BookingDraft | null {
  const parsed = BookingDraftSchema.safeParse(document);
  return parsed.success ? parsed.data : null;
}

function toOpenDraft(row: typeof bookingDrafts.$inferSelect, draft: BookingDraft): OpenDraft {
  return {
    id: row.id,
    cityId: row.cityId,
    locale: row.locale,
    draft,
    expiresAt: row.expiresAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * This session's draft, or null.
 *
 * **An unreadable row is deleted rather than skipped**, and that is a real
 * decision with a real cost. The alternative is worse: the partial unique index
 * allows exactly one *open* draft per session, so a row nobody can parse is a
 * browser that can never start a booking again — every attempt to create the
 * replacement collides with the corpse. Given a choice between losing an
 * unreadable in-progress form and bricking the customer's browser, this loses
 * the form, loudly, in one place, with the reason written down.
 */
export async function findOpenDraft(
  db: Database,
  sessionTokenHash: string,
  now: Date,
): Promise<OpenDraft | null> {
  const [row] = await db
    .select()
    .from(bookingDrafts)
    .where(
      and(
        eq(bookingDrafts.sessionTokenHash, sessionTokenHash),
        isNull(bookingDrafts.jobId),
        gt(bookingDrafts.expiresAt, now),
      ),
    )
    .limit(1);

  if (!row) return null;

  const draft = parseDraft(row.draft);
  if (!draft) {
    /* eslint-disable-next-line no-console -- The rule is about an app printing
       an address or a price into whatever collects stdout, and this line
       carries neither: an opaque ULID and two integers. What it records is a
       customer's in-progress booking being deleted, which is the one thing here
       that must never happen quietly — a version bump shipped without its
       migration looks exactly like nothing at all until the drafts are gone.
       Becomes a Sentry capture in WS-12; until there is one, this is the only
       place it would be visible. */
    console.error(
      `booking draft ${row.id} is unreadable at version ${BOOKING_DRAFT_VERSION} (stored ${row.version}) — discarding`,
    );
    await db.delete(bookingDrafts).where(eq(bookingDrafts.id, row.id));
    return null;
  }

  return toOpenDraft(row, draft);
}

/**
 * Postgres `unique_violation`, anywhere in the `cause` chain.
 *
 * The chain is the whole point. Drizzle wraps a driver error in a
 * `DrizzleQueryError` whose own message is the SQL it tried to run and which
 * carries no `code` at all; the `23505` is one `cause` down. Checking the
 * outermost error alone reads as "not a unique violation" for every unique
 * violation there is — so the retry below never fires, and the race it exists
 * for surfaces as a 500 on a customer's first answer.
 */
function isUniqueViolation(error: unknown): boolean {
  for (let current = error; current !== null && current !== undefined;) {
    if (typeof current === 'object' && 'code' in current && current.code === '23505') return true;
    current = current instanceof Error ? current.cause : null;
  }
  return false;
}

/**
 * Apply a change to this session's draft, creating it if this is the first one.
 *
 * `mutate` receives the stored draft — or a fresh empty one — and returns the
 * draft it wants stored. Its result is parsed on the way back in, so a mutation
 * that produces something the schema refuses fails here rather than at the next
 * read, while the code that produced it is still on the stack.
 *
 * The retry is not defensive programming. Nothing holds a lock on a row that
 * does not exist yet, so two requests arriving together for a brand-new session
 * — two tabs, or a customer double-tapping the first answer — both find
 * nothing and both insert. The partial unique index is what makes that a
 * refusal instead of two drafts, and the second attempt is the one that finds
 * the row the first one wrote.
 */
export async function saveOpenDraft(
  db: Database,
  key: DraftKey,
  now: Date,
  mutate: (draft: BookingDraft) => BookingDraft,
): Promise<OpenDraft> {
  try {
    return await attemptSave(db, key, now, mutate);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return await attemptSave(db, key, now, mutate);
  }
}

async function attemptSave(
  db: Database,
  key: DraftKey,
  now: Date,
  mutate: (draft: BookingDraft) => BookingDraft,
): Promise<OpenDraft> {
  return db.transaction(async (tx) => {
    // **Locked on exactly the predicate the unique index uses**, which is
    // `session_token_hash + job_id is null` and deliberately says nothing about
    // expiry. The read path filters `expires_at` and is right to — resurrecting
    // a draft past its retention date is the one thing that column exists to
    // prevent. Filtering it *here* is the bug: an expired, unbooked row is
    // invisible to the select and still occupies the one open slot this session
    // has, so the insert below collides with a row this query pretended not to
    // see. Both attempts fail identically and the session can never write again.
    const [locked] = await tx
      .select()
      .from(bookingDrafts)
      .where(
        and(eq(bookingDrafts.sessionTokenHash, key.sessionTokenHash), isNull(bookingDrafts.jobId)),
      )
      .limit(1)
      .for('update');

    // Expired and unreadable are the same state from here: something is in the
    // slot and none of it may be carried forward. The customer starts again.
    const usable = locked !== undefined && locked.expiresAt > now;
    const stored = usable ? parseDraft(locked.draft) : null;

    // Cleared rather than reused, so the replacement gets its own `drf_` id and
    // its own `created_at`. Inside the transaction that holds the lock, so the
    // insert below cannot lose the slot between the two statements.
    if (locked && !stored) {
      await tx.delete(bookingDrafts).where(eq(bookingDrafts.id, locked.id));
    }

    const base = stored ?? newBookingDraft(key.cityId, key.locale);
    const next = BookingDraftSchema.parse(mutate(base));
    const expiresAt = expiryFrom(now);

    if (locked && stored) {
      const [updated] = await tx
        .update(bookingDrafts)
        .set({
          draft: next,
          version: next.version,
          // The draft's own locale is authoritative — it is the one the
          // customer is reading — and the column is a copy kept queryable for
          // the sweep that has to write to them in it. The database refuses a
          // disagreement; this is where they are kept in step.
          locale: next.locale,
          expiresAt,
          updatedAt: now,
        })
        .where(eq(bookingDrafts.id, locked.id))
        .returning();
      // `locked` was selected `for update` inside this transaction, so there is
      // no interleaving that removes it before the update lands.
      return toOpenDraft(updated!, next);
    }

    const [inserted] = await tx
      .insert(bookingDrafts)
      .values({
        id: newId(ID_PREFIX.draft),
        sessionTokenHash: key.sessionTokenHash,
        cityId: key.cityId,
        locale: next.locale,
        version: next.version,
        draft: next,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return toOpenDraft(inserted!, next);
  });
}
