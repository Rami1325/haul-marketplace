import { BOOKING_DRAFT_VERSION, newBookingDraft } from '@haul/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Database } from '../client.js';

/**
 * ---------------------------------------------------------------------------
 * What the database refuses to hold about a booking draft
 * ---------------------------------------------------------------------------
 * The draft store in `apps/web` writes these rows correctly. These tests are
 * about what happens when something else writes them — a backfill, an ops
 * console session, the dispatch service, a future non-TypeScript surface — and
 * about the invariants that are cheap here and unenforceable anywhere else.
 *
 * The `version` column is the clearest case. It is a copy of a field inside the
 * jsonb document beside it, kept as a column so a migration can find old rows
 * by index instead of scanning every draft ever written. A copy free to
 * disagree with its original is worse than no copy: the migration rewrites the
 * rows whose column says 1 and leaves the ones whose document says 1, and those
 * are not the same set.
 * ---------------------------------------------------------------------------
 */

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://haul:haul_dev@localhost:5432/haul';

let db: Database;
let close: () => Promise<void>;
let available = false;

beforeAll(async () => {
  try {
    const client = createClient({ connectionString: DATABASE_URL, maxConnections: 2 });
    db = client.db;
    close = () => client.sql.end();
    await db.execute(sql`select 1`);
    available = true;
  } catch {
    available = false;
  }
});

/**
 * In foreign-key order, and that order is the test this cleanup keeps failing.
 *
 * `jobs.customer_id` is `restrict` — correct, because a completed job is an
 * accounting record and must not vanish with the account. So deleting the test
 * users first fails while a test job still points at one, the `afterEach`
 * throws, and every later test in the file fails for a reason that has nothing
 * to do with it. Drafts, then jobs, then users.
 */
afterEach(async () => {
  if (!available) return;
  await db.execute(sql`delete from booking_drafts where id like 'test_%'`);
  await db.execute(sql`delete from jobs where id like 'test_%'`);
  await db.execute(sql`delete from users where id like 'test_%'`);
});

afterAll(async () => {
  if (available) await close();
});

/** 64 hex characters, shaped like a real SHA-256 and distinct per test. */
const hash = (seed: string) => seed.padEnd(64, '0').slice(0, 64);

/**
 * Every message in a rejection's `cause` chain, joined.
 *
 * Drizzle wraps a driver error in a `DrizzleQueryError` whose own message is
 * the SQL it tried to run; the constraint name — the only part of this worth
 * asserting, because it says *which* rule refused — is one `cause` down.
 * `rejects.toThrow(/name/)` reads the outermost message alone and therefore
 * passes only when the failure happens to be the one that was not wrapped.
 */
async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return '<the database accepted it>';
  } catch (error) {
    const messages: string[] = [];
    for (let current: unknown = error; current instanceof Error; current = current.cause) {
      messages.push(current.message);
    }
    return messages.join(' | ');
  }
}

/**
 * Phone numbers on a prefix nothing else in this repo writes.
 *
 * `users_phone_key` is unique and vitest runs test files in parallel:
 * `dispatch-query.test.ts` bulk-inserts drivers as `'+9725' || lpad(g, 8, '0')`
 * and the seed writes `+97252…`, so the obvious `+972500000001` is a row
 * another suite is inserting at the same moment. The failure lands here, in a
 * file that did nothing wrong, and only when the suites happen to overlap.
 */
const TEST_PHONE = { owner: '+972539990001', booker: '+972539990002' } as const;

const DOCUMENT = newBookingDraft('tel-aviv');

async function insertDraft(overrides: {
  id: string;
  sessionTokenHash?: string;
  version?: number;
  locale?: string;
  document?: unknown;
  jobId?: string | null;
  customerId?: string | null;
}) {
  const document = overrides.document ?? DOCUMENT;
  await db.execute(sql`
    insert into booking_drafts
      (id, session_token_hash, customer_id, city_id, locale, version, draft, job_id, expires_at)
    values (
      ${overrides.id},
      ${overrides.sessionTokenHash ?? hash('a')},
      ${overrides.customerId ?? null},
      'tel-aviv',
      ${sql.raw(`'${overrides.locale ?? 'he'}'`)}::locale,
      ${overrides.version ?? BOOKING_DRAFT_VERSION},
      ${JSON.stringify(document)}::jsonb,
      ${overrides.jobId ?? null},
      now() + interval '30 days'
    )
  `);
}

