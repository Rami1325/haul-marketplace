import { BOOKING_DRAFT_VERSION, newBookingDraft, type BookingDraft } from '@haul/contracts';
import { createClient, type Database } from '@haul/db';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { findOpenDraft, saveOpenDraft, type DraftKey } from '../draft-store.js';

/**
 * ---------------------------------------------------------------------------
 * The draft store, against a real Postgres
 * ---------------------------------------------------------------------------
 * Not mocked, and it cannot usefully be. Three of the things this module is for
 * only exist in a database: the row lock that stops two tabs losing each
 * other's answers, the partial unique index that turns a race into a retry, and
 * the round trip through a `jsonb` column that turns a `Date` into a string and
 * a `Map` into `{}`. A fake would agree with every one of them.
 *
 * Skips cleanly when there is no database, exactly as `@haul/db`'s own suites
 * do — `docker compose up -d` is what turns these on.
 * ---------------------------------------------------------------------------
 */

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://haul:haul_dev@localhost:5432/haul';

let db: Database;
let close: () => Promise<void>;
let available = false;

beforeAll(async () => {
  try {
    const client = createClient({ connectionString: DATABASE_URL, maxConnections: 4 });
    db = client.db;
    close = () => client.sql.end();
    await db.execute(sql`select 1`);
    available = true;
  } catch {
    available = false;
  }
});

/**
 * A distinct, well-formed session hash per test.
 *
 * Hex, and it has to be: the column carries a `^[0-9a-f]{64}$` check, so a
 * readable seed like `stale` written straight in is rejected by the database
 * before the test it belongs to gets to run. The seed is encoded rather than
 * embedded. Every hash here starts `feed…`, so the cleanup below cannot reach a
 * row this file did not write.
 */
const HASH_PREFIX = 'feed';
const hash = (seed: string) => {
  let hex = HASH_PREFIX;
  for (const character of seed) hex += character.charCodeAt(0).toString(16).padStart(2, '0');
  return hex.padEnd(64, '0').slice(0, 64);
};

afterEach(async () => {
  if (!available) return;
  await db.execute(
    sql`delete from booking_drafts where session_token_hash like ${`${HASH_PREFIX}%`}`,
  );
});

afterAll(async () => {
  if (available) await close();
});

const NOW = new Date('2026-08-12T09:00:00.000Z');

function keyFor(seed: string): DraftKey {
  return { sessionTokenHash: hash(seed), cityId: 'tel-aviv', locale: 'he' };
}

/** Put one item in the basket — the smallest real answer a step 01 makes. */
const addItem =
  (catalogItemId: string) =>
  (draft: BookingDraft): BookingDraft => ({
    ...draft,
    basket: [...draft.basket, { catalogItemId, quantity: 1, customLabel: null, stopIndex: 0 }],
  });

