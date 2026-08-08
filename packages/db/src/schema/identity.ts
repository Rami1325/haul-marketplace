import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, latitude, longitude, timestamptz, updatedAt } from '../columns.js';
import {
  documentKindEnum,
  documentStatusEnum,
  driverStatusEnum,
  localeEnum,
  userRoleEnum,
  vehicleClassEnum,
} from './enums.js';

/**
 * ---------------------------------------------------------------------------
 * Identity — customers, drivers, vehicles, documents
 * ---------------------------------------------------------------------------
 */

export const users = pgTable(
  'users',
  {
    id: id().primaryKey(),
    role: userRoleEnum('role').notNull().default('customer'),

    /** E.164, always `+972…`. The identity anchor — Israelis sign in by phone. */
    phone: varchar('phone', { length: 20 }).notNull(),
    phoneVerifiedAt: timestamptz('phone_verified_at'),

    firstName: varchar('first_name', { length: 80 }),
    lastName: varchar('last_name', { length: 80 }),
    email: varchar('email', { length: 200 }),
    locale: localeEnum('locale').notNull().default('he'),

    /**
     * A quiet risk score fed by cancellation history and address churn. Never
     * shown to the user, and never the sole reason for a block.
     */
    riskScore: real('risk_score').notNull().default(0),
    cancelledJobCount: integer('cancelled_job_count').notNull().default(0),

    blockedAt: timestamptz('blocked_at'),
    blockedReason: text('blocked_reason'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // One account per phone number. The OTP + card-on-file gate is most of the
    // fraud defence, and it only works if a number maps to one identity.
    uniqueIndex('users_phone_key').on(table.phone),
    index('users_role_idx').on(table.role),
  ],
);

export const savedAddresses = pgTable(
  'saved_addresses',
  {
    id: id().primaryKey(),
    userId: id('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    label: varchar('label', { length: 80 }),
    street: varchar('street', { length: 200 }).notNull(),
    houseNumber: varchar('house_number', { length: 20 }).notNull(),
    /** כניסה — Israeli buildings routinely have several. */
    entrance: varchar('entrance', { length: 20 }),
    apartment: varchar('apartment', { length: 20 }),
    city: varchar('city', { length: 120 }).notNull(),
    postalCode: varchar('postal_code', { length: 10 }),

    latitude: latitude().notNull(),
    longitude: longitude().notNull(),
    placeId: varchar('place_id', { length: 300 }),
    formatted: varchar('formatted', { length: 500 }).notNull(),
    notes: text('notes'),

    /** Access details remembered, so a repeat booking is thirty seconds. */
    defaultAccess: jsonb('default_access'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('saved_addresses_user_idx').on(table.userId)],
);

export const drivers = pgTable(
  'drivers',
  {
    id: id().primaryKey(),
    userId: id('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    cityId: id('city_id').notNull(),

    status: driverStatusEnum('status').notNull().default('onboarding'),

    /** Shown to customers. A real face, not a logo. */
    photoUrl: varchar('photo_url', { length: 500 }),
    /** In their own voice — the cheapest trust signal in the product. */
    bioHe: text('bio_he'),

    /** Home base, used to bias dispatch toward jobs ending near where they live. */
    homeLatitude: latitude('home_latitude'),
    homeLongitude: longitude('home_longitude'),

    // Reputation. All computed, never entered.
    rating: real('rating').notNull().default(0),
    ratingCount: integer('rating_count').notNull().default(0),
    completedJobs: integer('completed_jobs').notNull().default(0),
    acceptanceRate: real('acceptance_rate').notNull().default(0),
    completionRate: real('completion_rate').notNull().default(0),

    /** Verified competencies: pianos, safes, crane operation. */
    capabilities: jsonb('capabilities').$type<string[]>().notNull().default([]),

    /** Provider-agnostic on purpose — the payout rail is not the acquiring rail. */
    payoutAccountId: varchar('payout_account_id', { length: 120 }),
    payoutAccountReady: boolean('payout_account_ready').notNull().default(false),
    /** Israeli bank triplet + tax id. Needed to build a payout batch. */
    bankDetails: jsonb('bank_details'),

    approvedAt: timestamptz('approved_at'),
    suspendedAt: timestamptz('suspended_at'),
    suspensionReasonHe: text('suspension_reason_he'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('drivers_user_key').on(table.userId),
    // The eligible-pool filter runs on every dispatch, so it gets a composite.
    index('drivers_city_status_idx').on(table.cityId, table.status),
  ],
);

export const vehicles = pgTable(
  'vehicles',
  {
    id: id().primaryKey(),
    driverId: id('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    classId: vehicleClassEnum('class_id').notNull(),

    /** מספר רישוי */
    plateNumber: varchar('plate_number', { length: 15 }).notNull(),
    make: varchar('make', { length: 60 }),
    model: varchar('model', { length: 60 }),
    year: integer('year'),
    colour: varchar('colour', { length: 40 }),

    /** Photos of the actual truck. Shown to the customer before they book. */
    photoUrls: jsonb('photo_urls').$type<string[]>().notNull().default([]),

    // Equipment overrides — a driver's van may be fitted out differently to the
    // class default, and a crane on board changes which jobs they can take.
    hasCrane: boolean('has_crane').notNull().default(false),
    hasTailLift: boolean('has_tail_lift').notNull().default(false),
    hasBlankets: boolean('has_blankets').notNull().default(true),
    hasStraps: boolean('has_straps').notNull().default(true),
    hasTrolley: boolean('has_trolley').notNull().default(false),

    isActive: boolean('is_active').notNull().default(true),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('vehicles_plate_key').on(table.plateNumber),
    index('vehicles_driver_idx').on(table.driverId),
  ],
);

export const driverDocuments = pgTable(
  'driver_documents',
  {
    id: id().primaryKey(),
    driverId: id('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    kind: documentKindEnum('kind').notNull(),
    status: documentStatusEnum('status').notNull().default('missing'),

    fileUrls: jsonb('file_urls').$type<string[]>().notNull().default([]),

    submittedAt: timestamptz('submitted_at'),
    reviewedAt: timestamptz('reviewed_at'),
    reviewedBy: id('reviewed_by'),

    /**
     * Tracked so a lapse can auto-suspend the account.
     *
     * An expired goods-in-transit certificate is the difference between an
     * insured claim and an uninsured one, which the plan names as the single
     * biggest existential risk in the business. The nightly sweep reads this
     * column; there is a partial index on it below.
     */
    expiresAt: timestamptz('expires_at'),

    /** Shown verbatim to the driver — "rejected" with no reason loses drivers. */
    rejectionReasonHe: text('rejection_reason_he'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('driver_documents_driver_kind_key').on(table.driverId, table.kind),
    // Partial: only rows that can actually expire. Keeps the nightly
    // expiry sweep off a full scan as the driver base grows.
    index('driver_documents_expiry_idx')
      .on(table.expiresAt)
      .where(sql`expires_at is not null`),
  ],
);

// --- relations --------------------------------------------------------------

export const usersRelations = relations(users, ({ many, one }) => ({
  savedAddresses: many(savedAddresses),
  driver: one(drivers, { fields: [users.id], references: [drivers.userId] }),
}));

export const driversRelations = relations(drivers, ({ one, many }) => ({
  user: one(users, { fields: [drivers.userId], references: [users.id] }),
  vehicles: many(vehicles),
  documents: many(driverDocuments),
}));

export const vehiclesRelations = relations(vehicles, ({ one }) => ({
  driver: one(drivers, { fields: [vehicles.driverId], references: [drivers.id] }),
}));

export const driverDocumentsRelations = relations(driverDocuments, ({ one }) => ({
  driver: one(drivers, { fields: [driverDocuments.driverId], references: [drivers.id] }),
}));