describe.runIf(process.env['SKIP_DB'] !== '1')('booking_drafts', () => {
  it('accepts a draft the application would actually write', async () => {
    if (!available) return;
    await insertDraft({ id: 'test_ok' });

    const rows = (await db.execute(sql`
      select version, draft -> 'version' as document_version
      from booking_drafts where id = 'test_ok'
    `)) as unknown as Array<{ version: number; document_version: number }>;

    expect(rows[0]?.version).toBe(BOOKING_DRAFT_VERSION);
    expect(rows[0]?.document_version).toBe(BOOKING_DRAFT_VERSION);
  });

  it('refuses a version column that disagrees with the document', async () => {
    if (!available) return;
    await expect(
      rejection(insertDraft({ id: 'test_version', version: BOOKING_DRAFT_VERSION + 1 })),
    ).resolves.toMatch(/booking_drafts_version_matches_document/);
  });

  it('refuses a locale column that disagrees with the document', async () => {
    if (!available) return;
    // A customer who switches language mid-flow moves both or neither. The
    // column exists so the abandonment sweep can find the drafts it has to
    // write to in Hebrew without parsing every document.
    await expect(rejection(insertDraft({ id: 'test_locale', locale: 'en' }))).resolves.toMatch(
      /booking_drafts_locale_matches_document/,
    );
  });

  it('refuses a draft that is not a JSON object', async () => {
    if (!available) return;
    // `jsonb` accepts a bare string, a number and `null` as valid JSON values,
    // and each would read as "a draft" for exactly as long as it takes
    // something to read a field off it.
    for (const document of ['"a string"', '42', 'null', '[]']) {
      await expect(
        rejection(
          db.execute(sql`
            insert into booking_drafts
              (id, session_token_hash, city_id, locale, version, draft, expires_at)
            values ('test_shape', ${hash('b')}, 'tel-aviv', 'he', 1,
                    ${document}::jsonb, now() + interval '1 day')
          `),
        ),
        document,
      ).resolves.toMatch(/booking_drafts_document_is_object/);
    }
  });

  it('refuses a session hash that is not a SHA-256', async () => {
    if (!available) return;
    // The empty string is the one that matters: it is what a hashing step that
    // silently returned nothing would write, and it would then match itself on
    // every subsequent lookup.
    for (const bad of ['', 'not-a-hash', 'A'.repeat(64), '0'.repeat(63)]) {
      await expect(
        rejection(insertDraft({ id: 'test_hash', sessionTokenHash: bad })),
        bad,
      ).resolves.toMatch(/booking_drafts_session_hash_is_sha256/);
    }
  });

  it('allows one open draft per session and no more', async () => {
    if (!available) return;
    await insertDraft({ id: 'test_open_1', sessionTokenHash: hash('c') });
    await expect(
      rejection(insertDraft({ id: 'test_open_2', sessionTokenHash: hash('c') })),
    ).resolves.toMatch(/booking_drafts_session_key/);
  });

  it('lets a customer who has booked start another move on the same session', async () => {
    if (!available) return;
    // The partial predicate, and the reason it is partial. Unconditional
    // uniqueness would mean the most engaged customer we have cannot start a
    // second move without clearing their cookies.
    const jobId = await seedJob();
    await insertDraft({ id: 'test_booked', sessionTokenHash: hash('d'), jobId });
    await insertDraft({ id: 'test_next', sessionTokenHash: hash('d') });

    const rows = (await db.execute(sql`
      select count(*)::int as n from booking_drafts where session_token_hash = ${hash('d')}
    `)) as unknown as Array<{ n: number }>;
    expect(rows[0]?.n).toBe(2);
  });

  it('takes a customer’s drafts with them when the account is deleted', async () => {
    if (!available) return;
    // A draft is a home address, a destination and the day the flat is empty.
    // `restrict` — right for `jobs`, which is an accounting record — would
    // leave a deletion request blocked by a form somebody abandoned.
    await db.execute(sql`
      insert into users (id, role, phone) values ('test_user', 'customer', ${TEST_PHONE.owner})
    `);
    await insertDraft({ id: 'test_owned', sessionTokenHash: hash('e'), customerId: 'test_user' });
    await db.execute(sql`delete from users where id = 'test_user'`);

    const rows = (await db.execute(sql`
      select count(*)::int as n from booking_drafts where id = 'test_owned'
    `)) as unknown as Array<{ n: number }>;
    expect(rows[0]?.n).toBe(0);
  });
});

/**
 * A job, with the smallest set of columns `jobs` demands, so a draft can be
 * marked converted. Deleted by the test that creates it.
 */
async function seedJob(): Promise<string> {
  const id = 'test_job_conv';
  await db.execute(sql`
    insert into users (id, role, phone) values ('test_job_cust', 'customer', ${TEST_PHONE.booker})
    on conflict (id) do nothing
  `);
  await db.execute(sql`
    insert into jobs (
      id, reference, state, city_id, customer_id, vehicle_class_id, crew_size,
      schedule_kind, window_start, window_end,
      estimated_working_minutes, routed_distance_meters
    ) values (
      ${id}, 'HL-TEST', 'quoted', 'tel-aviv', 'test_job_cust', 'van', 2,
      'scheduled', now(), now() + interval '2 hours', 120, 8400
    )
  `);
  return id;
}
