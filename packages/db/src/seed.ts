import {
  CATALOG,
  MANIFEST_PRESETS,
  TEL_AVIV_CITY,
  TEL_AVIV_RATE_CARD,
  VEHICLE_CLASSES,
} from '@haul/config';
import { ID_PREFIX, newId } from '@haul/types';
import { sql } from 'drizzle-orm';
import { createClient } from './client.js';
import {
  cities,
  drivers,
  driverPresence,
  featureFlags,
  rateCards,
  users,
  vehicles,
} from './schema/index.js';

/**
 * Seed for local development.
 *
 * Enough of a marketplace to exercise the whole loop: a live city, its rate
 * card, a handful of drivers spread across the launch cluster with real
 * positions, and a customer. Deterministic — reseeding gives the identical
 * dataset, so a failing test is reproducible.
 */

// Fixed pseudo-random so the seed is byte-identical every run.
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const random = seededRandom(20260809);
const idFor = (prefix: (typeof ID_PREFIX)[keyof typeof ID_PREFIX], index: number) =>
  newId(prefix, Date.UTC(2026, 7, 9) + index * 1000, random);

/** Spread a point randomly within `radiusMeters` of a centre. */
function scatter(centre: { lat: number; lng: number }, radiusMeters: number) {
  const angle = random() * 2 * Math.PI;
  const distance = Math.sqrt(random()) * radiusMeters;
  const dLat = (distance * Math.cos(angle)) / 111_320;
  const dLng = (distance * Math.sin(angle)) / (111_320 * Math.cos((centre.lat * Math.PI) / 180));
  return { lat: centre.lat + dLat, lng: centre.lng + dLng };
}

const DRIVER_NAMES: Array<[string, string]> = [
  ['אבי', 'מזרחי'],
  ['יוסי', 'כהן'],
  ['משה', 'לוי'],
  ['דוד', 'ביטון'],
  ['איתי', 'פרץ'],
  ['רון', 'אזולאי'],
  ['שרה', 'דיין'],
  ['מיכל', 'אוחיון'],
  ['עומר', 'שטרן'],
  ['נועם', 'גבאי'],
  ['אלכס', 'רוזנברג'],
  ['טל', 'חדד'],
];

const VEHICLE_MIX = [
  'van',
  'van',
  'van',
  'small_van',
  'small_van',
  'box_truck_4t',
  'box_truck_4t',
  'box_truck_4t',
  'pickup',
  'crane_truck',
  'box_truck_8t',
  'van',
] as const;

