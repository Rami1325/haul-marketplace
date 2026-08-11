import { z } from 'zod';
import { LatLngSchema, RouteLegSchema, type LatLng, type RouteLeg } from '@haul/types';
import { GeoProviderId, type GeoResult } from './result.js';

/**
 * ---------------------------------------------------------------------------
 * Routing — the distance the price is allowed to be built from
 * ---------------------------------------------------------------------------
 * Locked decision 9: kilometres, via a routing API, not straight-line.
 *
 * What actually protects that, honestly listed, because a guarantee nobody can
 * point at is worse than none:
 *
 *   · `distanceForPricing` refuses at runtime — an estimated route, an
 *     estimated leg, or a total that does not add up to its legs. That last one
 *     is the case with no flag on it: real legs, and only the number the
 *     pricing engine reads swapped for the crow's.
 *   · Naming. Straight-line distance lives in `distance.ts`, returns a plain
 *     `number` and is called `straightLineMetersNotForPricing`, so reaching for
 *     it here reads as the decision it is.
 *   · `isImplausiblyDirect` in `distance.ts`, as an ops tripwire on a distance
 *     that already got through.
 *
 * What does NOT protect it is the type system, though `RoutedMeters` below is
 * shaped to look like it does. A branded `number` is a subtype of `number`, so
 * it widens into every consumer without complaint, and no consumer asks for it:
 * `QuoteInput.routedDistanceMeters` in `@haul/pricing` is a plain `number` and
 * `BookingDraftSchema.routedDistanceMeters` in `@haul/contracts` is
 * `z.number().int()`. Until one of those two takes the brand, `RoutedMeters` is
 * a label on the way out of this package, not a lock on the way into pricing.
 *
 * Multi-stop is first-class — a move with two dropoffs is one route with two
 * legs, not two routes — because the pricing engine bills the whole trip and
 * summing independently-routed pairs double-counts the turnarounds.
 * ---------------------------------------------------------------------------
 */

declare const RoutedMetersBrand: unique symbol;

/**
 * Metres that came off a road network. The distance the pricing engine should
 * be handed — a marker for readers and for a future signature that requires it,
 * not a barrier the compiler enforces today. See the header.
 */
export type RoutedMeters = number & { readonly [RoutedMetersBrand]: true };

export const RoutedRouteSchema = z.object({
  /** Sum over every leg. Integer metres, matching `@haul/types`. */
  distanceMeters: z.number().int().min(0),
  /** Sum over every leg, seconds. Traffic-aware when the provider supports it. */
  durationSeconds: z.number().int().min(0),
  /** One per consecutive pair of stops. `stops.length - 1` of them. */
  legs: z.array(RouteLegSchema).min(1),
  /**
   * True when this is a fallback rather than a road answer. A quote built on an
   * estimate is a quote we cannot lock, so this flag is a refusal, not a hint.
   */
  isEstimated: z.boolean(),
  providerId: z.enum([GeoProviderId.Fake, GeoProviderId.Google]),
});
export type RoutedRoute = z.infer<typeof RoutedRouteSchema>;

/** Thrown when something tries to price a distance that was never routed. */
export class UnroutedDistanceError extends Error {
  constructor(reason: string) {
    super(
      `refusing to price an unrouted distance: ${reason}. ` +
        `Locked decision 9 — kilometres come from a routing API, never straight-line.`,
    );
    this.name = 'UnroutedDistanceError';
  }
}

/**
 * The one door between a route and the pricing engine.
 *
 * Throws rather than returning a result because there is no sensible recovery:
 * a caller holding an estimate must go back to the router or decline to quote,
 * and both of those are decisions for the booking flow, not for a `?? 0`.
 */
export function distanceForPricing(route: RoutedRoute): RoutedMeters {
  if (route.isEstimated) {
    throw new UnroutedDistanceError(`provider ${route.providerId} returned an estimated route`);
  }
  if (route.legs.some((leg) => leg.isEstimated)) {
    throw new UnroutedDistanceError(`provider ${route.providerId} estimated at least one leg`);
  }
  // The total is the number that becomes the price, and it is the only one an
  // adapter can substitute without setting a flag. Legs are the corroboration:
  // a haversine total against real legs is arithmetic that does not close.
  const summed = totalDistanceMeters(route.legs);
  if (route.distanceMeters !== summed) {
    throw new UnroutedDistanceError(
      `provider ${route.providerId} reported ${route.distanceMeters} m over legs summing to ${summed} m`,
    );
  }
  return route.distanceMeters as RoutedMeters;
}

// --- requests ---------------------------------------------------------------

export const RouteRequestSchema = z.object({
  /**
   * Origin, intermediates and destination, in visit order. Two minimum. The
   * cap mirrors `StopSchema` in `@haul/types` — twenty stops on one job.
   */
  stops: z.array(LatLngSchema).min(2).max(20),
  /**
   * When the truck leaves. Tel Aviv at 08:00 and Tel Aviv at 14:00 are different
   * cities, and a scheduled move is quoted for the slot it was booked into, not
   * for the moment the customer happened to open the app.
   */
  departAt: z.coerce.date().nullable().default(null),
  /**
   * Ask the provider for traffic-aware durations. Costs more per call and is
   * slower, so it is opt-in: quotes want it, a driver-shortlist matrix does not.
   */
  trafficAware: z.boolean().default(false),
  /** Draw the route on a map. Off by default — polylines are large and rarely read. */
  includePolyline: z.boolean().default(false),
});
export type RouteRequest = z.input<typeof RouteRequestSchema>;

export interface RouteMatrixRequest {
  /** Typically driver positions. */
  origins: readonly LatLng[];
  /** Typically a single pickup. */
  destinations: readonly LatLng[];
  departAt?: Date | null;
  trafficAware?: boolean;
}

export interface RouteMatrixEntry {
  originIndex: number;
  destinationIndex: number;
  /** Null when no road connects the pair — the caller drops that driver. */
  leg: RouteLeg | null;
}

// --- the interface ----------------------------------------------------------

export interface RoutingProvider {
  readonly id: GeoProviderId;

  /**
   * Whether durations account for live or historic traffic.
   *
   * Load-bearing for the arrival window, not for the price: a provider without
   * it can still price a move honestly, but its ETA is a guess and the window
   * shown to the customer has to widen to match.
   */
  readonly supportsTrafficAware: boolean;

  /** Intermediate waypoints per request, excluding origin and destination. */
  readonly maxIntermediateStops: number;

  /** One route over every stop, in order. Legs come back in the same order. */
  route(request: RouteRequest): Promise<GeoResult<RoutedRoute>>;

  /**
   * Many-to-many, for the dispatch shortlist. `@haul/db` narrows candidates by
   * PostGIS straight-line first; this turns that shortlist into real drive
   * times, because the nearest driver as the crow flies is regularly not the
   * first one to arrive.
   */
  matrix(request: RouteMatrixRequest): Promise<GeoResult<readonly RouteMatrixEntry[]>>;
}

/** Total metres across legs — used to build a `RoutedRoute`, and to check one. */
export function totalDistanceMeters(legs: readonly RouteLeg[]): number {
  return legs.reduce((acc, leg) => acc + leg.distanceMeters, 0);
}

export function totalDurationSeconds(legs: readonly RouteLeg[]): number {
  return legs.reduce((acc, leg) => acc + leg.durationSeconds, 0);
}
