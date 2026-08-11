import {
  AddressSchema,
  isWithinIsrael,
  israeliClock,
  israeliDayOfWeek,
  type Address,
  type LatLng,
  type Locale,
  type RouteLeg,
} from '@haul/types';
import { GUSH_DAN_STREETS, type SeedStreet } from '../data/gush-dan-streets.js';
import {
  MIN_PLAUSIBLE_CIRCUITY,
  straightLineMetersNotForPricing as straightLineMeters,
} from '../distance.js';
import {
  AutocompleteRequestSchema,
  GeocodePrecision,
  type AddressSuggestion,
  type AutocompleteRequest,
  type PlaceDetails,
  type PlaceDetailsOptions,
  type PlacesProvider,
} from '../places.js';
import { GeoErrorCode, GeoProviderId, type GeoResult } from '../result.js';
import {
  RouteRequestSchema,
  totalDistanceMeters,
  totalDurationSeconds,
  type RouteMatrixEntry,
  type RouteMatrixRequest,
  type RouteRequest,
  type RoutedRoute,
  type RoutingProvider,
} from '../routing.js';
import {
  hash32,
  houseNumberValue,
  normaliseAddressQuery,
  parseAddressQuery,
  unitInterval,
} from '../text.js';

/**
 * ---------------------------------------------------------------------------
 * In-memory geo provider
 * ---------------------------------------------------------------------------
 * Lets the whole booking flow — type an address, pick it, route it, price it,
 * dispatch it — run with no Google account, no billing enabled and no network.
 * The web app, the driver app and the dispatch service are all developable and
 * testable before a maps contract exists, which is the same bargain
 * `FakeAcquiringProvider` strikes for payments.
 *
 * **Deterministic** is the whole design constraint. Every number here is either
 * seed data or an FNV-1a hash of the inputs: the same query returns the same
 * suggestions in the same order, the same pair of pins returns the same routed
 * distance, on every machine and on every run. A fake with a random component
 * is a fake that produces flaky tests, and a flaky geo test is one that gets
 * deleted rather than fixed.
 *
 * Two properties it upholds because production depends on them:
 *
 *  1. **Routed distance is never the straight line.** Every leg is inflated by
 *     a detour factor in the range real Gush Dan road networks exhibit, and the
 *     result never trips `isImplausiblyDirect`. If the pricing engine is ever
 *     wired to a haversine number, the fake will not be what hides it.
 *  2. **Entrance and apartment are always null.** No geocoder returns כניסה,
 *     so neither does this one. The booking form asks; `withAccessDetails`
 *     joins the halves.
 *
 * Legs are direction-dependent on purpose — A→B and B→A get different hashes.
 * Central Tel Aviv is a one-way grid and the return leg genuinely is a
 * different drive; code that assumes symmetry should fail here rather than in
 * a driver's payout.
 * ---------------------------------------------------------------------------
 */

// --- geometry ---------------------------------------------------------------

const METERS_PER_DEGREE_LAT = 111_320;
const DEG = Math.PI / 180;

/** Six decimals is about 10 cm — far finer than the seed data, and stable to compare. */
function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function offsetMeters(from: LatLng, north: number, east: number): LatLng {
  return {
    lat: round6(from.lat + north / METERS_PER_DEGREE_LAT),
    lng: round6(from.lng + east / (METERS_PER_DEGREE_LAT * Math.cos(from.lat * DEG))),
  };
}

/**
 * Where a house number sits along its street. Linear interpolation between the
 * two ends — which is exactly what a real geocoder does when it has no rooftop
 * for the building, and close enough that short hops inside one street have a
 * distance rather than all sharing one pin.
 */
function houseCoordinates(street: SeedStreet, houseNumber: number): LatLng {
  const span = street.maxNumber - street.minNumber;
  const fraction = span === 0 ? 0.5 : (houseNumber - street.minNumber) / span;
  const along = (fraction - 0.5) * street.lengthMeters;
  const bearing = street.bearingDeg * DEG;
  return offsetMeters(street.centre, along * Math.cos(bearing), along * Math.sin(bearing));
}

