/**
 * ---------------------------------------------------------------------------
 * Provider results — one taxonomy for both rails
 * ---------------------------------------------------------------------------
 * Places and routing are separate interfaces because they fail for separate
 * reasons, but they share a result shape for the same reason `@haul/payments`
 * does: a caller that has to remember which vendor's error dialect it is
 * holding will eventually forget, and the forgetting always happens in the
 * branch nobody tested.
 *
 * Errors are values here, not exceptions. A geocode that finds nothing is an
 * ordinary Tuesday — the customer typed a street that does not exist — and
 * modelling it as a throw pushes the handling into a catch block that ends up
 * swallowing the network failures too.
 * ---------------------------------------------------------------------------
 */

export const GeoProviderId = {
  /** In-memory, seeded, deterministic. Local development and tests. */
  Fake: 'fake',
  /** Google Places (New) + Routes. */
  Google: 'google',
} as const;
export type GeoProviderId = (typeof GeoProviderId)[keyof typeof GeoProviderId];

export const GeoErrorCode = {
  /** Nothing matched. The customer's street does not exist, or not as typed. */
  NotFound: 'not_found',
  /**
   * Two points that cannot be joined by road. In Israel this is nearly always a
   * bad geocode — a pin in the sea, or across a border — not a real island.
   */
  NoRoute: 'no_route',
  /** Geocoded fine, outside the launch geography. A product answer, not a fault. */
  OutsideServiceArea: 'outside_service_area',
  /** Daily/QPS budget spent. Retryable, but not immediately. */
  QuotaExceeded: 'quota_exceeded',
  /** Bad or missing API key, or the key is not enabled for this API. */
  Unauthenticated: 'unauthenticated',
  /** The provider is down or timed out. Retryable. */
  ProviderUnavailable: 'provider_unavailable',
  /** We sent something malformed. Always a bug on our side. */
  InvalidRequest: 'invalid_request',
  Unknown: 'unknown',
} as const;
export type GeoErrorCode = (typeof GeoErrorCode)[keyof typeof GeoErrorCode];

/**
 * Whether retrying the identical request could plausibly succeed.
 *
 * `NotFound` is deliberately absent: retrying a search for a street that does
 * not exist burns quota and returns the same nothing. The fix is to ask the
 * customer, not the provider.
 */
export function isRetryable(code: GeoErrorCode): boolean {
  return (
    code === GeoErrorCode.ProviderUnavailable ||
    code === GeoErrorCode.QuotaExceeded ||
    code === GeoErrorCode.Unknown
  );
}

export type GeoResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly code: GeoErrorCode;
      readonly message: string;
      /** Raw provider payload, kept for support and for adapter debugging. */
      readonly providerRaw?: unknown;
    };

/** Narrow a result to its value, or throw. For tests and for boot-time wiring only. */
export function unwrap<T>(result: GeoResult<T>): T {
  if (!result.ok) {
    throw new Error(`geo request failed (${result.code}): ${result.message}`);
  }
  return result.value;
}
