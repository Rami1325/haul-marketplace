import { bigint, doublePrecision, timestamp, varchar } from 'drizzle-orm/pg-core';
import type { Agorot } from '@haul/types';

/**
 * ---------------------------------------------------------------------------
 * Shared column builders
 * ---------------------------------------------------------------------------
 * Defined once so the rules in the README are structural rather than
 * aspirational. If money is always `agorot()`, there is no place for a
 * `numeric` column to appear and quietly start rounding.
 * ---------------------------------------------------------------------------
 */

/**
 * Money. `bigint` holding an integer count of agorot, never `numeric`, never
 * `real`, never a float.
 *
 * `mode: 'number'` is safe here: the domain caps a single amount at ₪1,000,000
 * (100,000,000 agorot), six orders of magnitude below `Number.MAX_SAFE_INTEGER`.
 * The branded `Agorot` type carries through so a raw number cannot be assigned
 * to a money column by accident.
 */
export function agorot(name: string) {
  return bigint(name, { mode: 'number' }).$type<Agorot>();
}

/**
 * Timestamps are always stored with a time zone and always in UTC.
 *
 * The database runs UTC and conversion happens at the edge through
 * `Asia/Jerusalem`. Israel changes its clocks twice a year on dates the Knesset
 * can move, and a naive timestamp column would silently mis-order every job
 * booked across a changeover.
 */
export function timestamptz(name: string) {
  return timestamp(name, { withTimezone: true, mode: 'date' });
}

export function createdAt() {
  return timestamptz('created_at').notNull().defaultNow();
}

export function updatedAt() {
  return timestamptz('updated_at').notNull().defaultNow();
}

/** Prefixed ULID, e.g. `job_01J…`. Sortable by creation time, readable in a log. */
export function id(name = 'id') {
  return varchar(name, { length: 64 });
}

/**
 * Latitude / longitude as plain doubles.
 *
 * The PostGIS `geography(Point,4326)` column beside them is GENERATED from
 * these, so there is exactly one writable source of truth for a position and no
 * way for the indexed geometry to disagree with the numbers the application
 * reads. See `migrations/9999_postgis.sql`.
 */
export function latitude(name = 'latitude') {
  return doublePrecision(name);
}

export function longitude(name = 'longitude') {
  return doublePrecision(name);
}
