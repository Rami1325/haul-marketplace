import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Database } from '../client.js';
import { countEligibleDrivers, findNearestAvailableDrivers } from '../queries/nearest-drivers.js';

/**
 * ---------------------------------------------------------------------------
 * Dispatch query — integration
 * ---------------------------------------------------------------------------
 * Runs against a real Postgres with PostGIS. Skipped when DATABASE_URL is
 * absent so the unit suite stays runnable without Docker.
 *
 * The load-bearing test here is the EXPLAIN one. `ST_DWithin` is index-assisted
 * and `ST_Distance(...) < x` is not; the two look equivalent, return identical
 * results on a seed dataset, and diverge catastrophically at city scale. A test
 * that only checks the rows would never catch the difference — so this one
 * loads a realistic pool and asserts the planner actually reaches for the GiST
 * index.
 * ---------------------------------------------------------------------------
 */

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://haul:haul_dev@localhost:5432/haul';
const CITY = 'tel-aviv';
const TLV_CENTRE = { lat: 32.0785, lng: 34.7742 };
const BULK_PREFIX = 'bulktest';

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
    return;
  }

  await cleanupBulk();

  // A realistic pool. With eight seeded rows the planner would sequential-scan
  // whatever the query said, and the EXPLAIN assertion would prove nothing.
  await db.execute(sql`
    insert into users (id, role, phone, locale, created_at, updated_at)
    select ${BULK_PREFIX} || '_u_' || g, 'driver', '+9725' || lpad(g::text, 8, '0'), 'he', now(), now()
    from generate_series(1, 3000) g
    on conflict do nothing
  `);

  await db.execute(sql`
    insert into drivers (id, user_id, city_id, status, rating, rating_count, completed_jobs,
                         acceptance_rate, completion_rate, capabilities, payout_account_ready,
                         created_at, updated_at)
    select ${BULK_PREFIX} || '_d_' || g, ${BULK_PREFIX} || '_u_' || g, ${CITY}, 'active',
           3.5 + (g % 15) / 10.0, 20, g % 200, 0.5 + (g % 50) / 100.0, 0.9, '[]'::jsonb, true,
           now(), now()
    from generate_series(1, 3000) g
    on conflict do nothing
  `);

  // Scattered across roughly greater Tel Aviv, so most fall outside a 3km radius.
  await db.execute(sql`
    insert into driver_presence (driver_id, city_id, is_online, is_busy, latitude, longitude,
                                 active_vehicle_class, went_online_at, updated_at)
    select ${BULK_PREFIX} || '_d_' || g, ${CITY}, true, false,
           ${TLV_CENTRE.lat} + (random() - 0.5) * 0.30,
           ${TLV_CENTRE.lng} + (random() - 0.5) * 0.30,
           (array['van','small_van','box_truck_4t','pickup'])[1 + (g % 4)]::vehicle_class,
           now() - interval '1 hour', now()
    from generate_series(1, 3000) g
    on conflict do nothing
  `);

  // The planner needs statistics before it will believe the index is worth it.
  await db.execute(sql`analyze driver_presence`);
  await db.execute(sql`analyze drivers`);
}, 120_000);

afterAll(async () => {
  if (!available) return;
  await cleanupBulk();
  await close();
});

async function cleanupBulk() {
  await db.execute(sql`delete from driver_presence where driver_id like ${BULK_PREFIX + '%'}`);
  await db.execute(sql`delete from drivers where id like ${BULK_PREFIX + '%'}`);
  await db.execute(sql`delete from users where id like ${BULK_PREFIX + '%'}`);
}

