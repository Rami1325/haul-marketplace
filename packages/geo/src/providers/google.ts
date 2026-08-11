import { AddressSchema, isWithinIsrael, type Address, type LatLng } from '@haul/types';
import {
  type AddressSuggestion,
  type AutocompleteRequest,
  type PlaceDetails,
  type PlaceDetailsOptions,
  type PlacesProvider,
} from '../places.js';
import { GeoErrorCode, GeoProviderId, type GeoResult } from '../result.js';
import type {
  RouteMatrixEntry,
  RouteMatrixRequest,
  RouteRequest,
  RoutedRoute,
  RoutingProvider,
} from '../routing.js';

/**
 * ---------------------------------------------------------------------------
 * Google adapter — skeleton
 * ---------------------------------------------------------------------------
 * Places API (New) for address entry, Routes API for distance. Two products,
 * two hosts, one billing account.
 *
 * Deliberately not a working implementation, for the same reason the PayPlus
 * adapter is not: an adapter written blind against a metered API fails in
 * production rather than in a test, and the failures here are expensive twice
 * over — a wrong Place Details field mask bills a premium SKU on every address
 * a customer confirms, and a wrong routing preference quietly changes every
 * price in the country.
 *
 * What this file is for is holding the verified research so it is not re-done,
 * doing the parts that can be checked without a key — error mapping, duration
 * parsing, address-component mapping — and naming what remains unknown.
 *
 * Verified against the published documentation (August 2026):
 *   · Autocomplete is POST `places:autocomplete`; the response is `suggestions`,
 *     each with a `placePrediction` carrying `placeId`, `text.text`,
 *     `structuredFormat.{mainText,secondaryText}.text`, `types` and
 *     `distanceMeters`.
 *   · `origin` in the request is what produces `distanceMeters`: "the origin
 *     point from which to calculate straight-line distance to the destination
 *     (returned as `distanceMeters`). If this value is omitted, straight-line
 *     distance will not be returned."
 *   · `includedRegionCodes` restricts to a country; `regionCode` only formats
 *     and biases. Neither is a substitute for checking the country that came
 *     back — see `israeliAddressFromComponents`.
 *   · Place Details is GET `places/PLACE_ID`; `languageCode` and `regionCode`
 *     are supported, and `id`, `formattedAddress`, `location`,
 *     `addressComponents` and `types` are the fields we need — all Essentials.
 *   · `AddressComponent` is `{ longText, shortText, types, languageCode }`.
 *   · Routes is POST `directions/v2:computeRoutes`; up to 25 `intermediates`;
 *     the response carries `routes[].legs[]` with `distanceMeters` (integer),
 *     `duration` and `polyline.encodedPolyline`. `duration` is "a duration in
 *     seconds with up to nine fractional digits, ending with 's'. Example:
 *     3.5s" — stated by the REST reference, not inferred.
 *   · Both APIs authenticate with `X-Goog-Api-Key` and require
 *     `X-Goog-FieldMask` to say what comes back.
 *
 * Docs: https://developers.google.com/maps/documentation/places/web-service
 *       https://developers.google.com/maps/documentation/routes
 * ---------------------------------------------------------------------------
 */

export const GOOGLE_ENDPOINTS = {
  /**
   * POST. Body carries `input`, `languageCode`, `regionCode`, `locationBias`,
   * `sessionToken`, `includedRegionCodes` and `origin`.
   *
   * The last two are the ones easily left out. `origin` is what makes
   * `distanceMeters` come back at all — it is the straight-line distance from
   * that point, and omitting it returns nothing rather than an error, so our
   * `bias.centre` has to be sent twice, as `locationBias.circle.center` and as
   * `origin`. `includedRegionCodes: ['il']` is the only one of the four region
   * parameters that RESTRICTS: `regionCode` formats and biases, `locationBias`
   * biases, `locationRestriction` restricts by area, and only
   * `includedRegionCodes` restricts by country.
   */
  autocomplete: 'https://places.googleapis.com/v1/places:autocomplete',
  /** GET. `PLACE_ID` is substituted; `languageCode` and `regionCode` are query parameters. */
  placeDetails: 'https://places.googleapis.com/v1/places/PLACE_ID',
  /** POST. `origin`, `destination`, up to 25 `intermediates`, `travelMode`, `routingPreference`. */
  computeRoutes: 'https://routes.googleapis.com/directions/v2:computeRoutes',
} as const;