async function main() {
  const { db, sql: client } = createClient({ maxConnections: 1 });

  try {
    console.log('seeding…');

    // --- city + rate card ---------------------------------------------------
    await db
      .insert(cities)
      .values({
        id: TEL_AVIV_CITY.id,
        nameHe: TEL_AVIV_CITY.nameHe,
        nameEn: TEL_AVIV_CITY.nameEn,
        locale: 'he',
        timezone: 'Asia/Jerusalem',
        centreLatitude: TEL_AVIV_CITY.launchArea.centre.lat,
        centreLongitude: TEL_AVIV_CITY.launchArea.centre.lng,
        serviceRadiusMeters: TEL_AVIV_CITY.launchArea.radiusMeters,
        candleLightingMinutes: TEL_AVIV_CITY.calendar.candleLightingMinutes,
        nightfallMinutes: TEL_AVIV_CITY.calendar.nightfallMinutes,
        operatingStartHour: TEL_AVIV_CITY.operatingHours.startHour,
        operatingEndHour: TEL_AVIV_CITY.operatingHours.endHour,
        isLive: true,
      })
      .onConflictDoNothing();

    await db
      .insert(rateCards)
      .values({
        id: `rc_${TEL_AVIV_CITY.id}_${TEL_AVIV_RATE_CARD.version}`,
        cityId: TEL_AVIV_CITY.id,
        version: TEL_AVIV_RATE_CARD.version,
        card: TEL_AVIV_RATE_CARD,
        effectiveFrom: TEL_AVIV_RATE_CARD.effectiveFrom,
        changeNote: 'Seeded from published Israeli mover pricing; see tel-aviv.ts sources.',
      })
      .onConflictDoNothing();

    // --- a customer ---------------------------------------------------------
    const customerId = idFor(ID_PREFIX.customer, 1);
    await db
      .insert(users)
      .values({
        id: customerId,
        role: 'customer',
        phone: '+972521234567',
        phoneVerifiedAt: new Date(),
        firstName: 'רמי',
        lastName: 'בדיקה',
        locale: 'he',
      })
      .onConflictDoNothing();

    // --- drivers, spread across the launch cluster --------------------------
    let online = 0;
    for (let i = 0; i < DRIVER_NAMES.length; i++) {
      const [firstName, lastName] = DRIVER_NAMES[i]!;
      const userId = idFor(ID_PREFIX.customer, 100 + i);
      const driverId = idFor(ID_PREFIX.driver, 100 + i);
      const vehicleId = idFor(ID_PREFIX.vehicle, 100 + i);
      const classId = VEHICLE_MIX[i]!;
      const position = scatter(
        TEL_AVIV_CITY.launchArea.centre,
        TEL_AVIV_CITY.launchArea.radiusMeters,
      );

      await db
        .insert(users)
        .values({
          id: userId,
          role: 'driver',
          phone: `+9725${String(20000000 + i * 111111).slice(0, 8)}`,
          phoneVerifiedAt: new Date(),
          firstName,
          lastName,
          locale: 'he',
        })
        .onConflictDoNothing();

      await db
        .insert(drivers)
        .values({
          id: driverId,
          userId,
          cityId: TEL_AVIV_CITY.id,
          // Two still onboarding, so the eligibility filter has something to exclude.
          status: i < 10 ? 'active' : 'pending_review',
          bioHe: `נהג ותיק באזור תל אביב. ${classId === 'crane_truck' ? 'מתמחה בהובלות עם מנוף.' : ''}`,
          rating: 4.2 + random() * 0.8,
          ratingCount: 5 + Math.floor(random() * 90),
          completedJobs: Math.floor(random() * 140),
          acceptanceRate: 0.55 + random() * 0.4,
          completionRate: 0.9 + random() * 0.1,
          capabilities: classId === 'crane_truck' ? ['crane', 'piano'] : [],
          payoutAccountReady: i < 10,
          bankDetails: {
            bankCode: '12',
            branchCode: String(600 + i),
            accountNumber: String(100000 + i * 37),
            beneficiaryName: `${firstName} ${lastName}`,
            beneficiaryTaxId: '000000000',
          },
          approvedAt: i < 10 ? new Date() : null,
        })
        .onConflictDoNothing();

      await db
        .insert(vehicles)
        .values({
          id: vehicleId,
          driverId,
          classId,
          plateNumber: `${10 + i}-345-${60 + i}`,
          make: classId.includes('truck') ? 'Isuzu' : 'Ford',
          model: classId.includes('truck') ? 'NPR' : 'Transit',
          year: 2018 + (i % 6),
          colour: 'לבן',
          hasCrane: classId === 'crane_truck',
          hasTrolley: random() > 0.4,
        })
        .onConflictDoNothing();

      // Eight of the ten active drivers online, one of those busy — so the
      // eligible-pool filter has every case to exercise.
      if (i < 8) {
        online++;
        await db
          .insert(driverPresence)
          .values({
            driverId,
            cityId: TEL_AVIV_CITY.id,
            isOnline: true,
            isBusy: i === 7,
            latitude: position.lat,
            longitude: position.lng,
            accuracyMeters: 5 + random() * 15,
            activeVehicleId: vehicleId,
            activeVehicleClass: classId,
            wentOnlineAt: new Date(Date.now() - Math.floor(random() * 240) * 60_000),
            lastOfferAt:
              random() > 0.5 ? new Date(Date.now() - Math.floor(random() * 90) * 60_000) : null,
          })
          .onConflictDoNothing();
      }
    }

    await db
      .insert(featureFlags)
      .values([
        {
          key: 'scan_my_stuff',
          description: 'Vision manifest from photos (Phase 2)',
          isEnabled: false,
        },
        {
          key: 'choose_your_crew',
          description: 'Pick from three nearby movers (Phase 2)',
          isEnabled: false,
        },
        { key: 'protection_tiers', description: 'Paid damage cover at booking', isEnabled: true },
      ])
      .onConflictDoNothing();

    const counts = await db.execute<{ table: string; n: number }>(sql`
      select 'cities' as table, count(*)::int as n from cities
      union all select 'users', count(*)::int from users
      union all select 'drivers', count(*)::int from drivers
      union all select 'vehicles', count(*)::int from vehicles
      union all select 'driver_presence', count(*)::int from driver_presence
      union all select 'rate_cards', count(*)::int from rate_cards
      order by 1
    `);

    console.log('\nseeded:');
    for (const row of counts as unknown as Array<{ table: string; n: number }>) {
      console.log(`  ${row.table.padEnd(18)} ${row.n}`);
    }
    console.log(
      `\ncatalog: ${CATALOG.length} items · ${MANIFEST_PRESETS.length} presets · ${VEHICLE_CLASSES.length} vehicle classes (served from @haul/config, not the DB)`,
    );
    console.log(`${online} drivers online in the launch cluster`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('seed failed:', error);
  process.exit(1);
});
