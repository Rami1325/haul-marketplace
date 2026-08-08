import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { agorot, createdAt, id, latitude, longitude, timestamptz, updatedAt } from '../columns.js';
import { drivers, vehicles } from './identity.js';
import { jobs } from './jobs.js';
import { offerStatusEnum, vehicleClassEnum } from './enums.js';

/**
 * ---------------------------------------------------------------------------
 * Dispatch
 * ---------------------------------------------------------------------------
 * Live state lives in Redis — who is online, where they are, which offers are
 * counting down. These tables are the durable mirror of it.
 *
 * Both are needed. Redis alone loses every outstanding offer on a restart,
 * which mid-evening means a dozen customers watching a matching screen that
 * will never resolve. Postgres alone cannot take a location write every five
 * seconds per driver on the matching path.
 * ---------------------------------------------------------------------------
 */

/**
 * One row per driver, updated in place. Small and hot.
 *
 * This is the table `ST_DWithin` runs against, so it must stay small: online
 * drivers only, one row each, with a GiST index on the generated geography
 * column. The append-only history lives in `job_location_trail`.
 */
export const driverPresence = pgTable(
  'driver_presence',
  {
    driverId: id('driver_id')
      .primaryKey()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    cityId: id('city_id').notNull(),

    isOnline: boolean('is_online').notNull().default(false),
    /** True while on a job — excluded from the eligible pool. */
    isBusy: boolean('is_busy').notNull().default(false),
    currentJobId: id('current_job_id'),

    latitude: latitude().notNull(),
    longitude: longitude().notNull(),
    accuracyMeters: real('accuracy_meters'),
    headingDegrees: real('heading_degrees'),

    /** Which truck they are in right now — capacity gates the eligible pool. */
    activeVehicleId: id('active_vehicle_id').references(() => vehicles.id, {
      onDelete: 'set null',
    }),
    activeVehicleClass: vehicleClassEnum('active_vehicle_class'),

    /**
     * Fairness input. Idle time is what keeps the marketplace from letting the
     * top three drivers take everything, so it is a first-class scoring column
     * rather than something derived at query time.
     */
    lastOfferAt: timestamptz('last_offer_at'),
    lastJobCompletedAt: timestamptz('last_job_completed_at'),
    wentOnlineAt: timestamptz('went_online_at'),

    updatedAt: updatedAt(),
  },
  (table) => [
    // Partial index: the dispatch query only ever looks at drivers who are
    // online and free, which on a normal evening is a fraction of the table.
    index('driver_presence_available_idx')
      .on(table.cityId, table.updatedAt)
      .where(sql`is_online = true and is_busy = false`),
  ],
);

/**
 * Offers. Score, then widen — three waves, then a human.
 *
 * Persisted rather than kept only in Redis because acceptance rate feeds driver
 * scoring and payouts, and because an offer that vanished in a restart is a
 * dispute nobody can settle.
 */
export const offers = pgTable(
  'offers',
  {
    id: id().primaryKey(),
    jobId: id('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    driverId: id('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),

    /** 1 → 2 → 3, widening each time. */
    wave: smallint('wave').notNull(),
    status: offerStatusEnum('status').notNull().default('pending'),

    /** Shown as a number, never as a percentage. */
    payout: agorot('payout').notNull(),
    /** Extra offered in wave 3 to clear a job nobody took. Shown as a win. */
    payoutBoost: agorot('payout_boost').notNull().default(0 as never),

    distanceToPickupMeters: integer('distance_to_pickup_meters').notNull(),
    etaToPickupSeconds: integer('eta_to_pickup_seconds').notNull(),

    /** The score that put this driver in this wave. Kept so ranking is auditable. */
    score: real('score'),
    scoreBreakdown: jsonb('score_breakdown'),

    offeredAt: timestamptz('offered_at').notNull().defaultNow(),
    /** 25s on-demand; scheduled jobs use hour-long windows on the same machinery. */
    expiresAt: timestamptz('expires_at').notNull(),
    respondedAt: timestamptz('responded_at'),
    declineReason: varchar('decline_reason', { length: 120 }),

    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('offers_job_driver_wave_key').on(table.jobId, table.driverId, table.wave),
    index('offers_driver_idx').on(table.driverId, table.offeredAt),
    // The timer sweep looks only at live offers.
    index('offers_live_idx')
      .on(table.expiresAt)
      .where(sql`status = 'pending'`),
  ],
);

/**
 * One row per wave fired. Exists so a failed match can be explained.
 *
 * "Why did nobody take this job?" is the most important question in the first
 * six months, and it is unanswerable without knowing who was offered it, how
 * wide the search went, and what the pool looked like at the time.
 */
export const dispatchWaves = pgTable(
  'dispatch_waves',
  {
    id: id().primaryKey(),
    jobId: id('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    wave: smallint('wave').notNull(),

    radiusMeters: integer('radius_meters').notNull(),
    /** Drivers that passed capacity, equipment, rating and availability. */
    eligiblePoolSize: integer('eligible_pool_size').notNull(),
    offersSent: integer('offers_sent').notNull(),

    startedAt: timestamptz('started_at').notNull().defaultNow(),
    endedAt: timestamptz('ended_at'),
    /** Set when this wave produced the accept. */
    succeeded: boolean('succeeded').notNull().default(false),

    /** Escalated to a human dispatcher — logged as a failure to fix, not a feature. */
    escalatedToOps: boolean('escalated_to_ops').notNull().default(false),

    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('dispatch_waves_job_wave_key').on(table.jobId, table.wave)],
);

export const offersRelations = relations(offers, ({ one }) => ({
  job: one(jobs, { fields: [offers.jobId], references: [jobs.id] }),
  driver: one(drivers, { fields: [offers.driverId], references: [drivers.id] }),
}));

export const driverPresenceRelations = relations(driverPresence, ({ one }) => ({
  driver: one(drivers, { fields: [driverPresence.driverId], references: [drivers.id] }),
}));

export const dispatchWavesRelations = relations(dispatchWaves, ({ one }) => ({
  job: one(jobs, { fields: [dispatchWaves.jobId], references: [jobs.id] }),
}));