describe.runIf(process.env['SKIP_DB'] !== '1')('the draft store', () => {
  it('has nothing for a session that has answered nothing', async () => {
    if (!available) return;
    expect(await findOpenDraft(db, hash('empty'), NOW)).toBeNull();
  });

  it('creates the row on the first answer and reads it back unchanged', async () => {
    if (!available) return;
    const key = keyFor('create');

    const saved = await saveOpenDraft(db, key, NOW, addItem('fridge_large'));
    expect(saved.id).toMatch(/^drf_/);
    expect(saved.draft.basket).toHaveLength(1);

    const found = await findOpenDraft(db, key.sessionTokenHash, NOW);
    // Through a jsonb column and back out through the schema. The two stops
    // every draft starts with are the part a shallow equality would miss.
    expect(found?.id).toBe(saved.id);
    expect(found?.draft).toEqual(saved.draft);
    expect(found?.draft.stops).toHaveLength(2);
    expect(found?.draft.version).toBe(BOOKING_DRAFT_VERSION);
  });

  it('keeps answering into the same row rather than starting a new one', async () => {
    if (!available) return;
    const key = keyFor('same');

    const first = await saveOpenDraft(db, key, NOW, addItem('fridge_large'));
    const second = await saveOpenDraft(db, key, NOW, addItem('washing_machine'));

    expect(second.id).toBe(first.id);
    expect(second.draft.basket).toHaveLength(2);

    const rows = (await db.execute(sql`
      select count(*)::int as n from booking_drafts
      where session_token_hash = ${key.sessionTokenHash}
    `)) as unknown as Array<{ n: number }>;
    expect(rows[0]?.n).toBe(1);
  });

  it('does not lose the answer given in the other tab', async () => {
    if (!available) return;
    // The reason the write is a `select … for update` inside a transaction. Two
    // steps posting at once is ordinary rather than adversarial — a customer
    // with the flow open twice, or a slow request overtaken by the next one —
    // and an unlocked read-modify-write drops whichever landed first.
    const key = keyFor('concurrent');
    await saveOpenDraft(db, key, NOW, (draft) => draft);

    await Promise.all([
      saveOpenDraft(db, key, NOW, addItem('fridge_large')),
      saveOpenDraft(db, key, NOW, addItem('washing_machine')),
    ]);

    const found = await findOpenDraft(db, key.sessionTokenHash, NOW);
    expect(found?.draft.basket.map((line) => line.catalogItemId).sort()).toEqual([
      'fridge_large',
      'washing_machine',
    ]);
  });

  it('survives two first answers arriving together', async () => {
    if (!available) return;
    // Nothing holds a lock on a row that does not exist yet, so both requests
    // find nothing and both insert. The partial unique index makes that a
    // refusal instead of two drafts, and the retry is what turns the refusal
    // into the row the other request just wrote.
    const key = keyFor('race');

    const [a, b] = await Promise.all([
      saveOpenDraft(db, key, NOW, addItem('fridge_large')),
      saveOpenDraft(db, key, NOW, addItem('washing_machine')),
    ]);

    expect(a.id).toBe(b.id);
    const rows = (await db.execute(sql`
      select count(*)::int as n from booking_drafts
      where session_token_hash = ${key.sessionTokenHash}
    `)) as unknown as Array<{ n: number }>;
    expect(rows[0]?.n).toBe(1);
  });

  it('extends the expiry every time the customer comes back', async () => {
    if (!available) return;
    const key = keyFor('expiry');
    const first = await saveOpenDraft(db, key, NOW, addItem('fridge_large'));

    const later = new Date(NOW.getTime() + 5 * 24 * 60 * 60 * 1000);
    const second = await saveOpenDraft(db, key, later, addItem('box_medium'));

    expect(second.expiresAt.getTime()).toBeGreaterThan(first.expiresAt.getTime());
  });

  it('will not hand back a draft that has expired', async () => {
    if (!available) return;
    // The row's own `expires_at` is the authority, not the cookie's `maxAge`. A
    // cookie lifetime is a request the browser is free to ignore; the retention
    // promise has to hold on our side of the wire.
    const key = keyFor('stale');
    const saved = await saveOpenDraft(db, key, NOW, addItem('fridge_large'));

    // An ISO string with an explicit cast, not a `Date`. Drizzle's `execute`
    // hands parameters to postgres.js through `unsafe`, which serialises what
    // it is given rather than what the column is — a `Date` there fails to
    // bind at all. The tagged-template client handles it; this path does not.
    await db.execute(sql`
      update booking_drafts
      set expires_at = ${NOW.toISOString()}::timestamptz
      where id = ${saved.id}
    `);

    expect(await findOpenDraft(db, key.sessionTokenHash, NOW)).toBeNull();
  });

  it('starts again on a session whose draft expired, rather than jamming on it', async () => {
    if (!available) return;
    // The read path filters `expires_at` and the unique index does not, so an
    // expired unbooked row is invisible to a select that filters the same way
    // and still occupies the session's one open slot. A save that locked on the
    // filtered predicate would collide with a row it had just been told was not
    // there — twice, since the retry repeats the same query — and that session
    // could never write again.
    const key = keyFor('revive');
    const dead = await saveOpenDraft(db, key, NOW, addItem('fridge_large'));
    await db.execute(sql`
      update booking_drafts
      set expires_at = ${NOW.toISOString()}::timestamptz
      where id = ${dead.id}
    `);

    const fresh = await saveOpenDraft(db, key, NOW, addItem('box_medium'));

    expect(fresh.id).not.toBe(dead.id);
    // A fresh draft, not the expired one with a new item appended: past its
    // retention date the contents are exactly what must not come back.
    expect(fresh.draft.basket.map((line) => line.catalogItemId)).toEqual(['box_medium']);

    const rows = (await db.execute(sql`
      select count(*)::int as n from booking_drafts
      where session_token_hash = ${key.sessionTokenHash}
    `)) as unknown as Array<{ n: number }>;
    expect(rows[0]?.n).toBe(1);
  });

  it('discards a draft this build cannot read, rather than jamming the session', async () => {
    if (!available) return;
    // What a version bump shipped without its migration looks like from here:
    // a document whose `version` no longer parses. The row has to go, because
    // the partial unique index means a draft nobody can read is a browser that
    // can never start a booking again.
    const key = keyFor('unreadable');
    const saved = await saveOpenDraft(db, key, NOW, addItem('fridge_large'));

    const future = { ...newBookingDraft('tel-aviv'), version: BOOKING_DRAFT_VERSION + 1 };
    await db.execute(sql`
      update booking_drafts
      set draft = ${JSON.stringify(future)}::jsonb, version = ${BOOKING_DRAFT_VERSION + 1}
      where id = ${saved.id}
    `);

    expect(await findOpenDraft(db, key.sessionTokenHash, NOW)).toBeNull();

    const rows = (await db.execute(sql`
      select count(*)::int as n from booking_drafts where id = ${saved.id}
    `)) as unknown as Array<{ n: number }>;
    expect(rows[0]?.n).toBe(0);

    // And the session works again immediately, which is the whole point of
    // deleting rather than skipping.
    const fresh = await saveOpenDraft(db, key, NOW, addItem('box_medium'));
    expect(fresh.id).not.toBe(saved.id);
  });

  it('refuses to store a mutation the schema would not accept', async () => {
    if (!available) return;
    // The result of `mutate` is parsed on the way back in, so a bad answer
    // fails here — with the code that produced it still on the stack — rather
    // than at the next read, in a request that did nothing wrong.
    const key = keyFor('invalid');
    await expect(
      saveOpenDraft(db, key, NOW, (draft) => ({ ...draft, crewSize: 99 }) as BookingDraft),
    ).rejects.toThrow();

    expect(await findOpenDraft(db, key.sessionTokenHash, NOW)).toBeNull();
  });
});
