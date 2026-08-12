import { createClient, type Database } from '@haul/db';

/**
 * ---------------------------------------------------------------------------
 * The app's connection
 * ---------------------------------------------------------------------------
 * One pool per process, created on first use and never on import.
 *
 * **Lazy, because `next build` imports this file.** Every route module is
 * loaded during the build to be traced and prerendered, and `createClient`
 * throws when `DATABASE_URL` is unset. At module scope that turns a missing
 * environment variable in CI into a build failure inside a page that never
 * touches the database; behind a function it stays what it is — a request that
 * needs the database, on a deployment that was not given one.
 *
 * **Cached on `globalThis`, because the dev server does not reload modules
 * once.** Every edit re-evaluates the module graph in the same process, so a
 * plain module-level singleton is a new pool per save and a connection limit
 * reached within a morning's work. In production the module is evaluated once
 * per instance and the global is simply where the singleton lives.
 *
 * `postgres` is in `serverExternalPackages` (see `next.config.ts`), so the
 * driver here is the real one rather than a bundled copy with its own pool.
 * ---------------------------------------------------------------------------
 */

const CACHE_KEY = Symbol.for('haul.web.database');

type Cache = typeof globalThis & { [CACHE_KEY]?: Database };

/**
 * There is deliberately no `closeDatabase`.
 *
 * Nothing in a request path should close a pool it is about to need again, and
 * no test reaches this module at all — `draft-store.ts` takes its `Database` as
 * a parameter precisely so a suite can supply a client it owns and close that.
 * An exported closer would be a function with one plausible caller and no real
 * one, and the first thing a future test would reach for instead of the
 * parameter that already exists.
 */
export function database(): Database {
  const cache = globalThis as Cache;
  const existing = cache[CACHE_KEY];
  if (existing) return existing;

  const client = createClient({
    /**
     * Low on purpose. Each serverless instance holds its own pool and there can
     * be a great many of them under load, so the number that matters is
     * instances × this — not this. Ten per instance is how a Postgres with 100
     * connections is exhausted by the tenth concurrent booking.
     *
     * The dispatch service is the opposite case and sets its own: one long-lived
     * process, many small queries, and a pool that should be large.
     */
    maxConnections: 4,
  });

  cache[CACHE_KEY] = client.db;
  return client.db;
}
