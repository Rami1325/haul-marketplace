import type { Config } from 'drizzle-kit';

export default {
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://haul:haul_dev@localhost:5432/haul',
  },
  verbose: true,
  strict: true,
} satisfies Config;