/** Nearest house number on a street to an arbitrary pin, by projection onto the line. */
function nearestHouseNumber(street: SeedStreet, point: LatLng): number {
  const north = (point.lat - street.centre.lat) * METERS_PER_DEGREE_LAT;
  const east =
    (point.lng - street.centre.lng) * METERS_PER_DEGREE_LAT * Math.cos(street.centre.lat * DEG);
  const bearing = street.bearingDeg * DEG;
  const along = north * Math.cos(bearing) + east * Math.sin(bearing);
  const half = street.lengthMeters / 2;
  const fraction = (Math.min(half, Math.max(-half, along)) + half) / street.lengthMeters;
  const span = street.maxNumber - street.minNumber;
  const number = Math.round(street.minNumber + fraction * span);
  return Math.min(street.maxNumber, Math.max(street.minNumber, number));
}

// --- place ids --------------------------------------------------------------

const STREET_PREFIX = 'fake:street:';
const ADDRESS_PREFIX = 'fake:addr:';

function streetPlaceId(streetId: string): string {
  return `${STREET_PREFIX}${streetId}`;
}

function addressPlaceId(streetId: string, houseNumber: string): string {
  return `${ADDRESS_PREFIX}${streetId}:${houseNumber}`;
}

interface DecodedPlaceId {
  streetId: string;
  /** Null for a street-level place — there is no building behind it. */
  houseNumber: string | null;
}

function decodePlaceId(placeId: string): DecodedPlaceId | null {
  if (placeId.startsWith(STREET_PREFIX)) {
    const streetId = placeId.slice(STREET_PREFIX.length);
    return streetId.length > 0 ? { streetId, houseNumber: null } : null;
  }
  if (placeId.startsWith(ADDRESS_PREFIX)) {
    const rest = placeId.slice(ADDRESS_PREFIX.length);
    const separator = rest.indexOf(':');
    if (separator <= 0 || separator === rest.length - 1) return null;
    return { streetId: rest.slice(0, separator), houseNumber: rest.slice(separator + 1) };
  }
  return null;
}

// --- matching ---------------------------------------------------------------

interface IndexedStreet {
  readonly seed: SeedStreet;
  readonly nameHe: string;
  readonly nameEn: string;
  readonly cityHe: string;
  readonly cityEn: string;
}

function indexStreet(seed: SeedStreet): IndexedStreet {
  return {
    seed,
    nameHe: normaliseAddressQuery(seed.nameHe),
    nameEn: normaliseAddressQuery(seed.nameEn),
    cityHe: normaliseAddressQuery(seed.cityHe),
    cityEn: normaliseAddressQuery(seed.cityEn),
  };
}

const EXACT = 100;
const PREFIX = 80;
const CONTAINS = 50;
/** Naming the city as well is weak evidence, but it is evidence. */
const CITY_BONUS = 10;

function scoreText(haystack: string, needle: string): number {
  if (haystack === needle) return EXACT;
  if (haystack.startsWith(needle)) return PREFIX;
  if (haystack.includes(needle)) return CONTAINS;
  return 0;
}

/**
 * Score a street against the query's terms, trying every split between "this
 * part names the street" and "this part names the city". "סוקולוב הרצליה" has
 * to beat "סוקולוב חולון", and the only thing separating them is the tail.
 */
function scoreStreet(street: IndexedStreet, terms: readonly string[]): number {
  let best = 0;
  for (let split = terms.length; split >= 1; split -= 1) {
    const streetQuery = terms.slice(0, split).join(' ');
    const cityQuery = terms.slice(split).join(' ');
    if (streetQuery.length === 0) continue;
    if (
      cityQuery.length > 0 &&
      !street.cityHe.includes(cityQuery) &&
      !street.cityEn.includes(cityQuery)
    ) {
      continue;
    }
    const name = Math.max(
      scoreText(street.nameHe, streetQuery),
      scoreText(street.nameEn, streetQuery),
    );
    if (name === 0) continue;
    best = Math.max(best, name + (cityQuery.length > 0 ? CITY_BONUS : 0));
  }
  return best;
}

/** Below this there is nothing to rank on and every street in Gush Dan matches. */
const MIN_QUERY_LENGTH = 2;

