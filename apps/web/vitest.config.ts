import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * ---------------------------------------------------------------------------
 * Two projects, because two of these tests are not about React at all
 * ---------------------------------------------------------------------------
 * The suites that matter most in this app compile real CSS and read real source
 * files off disk. Running them inside jsdom would cost a DOM nobody uses and,
 * worse, would invite the habit this app cannot afford: asserting what a
 * component *rendered* rather than what the stylesheet *contains*. `@haul/ui`
 * shipped a whole product's worth of heightless buttons that way.
 *
 * So `*.node.test.ts` runs in plain Node — Tailwind's compiler, the Oxide
 * scanner, and the filesystem — and `*.test.tsx` runs in jsdom for the one thing
 * a DOM is genuinely required for: proving the page renders.
 * ---------------------------------------------------------------------------
 */

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.node.test.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          setupFiles: ['./src/__tests__/setup.ts'],
          include: ['src/**/*.test.tsx'],
        },
      },
    ],
  },
});
