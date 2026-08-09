import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Database = PostgresJsDatabase<typeof schema>;

export interface ClientOptions {
  connectionString?: string;
  /** Keep this low in serverless handlers and higher in the dispatch service. */
  maxConnections?: number;
  logQueries?: boolean;
}

/**
 * Connect.
 *
 * `postgres.js` rather than `pg`: it handles prepared statements and pipelining
 * better under the many-small-queries pattern dispatch produces, and it does
 * not need a separate pool wrapper.
 */
export function createClient(options: ClientOptions = {}) {
  const connectionString = options.connectionString ?? process.env['DATABASE_URL'] ?? '';

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — copy .env.example to .env');
  }

  const sql = postgres(connectionString, {
    max: options.maxConnections ?? 10,
    // The database runs UTC and conversion happens at the edge. Israel moves
    // its clocks on dates the Knesset can change, so a connection-level
    // timezone would be a moving target.
    types: {},
    onnotice: () => {},
    transform: { undefined: null },
  });

  const db = drizzle(sql, { schema, logger: options.logQueries ?? false });
  return { db, sql };
}

export { schema };
