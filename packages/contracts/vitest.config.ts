import { defineConfig } from 'vitest/config';

/**
 * Node, explicitly. Nothing here renders — these are wire shapes and the
 * functions that build them — and stating the environment means a future
 * dependency that ships a browser build cannot quietly change which entry point
 * the tests resolve.
 */
export default defineConfig({
  test: {
    environment: 'node',
  },
});
