import type { PlacesProvider } from './places.js';
import type { RoutingProvider } from './routing.js';
import { FakeGeoProvider, type FakeGeoProviderOptions } from './providers/fake.js';
import { GoogleGeoProvider, type GoogleGeoConfig } from './providers/google.js';
import { GeoProviderId } from './result.js';

/**
 * ---------------------------------------------------------------------------
 * Choosing a provider
 * ---------------------------------------------------------------------------
 * Places and routing are separate interfaces because they are separate
 * concerns, but every implementation so far serves both — Google sells them as
 * two APIs on one key, and the fake has one seed dataset behind both. So the
 * thing an application wires up is the union, and the thing a unit test takes
 * is whichever half it actually uses.
 * ---------------------------------------------------------------------------
 */
export interface GeoProvider extends PlacesProvider, RoutingProvider {}

/** `fake` for development and tests, `google` for anything a customer sees. */
export const GEO_PROVIDER_ENV_VAR = 'GEO_PROVIDER';

export interface GeoEnv {
  GEO_PROVIDER?: string | undefined;
  GOOGLE_MAPS_API_KEY?: string | undefined;
  NODE_ENV?: string | undefined;
}

export interface CreateGeoProviderOptions {
  fake?: FakeGeoProviderOptions;
  google?: Partial<Omit<GoogleGeoConfig, 'apiKey'>>;
}

/** Boot-time misconfiguration. Thrown, because there is nothing to fall back to. */
export class GeoConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeoConfigurationError';
  }
}

/**
 * Build the provider named by `GEO_PROVIDER`, defaulting to the fake.
 *
 * Defaulting to the fake is what keeps a fresh checkout runnable: clone,
 * install, and the booking flow works with no Google account and no billing.
 *
 * The one exception is production. A forgotten environment variable there would
 * quote real customers off invented streets and invented distances, and it
 * would do it silently — the fake answers every query cheerfully. So in
 * production the variable must be set explicitly, even to `fake`. Failing at
 * boot is recoverable; discovering it in a ledger is not.
 *
 * `env` is a parameter rather than a read of `process.env` inside the function
 * so this is testable without mutating global state, and so a Next.js app can
 * hand over the subset of variables it has actually inlined.
 */
export function createGeoProvider(
  env: GeoEnv = process.env,
  options: CreateGeoProviderOptions = {},
): GeoProvider {
  const requested = env.GEO_PROVIDER?.trim().toLowerCase();

  if (requested === undefined || requested === '') {
    if (env.NODE_ENV === 'production') {
      throw new GeoConfigurationError(
        `${GEO_PROVIDER_ENV_VAR} must be set explicitly in production — ` +
          `defaulting to the fake would quote customers off seeded streets.`,
      );
    }
    return new FakeGeoProvider(options.fake);
  }

  switch (requested) {
    case GeoProviderId.Fake:
      return new FakeGeoProvider(options.fake);
    case GeoProviderId.Google: {
      const apiKey = env.GOOGLE_MAPS_API_KEY?.trim();
      if (!apiKey) {
        throw new GeoConfigurationError(
          `${GEO_PROVIDER_ENV_VAR}=google requires GOOGLE_MAPS_API_KEY.`,
        );
      }
      return new GoogleGeoProvider({
        apiKey,
        regionCode: options.google?.regionCode ?? 'IL',
        languageCode: options.google?.languageCode ?? 'he',
      });
    }
    default:
      throw new GeoConfigurationError(
        `unknown ${GEO_PROVIDER_ENV_VAR}=${requested}. Expected ` +
          `${GeoProviderId.Fake} or ${GeoProviderId.Google}.`,
      );
  }
}
