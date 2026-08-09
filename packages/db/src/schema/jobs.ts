import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import type { PriceBreakdown } from '@haul/types';
import { agorot, createdAt, id, latitude, longitude, timestamptz, updatedAt } from '../columns.js';
import { drivers, users, vehicles } from './identity.js';
import {
  adjustmentReasonEnum,
  adjustmentStatusEnum,
  craneNeedEnum,
  elevatorKindEnum,
  jobStateEnum,
  parkingSituationEnum,
  proofPhotoKindEnum,
  scheduleKindEnum,
  stopKindEnum,
  vehicleClassEnum,
} from './enums.js';

/**
 * ---------------------------------------------------------------------------
 * Jobs
 * ---------------------------------------------------------------------------
 * One state machine governs the product and this is where it lives.
 *
 * A note on what is relational and what is JSONB. The quote breakdown is an
 * immutable snapshot read only as a whole, so it is JSONB — normalising it
 * would buy nothing and cost a join on every read. Manifest lines are the
 * opposite: they are ticked off item by item during the job and drive the
 * customer's live checklist, so they are rows.
 * ---------------------------------------------------------------------------
 */

export const jobs = pgTable(
  'jobs',
  {
    id: id().primaryKey(),
    /** "HL-4821" — what a customer reads out on the phone. A UUID is unusable aloud. */
    reference: varchar('reference', { length: 20 }).notNull(),

    state: jobStateEnum('state').notNull().default('quoted'),
    cityId: id('city_id').notNull(),

    customerId: id('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    driverId: id('driver_id').references(() => drivers.id, { onDelete: 'set null' }),
    vehicleId: id('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),

    vehicleClassId: vehicleClassEnum('vehicle_class_id').notNull(),
    /** Total people working, driver included. */
    crewSize: smallint('crew_size').notNull(),

    scheduleKind: scheduleKindEnum('schedule_kind').notNull(),
    windowStart: timestamptz('window_start').notNull(),
    windowEnd: timestamptz('window_end').notNull(),

    /** Handover confirmation. */
    completionPin: varchar('completion_pin', { length: 12 }),
    signatureUrl: varchar('signature_url', { length: 500 }),

    tipAmount: agorot('tip_amount')
      .notNull()
      .default(0 as never),

    cancelledBy: varchar('cancelled_by', { length: 20 }),
    cancelledAt: timestamptz('cancelled_at'),
    cancellationReasonCode: varchar('cancellation_reason_code', { length: 64 }),
    cancellationReasonText: text('cancellation_reason_text'),
    /** Decides whether a fee applies and whether the driver is compensated. */
    cancelledAfterDriverCommitted: boolean('cancelled_after_driver_committed'),

    // --- timeline. One column per state entered. -----------------------------
    createdAt: createdAt(),
    bookedAt: timestamptz('booked_at'),
    dispatchOpenedAt: timestamptz('dispatch_opened_at'),
    matchedAt: timestamptz('matched_at'),
    enRouteAt: timestamptz('en_route_at'),
    arrivedPickupAt: timestamptz('arrived_pickup_at'),
    loadedAt: timestamptz('loaded_at'),
    arrivedDropoffAt: timestamptz('arrived_dropoff_at'),
    completedAt: timestamptz('completed_at'),
    settledAt: timestamptz('settled_at'),
    updatedAt: updatedAt(),

    /**
     * Estimated vs actual. The single most valuable pair of columns here.
     *
     * Logged from job #1, including through the manual pilot. After a couple of
     * thousand rows this is what turns the hand-tuned formula into a learned
     * model — and it is the one thing nobody else can copy by looking at
     * the app.
     */
    estimatedWorkingMinutes: integer('estimated_working_minutes').notNull(),
    actualWorkingMinutes: integer('actual_working_minutes'),

    /** Routed, never straight-line. */
    routedDistanceMeters: integer('routed_distance_meters').notNull(),

    /** Set when ops touched the job. A high rate here means dispatch is failing. */
    opsInterventionCount: smallint('ops_intervention_count').notNull().default(0),
  },
  (table) => [
    uniqueIndex('jobs_reference_key').on(table.reference),
    // The ops live board: active jobs in a city, most recent first.
    index('jobs_city_state_idx').on(table.cityId, table.state, table.createdAt),
    index('jobs_customer_idx').on(table.customerId, table.createdAt),
    index('jobs_driver_idx').on(table.driverId, table.createdAt),
    // The scheduler that opens dispatch at T-24h reads only scheduled jobs.
    index('jobs_scheduled_window_idx')
      .on(table.windowStart)
      .where(sql`state = 'scheduled'`),
  ],
);

export const jobStops = pgTable(
  'job_stops',
  {
    id: id().primaryKey(),
    jobId: id('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    /** 0-based. Multi-stop is first-class from day one. */
    stopIndex: smallint('stop_index').notNull(),
    kind: stopKindEnum('kind').notNull(),

    street: varchar('street', { length: 200 }).notNull(),
    houseNumber: varchar('house_number', { length: 20 }).notNull(),
    entrance: varchar('entrance', { length: 20 }),
    apartment: varchar('apartment', { length: 20 }),
    city: varchar('city', { length: 120 }).notNull(),
    postalCode: varchar('postal_code', { length: 10 }),
    latitude: latitude().notNull(),
    longitude: longitude().notNull(),
    placeId: varchar('place_id', { length: 300 }),
    formatted: varchar('formatted', { length: 500 }).notNull(),
    addressNotes: text('address_notes'),

    /** Often not the booker — a partner, a parent, a shop assistant. */
    contactName: varchar('contact_name', { length: 120 }),
    contactPhone: varchar('contact_phone', { length: 20 }),

    // --- access: the four taps that make the price honest --------------------
    floor: smallint('floor').notNull(),
    elevator: elevatorKindEnum('elevator').notNull(),
    stairFlights: smallint('stair_flights').notNull().default(0),
    carryDistanceMeters: integer('carry_distance_meters').notNull().default(0),
    parking: parkingSituationEnum('parking').notNull(),
    narrowStairwell: boolean('narrow_stairwell').notNull().default(false),
    crane: craneNeedEnum('crane').notNull().default('unknown'),
    /** Municipal street-closure permit. An ops task, not a surcharge. */
    permitRequired: boolean('permit_required').notNull().default(false),
    accessNotes: text('access_notes'),

    arrivedAt: timestamptz('arrived_at'),
    departedAt: timestamptz('departed_at'),

    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('job_stops_job_index_key').on(table.jobId, table.stopIndex),
    index('job_stops_job_idx').on(table.jobId),
  ],
);

export const jobManifestLines = pgTable(
  'job_manifest_lines',
  {
    id: id().primaryKey(),
    jobId: id('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),

    catalogItemId: varchar('catalog_item_id', { length: 64 }).notNull(),
    quantity: smallint('quantity').notNull(),
    /** Present only for the catch-all item. Every one is a gap in the catalog. */
    customLabel: varchar('custom_label', { length: 200 }),
    stopIndex: smallint('stop_index').notNull().default(0),

    /**
     * Flagged by the driver as not on the original list. Triggers a
     * customer-approved adjustment — never a silent top-up.
     */
    addedDuringJob: boolean('added_during_job').notNull().default(false),

    /** Ticked off as loaded. Drives the customer's live checklist. */
    loadedAt: timestamptz('loaded_at'),
    unloadedAt: timestamptz('unloaded_at'),

    createdAt: createdAt(),
  },
  (table) => [index('job_manifest_lines_job_idx').on(table.jobId)],
);

/**
 * Quotes are immutable. Changing a price means a new quote or an adjustment —
 * never an update in place. That immutability is what makes "the number you saw
 * is the number you pay" auditable rather than aspirational.
 */
export const quotes = pgTable(
  'quotes',
  {
    id: id().primaryKey(),
    jobId: id('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
    cityId: id('city_id').notNull(),

    /** Immutable snapshot. Read only as a whole, so JSONB rather than rows. */
    breakdown: jsonb('breakdown').$type<PriceBreakdown>().notNull(),

    lockedTotal: agorot('locked_total').notNull(),
    /** Guaranteed ₪ figure, computed on the *undiscounted* fare. */
    driverPayout: agorot('driver_payout').notNull(),
    /** Booked as marketing expense, never taken out of the driver's share. */
    promoAmountGross: agorot('promo_amount_gross')
      .notNull()
      .default(0 as never),

    issuedAt: timestamptz('issued_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),

    estimatedWorkingMinutes: integer('estimated_working_minutes').notNull(),
    recommendedVehicleClass: vehicleClassEnum('recommended_vehicle_class').notNull(),
    crewSize: smallint('crew_size').notNull(),
    routedDistanceMeters: integer('routed_distance_meters').notNull(),

    /**
     * Provenance. Engine version, rate-card version and a stable hash of every
     * input. When a customer asks in three months why they were charged what
     * they were, this is the answer — a lookup, not an argument.
     */
    engineVersion: varchar('engine_version', { length: 32 }).notNull(),
    rateCardVersion: varchar('rate_card_version', { length: 32 }).notNull(),
    inputHash: varchar('input_hash', { length: 128 }).notNull(),
    /** The full pricing input, retained so any quote can be replayed exactly. */
    pricingInput: jsonb('pricing_input').notNull(),

    reviewedBy: id('reviewed_by'),
    reviewedAt: timestamptz('reviewed_at'),

    createdAt: createdAt(),
  },
  (table) => [
    index('quotes_job_idx').on(table.jobId),
    index('quotes_hash_idx').on(table.inputHash),
    // Adjustments-as-share-of-revenue is a headline metric; grouping quotes by
    // rate-card version is how a retune gets evaluated.
    index('quotes_ratecard_idx').on(table.rateCardVersion, table.issuedAt),
  ],
);

/**
 * The only four things that may change a locked price. Each one is a separate
 * customer-approved authorization, never a top-up of the original hold.
 */
export const adjustments = pgTable(
  'adjustments',
  {
    id: id().primaryKey(),
    jobId: id('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),

    reason: adjustmentReasonEnum('reason').notNull(),
    status: adjustmentStatusEnum('status').notNull().default('proposed'),

    lines: jsonb('lines').notNull(),
    /** Gross delta including VAT — what the customer is asked to approve. */
    deltaGross: agorot('delta_gross').notNull(),

    /** Evidence. A photo of the three extra boxes ends the argument early. */
    photoUrls: jsonb('photo_urls').$type<string[]>().notNull().default([]),
    noteHe: text('note_he'),

    proposedBy: varchar('proposed_by', { length: 20 }).notNull(),
    proposedAt: timestamptz('proposed_at').notNull().defaultNow(),
    respondedAt: timestamptz('responded_at'),

    /** Separate authorization for this delta. Never a top-up of the original. */
    paymentAuthorizationId: varchar('payment_authorization_id', { length: 120 }),

    createdAt: createdAt(),
  },
  (table) => [
    index('adjustments_job_idx').on(table.jobId),
    // Capture is blocked while any adjustment is unapproved, so this is read on
    // the completion path of every job that has one.
    index('adjustments_pending_idx')
      .on(table.jobId)
      .where(sql`status = 'proposed'`),
  ],
);

/**
 * Proof of condition. Timestamped and geotagged at capture, not at upload —
 * the gap between those two is exactly where a disputed photo lives.
 */
export const proofPhotos = pgTable(
  'proof_photos',
  {
    id: id().primaryKey(),
    jobId: id('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    kind: proofPhotoKindEnum('kind').notNull(),
    url: varchar('url', { length: 500 }).notNull(),

    /** Device capture time, not server receipt time. */
    capturedAt: timestamptz('captured_at').notNull(),
    capturedLatitude: latitude('captured_latitude'),
    capturedLongitude: longitude('captured_longitude'),
    uploadedAt: timestamptz('uploaded_at').notNull().defaultNow(),
    /** Hash of the original bytes — makes later tampering detectable. */
    contentHash: varchar('content_hash', { length: 128 }),

    stopIndex: smallint('stop_index').notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [index('proof_photos_job_kind_idx').on(table.jobId, table.kind)],
);

export const ratings = pgTable(
  'ratings',
  {
    id: id().primaryKey(),
    jobId: id('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    /** Who is being rated. */
    subject: varchar('subject', { length: 20 }).notNull(),
    stars: smallint('stars').notNull(),
    comment: text('comment'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('ratings_job_subject_key').on(table.jobId, table.subject)],
);

/**
 * GPS trail, tied to a job rather than to a driver.
 *
 * Deliberately separate from live presence. Presence is one small hot row per
 * driver that dispatch queries constantly; this is append-only history that
 * exists for disputes, ETA analytics and the share-trip link. Mixing them would
 * put a high-write time series in the middle of the matching path.
 */
export const jobLocationTrail = pgTable(
  'job_location_trail',
  {
    id: id().primaryKey(),
    jobId: id('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    driverId: id('driver_id').notNull(),
    latitude: latitude().notNull(),
    longitude: longitude().notNull(),
    accuracyMeters: real('accuracy_meters'),
    speedKph: real('speed_kph'),
    recordedAt: timestamptz('recorded_at').notNull(),
  },
  (table) => [index('job_location_trail_job_time_idx').on(table.jobId, table.recordedAt)],
);

// --- relations --------------------------------------------------------------

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  customer: one(users, { fields: [jobs.customerId], references: [users.id] }),
  driver: one(drivers, { fields: [jobs.driverId], references: [drivers.id] }),
  vehicle: one(vehicles, { fields: [jobs.vehicleId], references: [vehicles.id] }),
  stops: many(jobStops),
  manifestLines: many(jobManifestLines),
  quotes: many(quotes),
  adjustments: many(adjustments),
  proofPhotos: many(proofPhotos),
  ratings: many(ratings),
}));

export const jobStopsRelations = relations(jobStops, ({ one }) => ({
  job: one(jobs, { fields: [jobStops.jobId], references: [jobs.id] }),
}));

export const jobManifestLinesRelations = relations(jobManifestLines, ({ one }) => ({
  job: one(jobs, { fields: [jobManifestLines.jobId], references: [jobs.id] }),
}));

export const quotesRelations = relations(quotes, ({ one }) => ({
  job: one(jobs, { fields: [quotes.jobId], references: [jobs.id] }),
}));

export const adjustmentsRelations = relations(adjustments, ({ one }) => ({
  job: one(jobs, { fields: [adjustments.jobId], references: [jobs.id] }),
}));
