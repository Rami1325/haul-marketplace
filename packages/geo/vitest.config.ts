import { defineConfig } from 'vitest/config';

/**
 * Node, explicitly. This package talks to HTTP APIs and has no DOM; the default
 * would give us the same thing, but stating it means a future dependency that
 * ships a browser build cannot quietly change which one gets resolved.
 */
export default defineConfig({
  test: {
    environment: 'node',
  },
});