// --- routing model ----------------------------------------------------------

/**
 * Circuity bounds for a dense urban grid. Tel Aviv's one-way system and the
 * Ayalon crossings put real legs comfortably inside this band.
 */
const URBAN_DETOUR = { min: 1.22, max: 1.55 } as const;
/**
 * The band a motorway-dominated leg falls into. Its floor is chosen well clear
 * of `MIN_PLAUSIBLE_CIRCUITY` so the fake can never be mistaken for a haversine
 * leak, and its ceiling below the urban floor so "the long leg is the straighter
 * one" holds for every pair of pins rather than for most of them.
 */
const MOTORWAY_DETOUR = { min: 1.08, max: 1.18 } as const;
/** Beyond this a leg is mostly Ayalon or Route 1. */
const LONG_HAUL_METERS = 30_000;

/** km/h. Gush Dan is slow, and at 08:30 it is very slow. */
const PEAK_KMH = 16;
const TYPICAL_KMH = 24;
const NIGHT_KMH = 34;
/** Motorway share of a long leg, expressed as the km/h it adds at the limit. */
const LONG_HAUL_KMH_BONUS = 40;

function detourFactor(from: LatLng, to: LatLng, straightMeters: number): number {
  const key = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}>${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
  // One draw, both bands: a given pair of pins keeps its character as the
  // motorway share grows, rather than jumping between two unrelated numbers.
  const draw = unitInterval(hash32(key));
  const urban = URBAN_DETOUR.min + draw * (URBAN_DETOUR.max - URBAN_DETOUR.min);
  const motorway = MOTORWAY_DETOUR.min + draw * (MOTORWAY_DETOUR.max - MOTORWAY_DETOUR.min);
  const longHaul = Math.min(1, straightMeters / LONG_HAUL_METERS);
  const factor = urban * (1 - longHaul) + motorway * longHaul;
  // Belt and braces: the bands already sit above the tripwire, and this keeps
  // them there if someone tunes them.
  return Math.max(MIN_PLAUSIBLE_CIRCUITY + 0.05, factor);
}

function speedKmh(departAt: Date | null, straightMeters: number): number {
  const longHaul = Math.min(1, straightMeters / LONG_HAUL_METERS);
  const bonus = longHaul * LONG_HAUL_KMH_BONUS;
  if (departAt === null) return TYPICAL_KMH + bonus;

  const { hour } = israeliClock(departAt);
  if (hour >= 22 || hour < 6) return NIGHT_KMH + bonus;
  // Sunday–Thursday is the working week; Friday's rush is a different shape and
  // the fake does not pretend to model it.
  const isWorkday = israeliDayOfWeek(departAt) <= 4;
  const isRush = (hour >= 7 && hour < 10) || (hour >= 16 && hour < 19);
  return (isWorkday && isRush ? PEAK_KMH : TYPICAL_KMH) + bonus;
}

// --- the provider -----------------------------------------------------------

export interface FakeGeoProviderOptions {
  /**
   * Clock for traffic-aware routing with no explicit departure time. Tests
   * should pass `departAt` instead; this exists so a running dev server behaves.
   */
  now?: () => Date;
  /** Force every call to fail, to develop the error paths without unplugging anything. */
  failWith?: GeoErrorCode | null;
  /** Extra geography, for a test that needs a street the seed does not carry. */
  extraStreets?: readonly SeedStreet[];
}

export class FakeGeoProvider implements PlacesProvider, RoutingProvider {
  readonly id = GeoProviderId.Fake;
  readonly supportsSessionTokens = true;
  readonly supportsTrafficAware = true;
  /** Matches `StopSchema`'s twenty stops: origin, destination and eighteen between. */
  readonly maxIntermediateStops = 18;

  /** How far a dropped pin may be from a seeded street before we admit we do not know. */
  static readonly REVERSE_GEOCODE_RANGE_METERS = 1_500;

  private readonly streets: readonly IndexedStreet[];
  private readonly byId: ReadonlyMap<string, IndexedStreet>;
  private readonly now: () => Date;
  private readonly failWith: GeoErrorCode | null;

