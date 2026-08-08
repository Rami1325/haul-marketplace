import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import { createClient } from './client.js';

/**
 * ---------------------------------------------------------------------------
 * Migrations
 * ---------------------------------------------------------------------------
 * Three phases, in order:
 *
 *   1. Extensions — PostGIS must exist before any table references a geography
 *      type, so it cannot live in a generated migration.
 *   2. Drizzle's generated migrations — tables, enums, indexes, constraints.
 *   3. Hand-written SQL in `sql/` — the things Drizzle's schema language cannot
 *      express: generated geography columns, GiST indexes on them, and the
 *      CHECK constraints that make invariants structural rather than hopeful.
 *
 * Phase 3 is idempotent and re-runs every time. Each statement is written to be
 * safe to apply twice.
 * ---------------------------------------------------------------------------
 */

const here = fileURLToPath(new URL('.', import.meta.url));

async function main() {
  const { db, sql: client } = createClient({ maxConnections: 1 });

  try {
    console.log('1/3  extensions');
    await db.execute(sql`create extension if not exists postgis`);
    await db.execute(sql`create extension if not exists pg_trgm`);

    console.log('2/3  drizzle migrations');
    await migrate(db, { migrationsFolder: join(here, '..', 'migrations') });

    console.log('3/3  post-migration SQL (PostGIS columns, indexes, constraints)');
    const sqlDir = join(here, '..', 'sql');
    const files = (await readdir(sqlDir)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      const text = await readFile(join(sqlDir, file), 'utf8');
      process.stdout.write(`     ${file} ... `);
      await db.execute(sql.raw(text));
      console.log('ok');
    }

    console.log('\nmigrations complete');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('\nmigration failed:', error);
  process.exit(1);
});