/**
 * Field masks are not an optimisation here, they are the bill — but not
 * uniformly, and the difference matters. For Place Details the mask picks the
 * SKU, so one careless field moves the whole call up a tier. Autocomplete (New)
 * is billed per request or per session regardless of the mask, so widening it
 * costs nothing; what a too-narrow mask costs there is a field the adapter then
 * has to invent.
 *
 * These are the minimum each call needs, derived from what the types in
 * `places.ts` require rather than from what is pleasant to parse. Spaces are
 * not allowed anywhere in a mask. Confirm the Place Details SKU in the console
 * before this adapter is switched on — see OPEN_QUESTIONS.
 */
export const GOOGLE_FIELD_MASKS = {
  /**
   * `types` and `distanceMeters` are here because `AddressSuggestion` cannot be
   * built without them: `precision` is non-nullable, and nothing in placeId,
   * text or structuredFormat says whether a suggestion is a building or a
   * street. `distanceMeters` fills `straightLineMetersFromBias` and requires
   * `origin` in the request body.
   *
   * Two documented absences to expect rather than to debug: `distanceMeters` is
   * omitted for `route` predictions, and omitted when it would be 0. Both must
   * read as `straightLineMetersFromBias: null`, never as a zero.
   *
   * How far `types` gets us toward `GeocodePrecision`, and where it stops —
   * unverified against live Israeli responses, see OPEN_QUESTIONS:
   *   · `route` → Street.
   *   · `street_address`, `premise`, `subpremise` → a building, and no
   *     further. Places (New) has no `location_type`, so Rooftop and
   *     Interpolated cannot be told apart here at all; that distinction is a
   *     Geocoding API concept.
   *   · `locality`, `sublocality`, `neighborhood`, `postal_code`,
   *     `administrative_area_level_*` → Locality.
   */
  autocomplete:
    'suggestions.placePrediction.placeId,' +
    'suggestions.placePrediction.text.text,' +
    'suggestions.placePrediction.structuredFormat.mainText.text,' +
    'suggestions.placePrediction.structuredFormat.secondaryText.text,' +
    'suggestions.placePrediction.types,' +
    'suggestions.placePrediction.distanceMeters',
  /** Verified: every one of these is an Essentials-tier field. */
  placeDetails: 'id,formattedAddress,location,addressComponents,types',
  computeRoutes:
    'routes.distanceMeters,routes.duration,routes.legs.distanceMeters,routes.legs.duration',
} as const;

/**
 * What must be answered before this adapter is finished. Each one changes the
 * architecture or the unit economics, not just the implementation.
 */
export const OPEN_QUESTIONS = [
  // `AddressSuggestion.precision` is non-nullable and `isDispatchable()` gates
  // the quote flow on it, but Places (New) publishes no location_type. `types`
  // separates a building from a street; nothing separates a rooftop from an
  // interpolated pin. Either Place Details settles it per suggestion, or the
  // Geocoding API does, or the dispatchable set shrinks to what we can prove.
  'Which Places (New) field yields GeocodePrecision, and can Rooftop be told from Interpolated at all?',

  // Places API (New) has no reverse-geocode method. The driver app's "I'm here"
  // and the ops console's pin-correction both need one, which means a second
  // API — probably the Geocoding API — with its own key restrictions, its own
  // SKU and its own quality for Hebrew street names.
  'Which API serves reverse geocoding, and does it return Hebrew street names for Gush Dan?',

  // Google returns `subpremise` in some countries. Every Israeli sample we have
  // stops at street_number, which is why `entrance` and `apartment` are treated
  // as user-entered throughout this package. Confirm before relying on it —
  // if it were populated, the booking form could ask for one field fewer.
  'Does any Israeli result ever carry a subpremise, i.e. a כניסה or a דירה?',

  // Postal codes moved to seven digits in 2013 and coverage is uneven in older
  // datasets. If Places does not carry them reliably we need Israel Post's
  // lookup, because an invoice without a מיקוד is a rejected invoice.
  'Does Places return a 7-digit Israeli postal code reliably, or is Israel Post needed?',

  // The session token is what makes per-keystroke autocomplete affordable. What
  // is unverified is the edge: an abandoned session, a session where the user
  // picks nothing, and whether Place Details must carry the token to close it.
  'How exactly is an autocomplete session billed when the user abandons it?',

  // TRAFFIC_AWARE_OPTIMAL is materially more expensive and materially slower.
  // Quote latency is a conversion number, so this is a product decision.
  'Is TRAFFIC_AWARE or TRAFFIC_AWARE_OPTIMAL the right routingPreference for a quote?',

  // Route matrix has its own endpoint and its own element limits, which decide
  // how wide a dispatch shortlist can be before it needs paging.
  'What is the computeRouteMatrix endpoint URL and its element limit per request?',
] as const;

