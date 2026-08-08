import { sql } from 'drizzle-orm';
import type { VehicleClassId } from '@haul/types';
import type { Database } from '../client.js';

/**
 * ---------------------------------------------------------------------------
 * The eligible pool
 * ---------------------------------------------------------------------------
 * The query the entire marketplace rests on: who can take this job, right now,
 * ranked.
 *
 * It runs on `driver_presence` — one small hot row per driver — against a
 * GENERATED `geography(Point,4326)` column with a GiST index. Two consequences
 * worth stating, because both are easy to get wrong:
 *
 *  1. `ST_DWithin` on a *geography* type takes metres and accounts for the
 *     curvature of the earth. The geometry equivalent takes degrees, which at
 *     Israeli latitudes silently makes a "5000 unit" radius about 500km.
 *  2. `ST_DWithin` is index-assisted; `ST_Distance(...) < x` is not. The second
 *     form scans every online driver. It looks equivalent and is not.
 *
 * Filtering happens before ranking so the expensive scoring only touches
 * drivers who could actually do the job.
 * ---------------------------------------------------------------------------
 */

/** Index signature so it satisfies Drizzle's raw-row constraint. */
export interface NearestDriverRow extends Record<string, unknown> {
  driverId: string;
  distanceMeters: number;
  rating: number;
  acceptanceRate: number;
  completionRate: number;
  completedJobs: number;
  activeVehicleClass: VehicleClassId | null;
  activeVehicleId: string | null;
  hasCrane: boolean;
  idleMinutes: number;
  score: number;
}

export interface NearestDriverOptions {
  cityId: string;
  pickup: { lat: number; lng: number };
  radiusMeters: number;
  /** Classes with enough capacity for this job. */
  acceptableVehicleClasses: readonly VehicleClassId[];
  /** Job needs a crane-equipped truck. */
  requiresCrane?: boolean;
  minRating?: number;
  /** Drivers already offered this job in an earlier wave. */
  excludeDriverIds?: readonly string[];
  limit: number;
  /** Presence rows older than this are treated as stale and skipped. */
  maxPresenceAgeSeconds?: number;
}

/**
 * Scoring weights.
 *
 * `idle` is the one that matters most for marketplace health. Ranking purely on
 * distance and rating lets the top three drivers in a neighbourhood take
 * everything, new drivers never get a first job, and supply churns. Weighting
 * idle time is what keeps the pool fair enough that people stay — and driver
 * 30-day retention is the single best predictor of survival.
 */
export const DEFAULT_SCORING_WEIGHTS = {
  proximity: 0.4,
  acceptance: 0.2,
  rating: 0.15,
  completion: 0.1,
  idle: 0.15,
} as const;

export type ScoringWeights = typeof DEFAULT_SCORING_WEIGHTS;

export async function findNearestAvailableDrivers(
  db: Database,
  options: NearestDriverOptions,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): Promise<NearestDriverRow[]> {
  const {
    cityId,
    pickup,
    radiusMeters,
    acceptableVehicleClasses,
    requiresCrane = false,
    minRating = 0,
    excludeDriverIds = [],
    limit,
    maxPresenceAgeSeconds = 120,
  } = options;

  if (acceptableVehicleClasses.length === 0) return [];

  const excluded = excludeDriverIds.length > 0 ? excludeDriverIds : ['__none__'];

  const rows = await db.execute<NearestDriverRow>(sql`
    with candidates as (
      select
        p.driver_id,
        p.active_vehicle_id,
        p.active_vehicle_class,
        d.rating,
        d.acceptance_rate,
        d.completion_rate,
        d.completed_jobs,
        coalesce(v.has_crane, false) as has_crane,
        -- Geography, so this is metres and not degrees.
        st_distance(
          p.location,
          st_setsrid(st_makepoint(${pickup.lng}, ${pickup.lat}), 4326)::geography
        ) as distance_meters,
        extract(epoch from (now() - coalesce(p.last_offer_at, p.went_online_at, now()))) / 60
          as idle_minutes
      from driver_presence p
      join drivers d on d.id = p.driver_id
      left join vehicles v on v.id = p.active_vehicle_id
      where
        p.city_id = ${cityId}
        and p.is_online = true
        and p.is_busy = false
        -- Index-assisted. ST_Distance(...) < x in the WHERE clause would not be.
        and st_dwithin(
          p.location,
          st_setsrid(st_makepoint(${pickup.lng}, ${pickup.lat}), 4326)::geography,
          ${radiusMeters}
        )
        -- A driver whose app died an hour ago is not actually available.
        and p.updated_at > now() - make_interval(secs => ${maxPresenceAgeSeconds})
        and d.status = 'active'
        and d.rating >= ${minRating}
        and p.active_vehicle_class = any(${sql.raw(pgTextArray(acceptableVehicleClasses))}::vehicle_class[])
        and (${requiresCrane} = false or coalesce(v.has_crane, false) = true)
        and p.driver_id <> all(${sql.raw(pgTextArray(excluded))}::varchar[])
    )
    select
      driver_id                                as "driverId",
      round(distance_meters)::int              as "distanceMeters",
      rating                                   as "rating",
      acceptance_rate                          as "acceptanceRate",
      completion_rate                          as "completionRate",
      completed_jobs                           as "completedJobs",
      active_vehicle_class                     as "activeVehicleClass",
      active_vehicle_id                        as "activeVehicleId",
      has_crane                                as "hasCrane",
      round(idle_minutes)::int                 as "idleMinutes",
      (
          ${weights.proximity} * (1 - least(distance_meters / ${radiusMeters}, 1))
        + ${weights.acceptance} * acceptance_rate
        + ${weights.rating}     * (rating / 5.0)
        + ${weights.completion} * completion_rate
        -- Idle contribution saturates after an hour: the point is to give a
        -- waiting driver a real chance, not to let someone idle all day and
        -- outrank a nearby driver on every job.
        + ${weights.idle}       * least(idle_minutes / 60.0, 1)
      )                                        as "score"
    from candidates
    order by "score" desc, distance_meters asc
    limit ${limit}
  `);

  return rows as unknown as NearestDriverRow[];
}

/**
 * Postgres array literal. The values are enum members and driver ids from our
 * own tables rather than user input, but they are still escaped — a helper that
 * is safe only for trusted callers becomes unsafe the first time someone reuses
 * it.
 */
function pgTextArray(values: readonly string[]): string {
  const escaped = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(',');
  return `array[${escaped}]`;
}

/**
 * Count of drivers who *could* take a job, ignoring distance.
 *
 * Answers the question that actually matters after a failed match: was this a
 * coverage problem or a supply problem? Without it, "no match" is unactionable.
 */
export async function countEligibleDrivers(
  db: Database,
  cityId: string,
  acceptableVehicleClasses: readonly VehicleClassId[],
): Promise<number> {
  if (acceptableVehicleClasses.length === 0) return 0;

  const rows = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
    from driver_presence p
    join drivers d on d.id = p.driver_id
    where p.city_id = ${cityId}
      and p.is_online = true
      and p.is_busy = false
      and d.status = 'active'
      and p.active_vehicle_class = any(${sql.raw(pgTextArray(acceptableVehicleClasses))}::vehicle_class[])
  `);

  return (rows as unknown as Array<{ count: number }>)[0]?.count ?? 0;
}
