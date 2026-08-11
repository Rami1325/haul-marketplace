import type { NextConfig } from 'next';

/**
 * ---------------------------------------------------------------------------
 * Next configuration
 * ---------------------------------------------------------------------------
 * Every entry here answers a decision made elsewhere in the repo, so each one
 * says which.
 * ---------------------------------------------------------------------------
 */
const nextConfig: NextConfig = {
  /**
   * The workspace packages ship raw TypeScript with no build step — WS-0's
   * "packages are consumed as source", which is what removes the stale-`dist`
   * class of bug. Next therefore has to compile them itself, and the list has to
   * name every `@haul/*` this app imports, transitively: `@haul/ui` is what the
   * pages reach for, and it imports `@haul/types` for the locale and the money
   * primitive. A package missing from this list fails at build time with a
   * syntax error inside `node_modules`, which reads like a broken dependency
   * rather than a missing line here.
   */
  transpilePackages: ['@haul/types', '@haul/ui'],

  /**
   * `postgres` opens real TCP sockets and loads its own native-ish plumbing.
   * Bundling it produces a driver that either fails to connect or connects from
   * a copy the pool never sees. `@haul/db` is not imported yet; the entry is
   * here because the first server action that reads a rate card will import it,
   * and a bundler exclusion added at the same time as the first query is one
   * nobody tests.
   */
  serverExternalPackages: ['postgres'],

  /**
   * The booking flow is eleven steps under a `[locale]` segment. A typo in a
   * `href` is the cheapest possible bug to catch at compile time and one of the
   * more annoying to catch by clicking.
   */
  typedRoutes: true,

  // There is no `eslint` key here and there cannot be one. Next 16 removed
  // `next lint` outright and dropped the config option with it — writing
  // `eslint: { ignoreDuringBuilds: true }` produces "Unrecognized key(s) in
  // object: 'eslint'" on every build. The intent it used to express is now the
  // framework's own behaviour: the build runs no linter at all, and Turbo runs
  // `lint` as a separate task against this repo's flat config, which is where
  // the `.js`-extension rule and the RTL conventions live.

  /** Nothing gains from announcing the framework on every response. */
  poweredByHeader: false,
};

export default nextConfig;