export interface GoogleGeoConfig {
  /** `X-Goog-Api-Key`. Restrict it to these two APIs and to our servers. */
  apiKey: string;
  /** CLDR region. `IL` for every call we make. */
  regionCode: string;
  /** Default response language. Hebrew is the product default. */
  languageCode: 'he' | 'en';
}

class NotImplemented extends Error {
  constructor(operation: string) {
    super(
      `Google geo adapter: ${operation} is not implemented yet. ` +
        `Resolve OPEN_QUESTIONS and verify field masks against a real key first.`,
    );
    this.name = 'NotImplemented';
  }
}

export class GoogleGeoProvider implements PlacesProvider, RoutingProvider {
  readonly id = GeoProviderId.Google;
  readonly supportsSessionTokens = true;
  readonly supportsTrafficAware = true;
  /** Verified: `intermediates` accepts up to 25 waypoints. */
  readonly maxIntermediateStops = 25;

  constructor(private readonly config: GoogleGeoConfig) {}

  /** Kept so the config is not flagged unused while the adapter is a skeleton. */
  get languageCode(): string {
    return this.config.languageCode;
  }

  async autocomplete(
    _request: AutocompleteRequest,
  ): Promise<GeoResult<readonly AddressSuggestion[]>> {
    throw new NotImplemented('autocomplete');
  }
  async details(
    _placeId: string,
    _options?: PlaceDetailsOptions,
  ): Promise<GeoResult<PlaceDetails>> {
    throw new NotImplemented('details');
  }
  async reverseGeocode(
    _point: LatLng,
    _options?: PlaceDetailsOptions,
  ): Promise<GeoResult<PlaceDetails>> {
    throw new NotImplemented('reverseGeocode');
  }
  async route(_request: RouteRequest): Promise<GeoResult<RoutedRoute>> {
    throw new NotImplemented('route');
  }
  async matrix(_request: RouteMatrixRequest): Promise<GeoResult<readonly RouteMatrixEntry[]>> {
    throw new NotImplemented('matrix');
  }
}

// --- the parts that can be verified without a key ---------------------------

/**
 * Google's canonical status strings, mapped onto our taxonomy.
 *
 * Both APIs report failures as `{ error: { code, status, message } }` using the
 * standard google.rpc codes, so one mapper serves Places and Routes. Written
 * and tested now because it is the layer that decides whether the booking flow
 * retries, asks the customer, or pages someone — and that decision must not be
 * discovered during the first outage.
 */
export function mapGoogleStatus(status: string): GeoErrorCode {
  switch (status) {
    case 'INVALID_ARGUMENT':
    case 'FAILED_PRECONDITION':
    case 'OUT_OF_RANGE':
      return GeoErrorCode.InvalidRequest;
    case 'NOT_FOUND':
      return GeoErrorCode.NotFound;
    case 'UNAUTHENTICATED':
    case 'PERMISSION_DENIED':
      return GeoErrorCode.Unauthenticated;
    case 'RESOURCE_EXHAUSTED':
      return GeoErrorCode.QuotaExceeded;
    case 'UNAVAILABLE':
    case 'DEADLINE_EXCEEDED':
    case 'INTERNAL':
      return GeoErrorCode.ProviderUnavailable;
    default:
      return GeoErrorCode.Unknown;
  }
}

/** Fallback for a response whose body we could not parse — a proxy error page, say. */
export function mapGoogleHttpStatus(httpStatus: number): GeoErrorCode {
  if (httpStatus === 400) return GeoErrorCode.InvalidRequest;
  if (httpStatus === 401 || httpStatus === 403) return GeoErrorCode.Unauthenticated;
  if (httpStatus === 404) return GeoErrorCode.NotFound;
  if (httpStatus === 429) return GeoErrorCode.QuotaExceeded;
  if (httpStatus >= 500) return GeoErrorCode.ProviderUnavailable;
  return GeoErrorCode.Unknown;
}