  constructor(options: FakeGeoProviderOptions = {}) {
    const seeds = [...GUSH_DAN_STREETS, ...(options.extraStreets ?? [])];
    this.streets = seeds.map(indexStreet);
    this.byId = new Map(this.streets.map((street) => [street.seed.id, street]));
    this.now = options.now ?? (() => new Date());
    this.failWith = options.failWith ?? null;
  }

  private injectedFailure<T>(): GeoResult<T> | null {
    if (this.failWith === null) return null;
    return { ok: false, code: this.failWith, message: `injected failure: ${this.failWith}` };
  }

  // --- places ---------------------------------------------------------------

  async autocomplete(
    request: AutocompleteRequest,
  ): Promise<GeoResult<readonly AddressSuggestion[]>> {
    const failure = this.injectedFailure<readonly AddressSuggestion[]>();
    if (failure) return failure;

    const parsed = AutocompleteRequestSchema.safeParse(request);
    if (!parsed.success) {
      return {
        ok: false,
        code: GeoErrorCode.InvalidRequest,
        message: 'malformed autocomplete request',
        providerRaw: parsed.error,
      };
    }
    const { query, language, bias, limit } = parsed.data;

    const { terms, houseNumber } = parseAddressQuery(query);
    if (terms.join(' ').length < MIN_QUERY_LENGTH) return { ok: true, value: [] };

    const ranked = this.streets
      .map((street) => ({ street, score: scoreStreet(street, terms) }))
      .filter((candidate) => candidate.score > 0)
      .map((candidate) => ({
        score: candidate.score,
        suggestion: this.suggestionFor(
          candidate.street,
          houseNumber,
          language,
          bias?.centre ?? null,
        ),
      }))
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        const distanceA = a.suggestion.straightLineMetersFromBias;
        const distanceB = b.suggestion.straightLineMetersFromBias;
        if (distanceA !== null && distanceB !== null && distanceA !== distanceB) {
          return distanceA - distanceB;
        }
        // Total order or nothing — a sort that leaves ties unbroken is a sort
        // whose output depends on the engine's implementation.
        return a.suggestion.placeId < b.suggestion.placeId ? -1 : 1;
      });

    return { ok: true, value: ranked.slice(0, limit).map((entry) => entry.suggestion) };
  }

  private suggestionFor(
    street: IndexedStreet,
    houseNumber: string | null,
    language: Locale,
    biasCentre: LatLng | null,
  ): AddressSuggestion {
    const hebrew = language === 'he';
    const name = hebrew ? street.seed.nameHe : street.seed.nameEn;
    const city = hebrew ? street.seed.cityHe : street.seed.cityEn;
    const number = houseNumber === null ? null : this.resolveHouseNumber(street.seed, houseNumber);

    // A number the street does not have is not a failed search — the customer
    // simply has to be shown the street and asked again.
    const precise = number !== null;
    const coordinates = precise
      ? houseCoordinates(street.seed, houseNumberValue(number) ?? street.seed.minNumber)
      : street.seed.centre;

    const primaryText = precise ? `${name} ${number}` : name;
    return {
      placeId: precise ? addressPlaceId(street.seed.id, number) : streetPlaceId(street.seed.id),
      description: `${primaryText}, ${city}`,
      primaryText,
      secondaryText: city,
      precision: precise ? GeocodePrecision.Rooftop : GeocodePrecision.Street,
      straightLineMetersFromBias:
        biasCentre === null ? null : straightLineMeters(biasCentre, coordinates),
    };
  }

  /** The house number as typed, or null when this street has no such door. */
  private resolveHouseNumber(street: SeedStreet, houseNumber: string): string | null {
    const value = houseNumberValue(houseNumber);
    if (value === null) return null;
    if (value < street.minNumber || value > street.maxNumber) return null;
    return houseNumber;
  }

  async details(
    placeId: string,
    options: PlaceDetailsOptions = {},
  ): Promise<GeoResult<PlaceDetails>> {
    const failure = this.injectedFailure<PlaceDetails>();
    if (failure) return failure;

    const decoded = decodePlaceId(placeId);
    if (decoded === null) {
      return {
        ok: false,
        code: GeoErrorCode.InvalidRequest,
        message: `not a place id this provider issued: ${placeId}`,
      };
    }

    const street = this.byId.get(decoded.streetId);
    if (!street) {
      return {
        ok: false,
        code: GeoErrorCode.NotFound,
        message: `unknown street ${decoded.streetId}`,
      };
    }

    const language = options.language ?? 'he';
    if (decoded.houseNumber === null) {
      return { ok: true, value: this.streetDetails(street.seed, language) };
    }

    const houseNumber = this.resolveHouseNumber(street.seed, decoded.houseNumber);
    if (houseNumber === null) {
      return {
        ok: false,
        code: GeoErrorCode.NotFound,
        message: `no ${decoded.houseNumber} on ${street.seed.nameHe}`,
      };
    }

    return {
      ok: true,
      value: this.addressDetails(street.seed, houseNumber, language, GeocodePrecision.Rooftop),
    };
  }

  async reverseGeocode(
    point: LatLng,
    options: PlaceDetailsOptions = {},
  ): Promise<GeoResult<PlaceDetails>> {
    const failure = this.injectedFailure<PlaceDetails>();
    if (failure) return failure;

    if (!isWithinIsrael(point)) {
      return {
        ok: false,
        code: GeoErrorCode.OutsideServiceArea,
        message: `${point.lat},${point.lng} is outside Israel`,
      };
    }

    let best: { street: SeedStreet; houseNumber: number; meters: number } | null = null;
    for (const street of this.streets) {
      const houseNumber = nearestHouseNumber(street.seed, point);
      const meters = straightLineMeters(point, houseCoordinates(street.seed, houseNumber));
      if (best === null || meters < best.meters)
        best = { street: street.seed, houseNumber, meters };
    }

    if (best === null || best.meters > FakeGeoProvider.REVERSE_GEOCODE_RANGE_METERS) {
      return {
        ok: false,
        code: GeoErrorCode.NotFound,
        message: 'no seeded street within range — the fake only covers Gush Dan',
      };
    }

    // Snapped to a street line rather than read off a building, so: interpolated.
    return {
      ok: true,
      value: this.addressDetails(
        best.street,
        String(best.houseNumber),
        options.language ?? 'he',
        GeocodePrecision.Interpolated,
      ),
    };
  }

  private streetDetails(street: SeedStreet, language: Locale): PlaceDetails {
    const hebrew = language === 'he';
    const name = hebrew ? street.nameHe : street.nameEn;
    const city = hebrew ? street.cityHe : street.cityEn;
    return {
      placeId: streetPlaceId(street.id),
      precision: GeocodePrecision.Street,
      coordinates: street.centre,
      formatted: `${name}, ${city}`,
      address: null,
    };
  }

  private addressDetails(
    street: SeedStreet,
    houseNumber: string,
    language: Locale,
    precision: GeocodePrecision,
  ): PlaceDetails {
    const hebrew = language === 'he';
    const name = hebrew ? street.nameHe : street.nameEn;
    const city = hebrew ? street.cityHe : street.cityEn;
    const coordinates = houseCoordinates(street, houseNumberValue(houseNumber) ?? street.minNumber);
    const placeId = addressPlaceId(street.id, houseNumber);
    const formatted = `${name} ${houseNumber}, ${city}`;

    const address: Address = AddressSchema.parse({
      street: name,
      houseNumber,
      // Never guessed. No geocoder knows which כניסה, and inventing one here
      // would let the booking flow ship without ever asking.
      entrance: null,
      apartment: null,
      city,
      postalCode: syntheticPostalCode(street, houseNumber),
      coordinates,
      placeId,
      formatted,
      notes: null,
    });

    return { placeId, precision, coordinates, formatted, address };
  }

  // --- routing --------------------------------------------------------------

  async route(request: RouteRequest): Promise<GeoResult<RoutedRoute>> {
    const failure = this.injectedFailure<RoutedRoute>();
    if (failure) return failure;

    const parsed = RouteRequestSchema.safeParse(request);
    if (!parsed.success) {
      return {
        ok: false,
        code: GeoErrorCode.InvalidRequest,
        message: 'malformed route request',
        providerRaw: parsed.error,
      };
    }
    const { stops, departAt, trafficAware } = parsed.data;

    const stray = stops.find((stop) => !isWithinIsrael(stop));
    if (stray) {
      return {
        ok: false,
        code: GeoErrorCode.OutsideServiceArea,
        message: `stop ${stray.lat},${stray.lng} is outside Israel`,
      };
    }

    const clock = this.departureFor(departAt, trafficAware);
    const legs: RouteLeg[] = [];
    for (let i = 1; i < stops.length; i += 1) {
      const from = stops[i - 1];
      const to = stops[i];
      // `stops` is length-checked by the schema; this satisfies the compiler
      // without an assertion, which the house rules do not allow.
      if (!from || !to) continue;
      legs.push(this.leg(from, to, clock));
    }

    return {
      ok: true,
      value: {
        distanceMeters: totalDistanceMeters(legs),
        durationSeconds: totalDurationSeconds(legs),
        legs,
        // The fake routes; it never estimates. There is no honest way to
        // approximate a road network, and `distanceForPricing` would refuse the
        // result anyway.
        isEstimated: false,
        providerId: GeoProviderId.Fake,
      },
    };
  }

  async matrix(request: RouteMatrixRequest): Promise<GeoResult<readonly RouteMatrixEntry[]>> {
    const failure = this.injectedFailure<readonly RouteMatrixEntry[]>();
    if (failure) return failure;

    if (request.origins.length === 0 || request.destinations.length === 0) {
      return {
        ok: false,
        code: GeoErrorCode.InvalidRequest,
        message: 'a route matrix needs at least one origin and one destination',
      };
    }

    const clock = this.departureFor(request.departAt ?? null, request.trafficAware ?? false);
    const entries: RouteMatrixEntry[] = [];
    request.origins.forEach((origin, originIndex) => {
      request.destinations.forEach((destination, destinationIndex) => {
        const reachable = isWithinIsrael(origin) && isWithinIsrael(destination);
        entries.push({
          originIndex,
          destinationIndex,
          leg: reachable ? this.leg(origin, destination, clock) : null,
        });
      });
    });
    return { ok: true, value: entries };
  }

  /**
   * Traffic-aware routing needs a departure time; free-flow routing must not
   * have one, or the same request would return a different duration each hour
   * and nothing could be asserted about it.
   */
  private departureFor(departAt: Date | null, trafficAware: boolean): Date | null {
    if (!trafficAware) return null;
    return departAt ?? this.now();
  }

  private leg(from: LatLng, to: LatLng, departAt: Date | null): RouteLeg {
    const straight = straightLineMeters(from, to);
    if (straight === 0) {
      return { distanceMeters: 0, durationSeconds: 0, polyline: null, isEstimated: false };
    }
    // `straight + 1` floor: routed distance strictly exceeds the crow's flight,
    // always, so a test can assert the distinction on any pair of pins.
    const distanceMeters = Math.max(
      straight + 1,
      Math.round(straight * detourFactor(from, to, straight)),
    );
    const metersPerSecond = speedKmh(departAt, straight) / 3.6;
    return {
      distanceMeters,
      durationSeconds: Math.max(1, Math.round(distanceMeters / metersPerSecond)),
      // A fake polyline would be a lie a map could draw. Null says "no shape".
      polyline: null,
      isEstimated: false,
    };
  }

  // --- test helpers ---------------------------------------------------------

  /** Every street the fake will match, for tests that need real seeded geography. */
  seededStreets(): readonly SeedStreet[] {
    return this.streets.map((street) => street.seed);
  }
}

/**
 * A מיקוד with the right city prefix and four made-up digits.
 *
 * Real enough to exercise a form and a schema, useless for post. Israel Post is
 * the only authority for the last four digits and we do not have that data, so
 * the fake is honest about inventing them rather than shipping a plausible
 * wrong number into a database that later gets exported.
 */
function syntheticPostalCode(street: SeedStreet, houseNumber: string): string {
  const suffix = hash32(`${street.id}:${houseNumber}`) % 10_000;
  return `${street.postalPrefix}${String(suffix).padStart(4, '0')}`;
}
