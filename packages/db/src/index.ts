/**
 * @haul/db — Postgres + PostGIS, via Drizzle.
 *
 * Money columns are `bigint` agorot. Positions are plain lat/lng doubles with a
 * GENERATED `geography(Point,4326)` column beside them for indexing, so the
 * spatial index cannot disagree with the numbers the application reads.
 */

export { createClient, schema, type Database, type ClientOptions } from './client.js';
export * from './schema/index.js';
export * from './queries/nearest-drivers.js';
