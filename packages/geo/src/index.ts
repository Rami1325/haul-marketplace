/**
 * @haul/geo — addresses in, routed kilometres out.
 *
 * Two interfaces, because the two jobs fail differently and are bought
 * separately: `PlacesProvider` turns Hebrew keystrokes into a pin a driver can
 * be sent to, `RoutingProvider` turns pins into the distance a price is built
 * from.
 *
 * The second one carries locked decision 9 — kilometres via a routing API, not
 * straight-line. `distanceForPricing` is the only way to produce the branded
 * `RoutedMeters` the pricing engine should accept, and the haversine helper in
 * `distance.ts` is named so that reaching for it by mistake reads as the
 * mistake it is.
 */

export * from './result.js';
export * from './places.js';
export * from './routing.js';
export * from './distance.js';
export * from './text.js';
export * from './provider.js';
export { FakeGeoProvider, type FakeGeoProviderOptions } from './providers/fake.js';
export { GUSH_DAN_STREETS, SEEDED_CITIES, type SeedStreet } from './data/gush-dan-streets.js';
export {
  GoogleGeoProvider,
  GOOGLE_ENDPOINTS,
  GOOGLE_FIELD_MASKS,
  OPEN_QUESTIONS as GOOGLE_OPEN_QUESTIONS,
  israeliAddressFromComponents,
  isNoRouteResponse,
  mapGoogleHttpStatus,
  mapGoogleStatus,
  parseGoogleDuration,
  type GoogleAddressComponent,
  type GoogleGeoConfig,
} from './providers/google.js';
