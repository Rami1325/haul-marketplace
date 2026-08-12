import { relations, sql } from 'drizzle-orm';
import { index, jsonb, pgTable, smallint, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import type { BookingDraft } from '@haul/contracts';
import { createdAt, id, timestamptz, updatedAt } from '../columns.js';
import { users } from './identity.js';
import { jobs } from './jobs.js';
import { localeEnum } from './enums.js';

/**
 * ---------------------------------------------------------------------------
 * Booking drafts — a form in progress, held server-side
 * ---------------------------------------------------------------------------
 * A row per booking someone has started, keyed by an httpOnly cookie. Not
 * `localStorage`, and the reason is the abandonment sweep: the thing that
 * notices a half-finished booking and does something about it has to run on a
 * server, and a browser that closed in a lift with no signal is precisely the
 * case it exists for. A draft only the customer's device can see is invisible
 * to the one process that cares.
 *
 * **The cookie holds a secret; this table holds its hash.** The two are
 * deliberately different values:
 *
 *   - `id` is a `drf_` ULID and is **not** secret. It travels in request bodies
 *     — `CreateQuoteRequest.draftId`, `BookJobRequest.draftId` — because the
 *     server has to be told which draft is being talked about, and anything a
 *     client sends is something a client can read.
 *   - `session_token_hash` is SHA-256 of 256 bits of CSPRNG the browser holds
 *     and nothing else ever sees. It is what *authorises* a request to touch a
 *     draft, and the id above is checked against the row it finds rather than
 *     used to find one.
 *
 * A single value doing both jobs would make every draft id a bearer token, and
 * `@haul/types`' `ulid()` draws its 80 random bits from `Math.random` — fine
 * for an identifier, useless as a credential, and a stranger's home address and
 * moving date sit behind it. Storing the hash rather than the token is the same
 * argument one layer down: a database dump, a log line or a backup then carries
 * nothing that can be replayed as a live session.
 *
 * **The draft is one jsonb document, not thirty columns.** It is written whole
 * on every step, read whole on every step, and never queried by field — and its
 * shape is `BookingDraftSchema`, which is versioned precisely because it will
 * move. Normalising it would put that schema in two places and make each new
 * question on the form a migration.
 * ---------------------------------------------------------------------------
 */

export const bookingDrafts = pgTable(
  'booking_drafts',
  {
    id: id().primaryKey(),

    /**
     * SHA-256, hex, of the token in the customer's cookie. 64 characters,
     * fixed — the length is part of the check that this is a hash and not
     * something's idea of a shortcut.
     */
    sessionTokenHash: varchar('session_token_hash', { length: 64 }).notNull(),

    /**
     * Null until the customer identifies themselves.
     *
     * Phone OTP is WS-11 and lands at step 08, so every draft before that point
     * belongs to a browser rather than to a person. `cascade` because a draft
     * is disposable and carries home addresses: deleting the account has to
     * take them with it, and `restrict` — which `jobs.customer_id` correctly
     * uses, since a completed job is an accounting record — would leave the
     * deletion blocked by a form somebody abandoned.
     */
    customerId: id('customer_id').references(() => users.id, { onDelete: 'cascade' }),

    /** Which city's rate card and calendar this is being priced against. */
    cityId: id('city_id').notNull(),
    /** The language it is being booked in. Drives the copy on the way back. */
    locale: localeEnum('locale').notNull().default('he'),

    /**
     * `BOOKING_DRAFT_VERSION` of the blob beside it, as a column.
     *
     * Duplicated out of the document on purpose: a migration has to be able to
     * *find* the old rows, and `where version = 1` is an index-friendly answer
     * where `where draft->>'version' = '1'` is a scan of every draft ever
     * written. The two are kept honest by a CHECK constraint in
     * `sql/001_postgis_and_constraints.sql` rather than by remembering.
     */
    version: smallint('version').notNull(),

    /** `BookingDraftSchema`. Parsed on the way out, never trusted as read. */
    draft: jsonb('draft').$type<BookingDraft>().notNull(),

    /**
     * Set when this draft became a job. The funnel's denominator meets its
     * numerator here — plan §11 wants quote → book above 35% — and it is also
     * what stops a booked draft from being resumed as a form.
     */
    jobId: id('job_id').references(() => jobs.id, { onDelete: 'set null' }),

    /**
     * When this stops being readable, whatever the cookie says.
     *
     * A draft is a list of the customer's home address, the address they are
     * moving to, the day the flat will be empty and roughly what is in it —
     * which is a burglary plan filed under "abandoned cart". The retention
     * policy is WS-11's to set; the column is here from the first row because
     * adding it later means a table with rows that predate any expiry at all.
     */
    expiresAt: timestamptz('expires_at').notNull(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /**
     * One *open* draft per browser session.
     *
     * Partial, and the predicate is the point. Unconditional uniqueness would
     * mean a customer who has just booked cannot start a second move without
     * clearing their cookies, which is the most engaged customer we have. A
     * converted draft keeps its hash for the funnel and stops competing for it.
     */
    uniqueIndex('booking_drafts_session_key')
      .on(table.sessionTokenHash)
      .where(sql`job_id is null`),
    index('booking_drafts_customer_idx').on(table.customerId, table.createdAt),
    /**
     * The two sweeps that read this table, and neither wants the booked rows:
     * abandonment reads `updated_at` to find the ones that went quiet, and the
     * reaper reads `expires_at` to delete them. Partial keeps the index the
     * size of the open drafts rather than of every booking ever started.
     */
    index('booking_drafts_open_idx')
      .on(table.updatedAt)
      .where(sql`job_id is null`),
    index('booking_drafts_expiry_idx')
      .on(table.expiresAt)
      .where(sql`job_id is null`),
  ],
);

export const bookingDraftsRelations = relations(bookingDrafts, ({ one }) => ({
  customer: one(users, { fields: [bookingDrafts.customerId], references: [users.id] }),
  job: one(jobs, { fields: [bookingDrafts.jobId], references: [jobs.id] }),
}));