/**
 * A route request that succeeds but finds no road comes back 200 with an empty
 * `routes` array rather than as an error. Distinguishing that from a transport
 * failure is the difference between telling a customer "we cannot drive there"
 * and telling them "try again later".
 */
export function isNoRouteResponse(routes: readonly unknown[]): boolean {
  return routes.length === 0;
}

/**
 * Parse a protobuf Duration — "1234s", "3.5s" — into whole seconds.
 *
 * The fractional part is not a curiosity to be tightened away later: the Routes
 * reference defines `duration` as "a duration in seconds with up to nine
 * fractional digits, ending with 's'", and gives "3.5s" as the example. A
 * parser that accepted only whole seconds would reject a legal response and
 * fail the route.
 *
 * Returns null rather than guessing when the shape is unexpected, so a format
 * change surfaces as a failed route rather than as a job priced for zero
 * minutes of driving.
 */
export function parseGoogleDuration(value: string): number | null {
  const match = /^(-?\d+(?:\.\d+)?)s$/.exec(value.trim());
  if (!match) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round(seconds);
}

/** One entry of Google's `addressComponents`. */
export interface GoogleAddressComponent {
  longText?: string;
  shortText?: string;
  types?: readonly string[];
}

function componentText(components: readonly GoogleAddressComponent[], type: string): string | null {
  const found = components.find((component) => component.types?.includes(type) === true);
  return found?.longText ?? found?.shortText ?? null;
}

/**
 * The country's CLDR code, read from `shortText` only.
 *
 * `longText` is the country's name in whichever language was asked for —
 * "ישראל", "Israel", "Israël" — so matching on it is matching against a list
 * that is always one locale short of correct.
 */
function countryCode(components: readonly GoogleAddressComponent[]): string | null {
  const found = components.find((component) => component.types?.includes('country') === true);
  return found?.shortText ?? null;
}

/**
 * Build an Israeli `Address` from a Place Details payload.
 *
 * `entrance` and `apartment` are hardcoded null and that is the point: this
 * function is the boundary where it becomes impossible to accidentally believe
 * Google told us which כניסה. Everything else comes from the standard component
 * types, which are shared with the Geocoding API and stable across both.
 *
 * Returns null when the place is not in Israel, and when there is no house
 * number — a street or a neighbourhood is not somewhere a truck can be sent,
 * and the caller must ask for more.
 */
export function israeliAddressFromComponents(input: {
  placeId: string;
  formattedAddress: string;
  location: LatLng;
  addressComponents: readonly GoogleAddressComponent[];
}): Address | null {
  // `AddressSchema.countryCode` is `z.literal('IL').default('IL')`, which
  // stamps rather than checks, and `regionCode: 'IL'` on the request only
  // biases — restricting is `includedRegionCodes`. So a Paris place would parse
  // clean here and carry an Israeli country code over Paris coordinates, with
  // nothing downstream able to tell. Checked twice, because the components and
  // the pin can each be wrong on their own, and a missing country component is
  // silence rather than agreement.
  if (countryCode(input.addressComponents) !== 'IL') return null;
  if (!isWithinIsrael(input.location)) return null;

  const street = componentText(input.addressComponents, 'route');
  const houseNumber = componentText(input.addressComponents, 'street_number');
  const city =
    componentText(input.addressComponents, 'locality') ??
    componentText(input.addressComponents, 'administrative_area_level_2');
  if (street === null || houseNumber === null || city === null) return null;

  const postalCode = componentText(input.addressComponents, 'postal_code');
  return AddressSchema.parse({
    street,
    houseNumber,
    entrance: null,
    apartment: null,
    city,
    // A malformed מיקוד is dropped rather than rejected: an address without a
    // postal code is still deliverable, and failing the whole geocode over one
    // would block a booking for no gain.
    postalCode: postalCode !== null && /^\d{5}(\d{2})?$/.test(postalCode) ? postalCode : null,
    coordinates: input.location,
    placeId: input.placeId,
    formatted: input.formattedAddress,
    notes: null,
  });
}