describe.runIf(process.env['SKIP_DB'] !== '1')('the eligible-pool query', () => {
  it('uses the GiST index rather than scanning every online driver', async () => {
    if (!available) return;

    const plan = await db.execute<{ 'QUERY PLAN': string }>(sql`
      explain (analyze, buffers, format text)
      select p.driver_id
      from driver_presence p
      join drivers d on d.id = p.driver_id
      where p.city_id = ${CITY}
        and p.is_online = true
        and p.is_busy = false
        and st_dwithin(
          p.location,
          st_setsrid(st_makepoint(${TLV_CENTRE.lng}, ${TLV_CENTRE.lat}), 4326)::geography,
          3000
        )
    `);

    const text = (plan as unknown as Array<Record<string, string>>)
      .map((row) => Object.values(row)[0])
      .join('\n');

    // The whole point. If someone rewrites this as ST_Distance(...) < 3000,
    // the index disappears from the plan and this fails.
    expect(text, `plan was:\n${text}`).toMatch(/driver_presence_location_gix/);
    expect(text).not.toMatch(/Seq Scan on driver_presence/);
  });

  it('returns only drivers inside the radius', async () => {
    if (!available) return;

    const rows = await findNearestAvailableDrivers(db, {
      cityId: CITY,
      pickup: TLV_CENTRE,
      radiusMeters: 3_000,
      acceptableVehicleClasses: ['van', 'small_van', 'box_truck_4t', 'pickup'],
      limit: 50,
    });

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.distanceMeters, row.driverId).toBeLessThanOrEqual(3_000);
    }
  });

  it('measures distance in metres, not degrees', async () => {
    if (!available) return;

    // The geometry-vs-geography trap: on geometry, a radius of 3000 would be
    // 3000 DEGREES and would match the entire planet.
    const tight = await findNearestAvailableDrivers(db, {
      cityId: CITY,
      pickup: TLV_CENTRE,
      radiusMeters: 500,
      acceptableVehicleClasses: ['van', 'small_van', 'box_truck_4t', 'pickup'],
      limit: 200,
    });
    const wide = await findNearestAvailableDrivers(db, {
      cityId: CITY,
      pickup: TLV_CENTRE,
      radiusMeters: 8_000,
      acceptableVehicleClasses: ['van', 'small_van', 'box_truck_4t', 'pickup'],
      limit: 200,
    });

    expect(wide.length).toBeGreaterThan(tight.length);
    for (const row of tight) expect(row.distanceMeters).toBeLessThanOrEqual(500);
  });

  it('excludes busy drivers, offline drivers and unapproved accounts', async () => {
    if (!available) return;

    const rows = await findNearestAvailableDrivers(db, {
      cityId: CITY,
      pickup: TLV_CENTRE,
      radiusMeters: 20_000,
      acceptableVehicleClasses: ['van', 'small_van', 'box_truck_4t', 'pickup', 'crane_truck', 'box_truck_8t'],
      limit: 500,
    });
    const returned = new Set(rows.map((r) => r.driverId));

    const excluded = await db.execute<{ driver_id: string }>(sql`
      select p.driver_id
      from driver_presence p
      join drivers d on d.id = p.driver_id
      where p.city_id = ${CITY}
        and (p.is_busy = true or p.is_online = false or d.status <> 'active')
    `);

    for (const row of excluded as unknown as Array<{ driver_id: string }>) {
      expect(returned.has(row.driver_id), `${row.driver_id} should not be offered work`).toBe(false);
    }
  });

  it('honours the vehicle-class filter', async () => {
    if (!available) return;

    const rows = await findNearestAvailableDrivers(db, {
      cityId: CITY,
      pickup: TLV_CENTRE,
      radiusMeters: 20_000,
      acceptableVehicleClasses: ['box_truck_4t'],
      limit: 100,
    });

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.activeVehicleClass).toBe('box_truck_4t');
  });

  it('only offers crane-equipped trucks when the job needs one', async () => {
    if (!available) return;

    const rows = await findNearestAvailableDrivers(db, {
      cityId: CITY,
      pickup: TLV_CENTRE,
      radiusMeters: 20_000,
      acceptableVehicleClasses: ['crane_truck', 'box_truck_4t', 'van'],
      requiresCrane: true,
      limit: 50,
    });

    for (const row of rows) expect(row.hasCrane, row.driverId).toBe(true);
  });

  it('skips drivers whose app stopped reporting', async () => {
    if (!available) return;

    await db.execute(sql`
      update driver_presence set updated_at = now() - interval '30 minutes'
      where driver_id = ${BULK_PREFIX + '_d_1'}
    `);

    const rows = await findNearestAvailableDrivers(db, {
      cityId: CITY,
      pickup: TLV_CENTRE,
      radiusMeters: 50_000,
      acceptableVehicleClasses: ['van', 'small_van', 'box_truck_4t', 'pickup'],
      limit: 500,
      maxPresenceAgeSeconds: 120,
    });

    expect(rows.some((r) => r.driverId === `${BULK_PREFIX}_d_1`)).toBe(false);
  });

  it('excludes drivers already offered the job in an earlier wave', async () => {
    if (!available) return;

    const first = await findNearestAvailableDrivers(db, {
      cityId: CITY,
      pickup: TLV_CENTRE,
      radiusMeters: 5_000,
      acceptableVehicleClasses: ['van', 'small_van', 'box_truck_4t', 'pickup'],
      limit: 3,
    });
    expect(first.length).toBe(3);

    const second = await findNearestAvailableDrivers(db, {
      cityId: CITY,
      pickup: TLV_CENTRE,
      radiusMeters: 5_000,
      acceptableVehicleClasses: ['van', 'small_van', 'box_truck_4t', 'pickup'],
      excludeDriverIds: first.map((r) => r.driverId),
      limit: 5,
    });

    for (const row of second) {
      expect(first.some((f) => f.driverId === row.driverId)).toBe(false);
    }
  });

  it('ranks closer drivers above distant ones, all else equal', async () => {
    if (!available) return;

    const rows = await findNearestAvailableDrivers(db, {
      cityId: CITY,
      pickup: TLV_CENTRE,
      radiusMeters: 10_000,
      acceptableVehicleClasses: ['van'],
      limit: 20,
    });

    // Scores must be monotonically non-increasing — that is the ordering
    // dispatch relies on to build wave 1.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.score).toBeLessThanOrEqual(rows[i - 1]!.score + 1e-9);
    }
  });

  it('counts the eligible pool ignoring distance, so a failed match is explainable', async () => {
    if (!available) return;

    // "Was this a coverage problem or a supply problem?" is unanswerable
    // without this, and it is the first question after every no-match.
    const count = await countEligibleDrivers(db, CITY, ['van']);
    expect(count).toBeGreaterThan(0);

    const none = await countEligibleDrivers(db, 'no-such-city', ['van']);
    expect(none).toBe(0);
  });

  it('returns nothing rather than everything when no class is acceptable', async () => {
    if (!available) return;
    const rows = await findNearestAvailableDrivers(db, {
      cityId: CITY,
      pickup: TLV_CENTRE,
      radiusMeters: 10_000,
      acceptableVehicleClasses: [],
      limit: 10,
    });
    expect(rows).toEqual([]);
  });
});
