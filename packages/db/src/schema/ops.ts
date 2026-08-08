import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import type { RateCard } from '@haul/pricing';
import { agorot, createdAt, id, latitude, longitude, timestamptz, updatedAt } from '../columns.js';
import { users } from './identity.js';
import { localeEnum } from './enums.js';

/**
 * ---------------------------------------------------------------------------
 * Ops & configuration
 * ---------------------------------------------------------------------------
 * The console is not a phase-3 nicety. In the first six months a human saves
 * more jobs than the algorithm does, and without these tables they do it in
 * the database.
 * ---------------------------------------------------------------------------
 */

export const cities = pgTable('cities', {
  id: id().primaryKey(),
  nameHe: varchar('name_he', { length: 120 }).notNull(),
  nameEn: varchar('name_en', { length: 120 }).notNull(),
  locale: localeEnum('locale').notNull().default('he'),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Jerusalem'),

  /** The launch cluster, not the metro. Density beats coverage. */
  centreLatitude: latitude('centre_latitude').notNull(),
  centreLongitude: longitude('centre_longitude').notNull(),
  serviceRadiusMeters: integer('service_radius_meters').notNull(),

  /** Candle-lighting custom differs by city — 18 minutes, 40 in Jerusalem. */
  candleLightingMinutes: smallint('candle_lighting_minutes').notNull().default(18),
  nightfallMinutes: smallint('nightfall_minutes').notNull().default(40),
  operatingStartHour: smallint('operating_start_hour').notNull().default(7),
  operatingEndHour: smallint('operating_end_hour').notNull().default(22),

  isLive: boolean('is_live').notNull().default(false),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Rate cards, versioned and stored whole.
 *
 * Editable from the console without a deploy — the plan is explicit that
 * pricing knobs must not need a release. Rows are append-only: a change writes
 * a new version rather than mutating the old one, so any historical quote can
 * still be explained by the card that produced it.
 */
export const rateCards = pgTable(
  'rate_cards',
  {
    id: id().primaryKey(),
    cityId: id('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    version: varchar('version', { length: 32 }).notNull(),

    card: jsonb('card').$type<RateCard>().notNull(),

    effectiveFrom: timestamptz('effective_from').notNull(),
    /** Null means current. Exactly one live card per city at any instant. */
    effectiveUntil: timestamptz('effective_until'),

    createdBy: id('created_by').references(() => users.id, { onDelete: 'set null' }),
    changeNote: text('change_note'),

    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('rate_cards_city_version_key').on(table.cityId, table.version),
    // Only one card per city may be open-ended. Prevents two "current" cards
    // silently pricing different customers differently.
    uniqueIndex('rate_cards_city_current_key')
      .on(table.cityId)
      .where(sql`effective_until is null`),
  ],
);

export const promos = pgTable(
  'promos',
  {
    id: id().primaryKey(),
    code: varchar('code', { length: 40 }).notNull(),
    cityId: id('city_id'),

    /** Gross, VAT-inclusive, as advertised. */
    amountOff: agorot('amount_off'),
    percentOffBps: integer('percent_off_bps'),
    maxDiscount: agorot('max_discount'),
    minJobValue: agorot('min_job_value'),

    firstJobOnly: boolean('first_job_only').notNull().default(false),
    maxRedemptions: integer('max_redemptions'),
    redemptionCount: integer('redemption_count').notNull().default(0),
    maxPerCustomer: smallint('max_per_customer').notNull().default(1),

    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at'),
    isActive: boolean('is_active').notNull().default(true),

    createdBy: id('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('promos_code_key').on(table.code)],
);

export const promoRedemptions = pgTable(
  'promo_redemptions',
  {
    id: id().primaryKey(),
    promoId: id('promo_id')
      .notNull()
      .references(() => promos.id, { onDelete: 'cascade' }),
    userId: id('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobId: id('job_id').notNull(),
    amountApplied: agorot('amount_applied').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('promo_redemptions_promo_job_key').on(table.promoId, table.jobId),
    index('promo_redemptions_user_idx').on(table.userId, table.promoId),
  ],
);

/**
 * Audit log.
 *
 * Support can impersonate any account read-only; that is only acceptable if
 * every such view is recorded. Also covers ops overrides — force-assigning a
 * driver, waiving a fee, overriding a geofence.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id().primaryKey(),
    actorId: id('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: varchar('actor_role', { length: 20 }).notNull(),

    action: varchar('action', { length: 80 }).notNull(),
    entityType: varchar('entity_type', { length: 40 }).notNull(),
    entityId: id('entity_id'),

    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),

    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: varchar('user_agent', { length: 300 }),

    createdAt: createdAt(),
  },
  (table) => [
    index('audit_log_entity_idx').on(table.entityType, table.entityId, table.createdAt),
    index('audit_log_actor_idx').on(table.actorId, table.createdAt),
  ],
);

/**
 * Fraud signals. Recorded rather than acted on automatically — an automatic
 * ban on a false positive costs a customer permanently, and at launch volume a
 * human can look at every one.
 */
export const fraudFlags = pgTable(
  'fraud_flags',
  {
    id: id().primaryKey(),
    subjectType: varchar('subject_type', { length: 20 }).notNull(),
    subjectId: id('subject_id').notNull(),

    /** repeat_canceller · off_platform_contact · gps_spoof · duplicate_device */
    signal: varchar('signal', { length: 64 }).notNull(),
    severity: smallint('severity').notNull().default(1),
    detail: jsonb('detail'),

    reviewedAt: timestamptz('reviewed_at'),
    reviewedBy: id('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    dismissed: boolean('dismissed').notNull().default(false),

    createdAt: createdAt(),
  },
  (table) => [
    index('fraud_flags_subject_idx').on(table.subjectType, table.subjectId),
    index('fraud_flags_open_idx')
      .on(table.createdAt)
      .where(sql`reviewed_at is null`),
  ],
);

export const featureFlags = pgTable('feature_flags', {
  key: varchar('key', { length: 80 }).primaryKey(),
  description: text('description'),
  isEnabled: boolean('is_enabled').notNull().default(false),
  /** Percentage rollout, 0–100. */
  rolloutPercent: smallint('rollout_percent').notNull().default(0),
  cityId: id('city_id'),
  updatedAt: updatedAt(),
});
