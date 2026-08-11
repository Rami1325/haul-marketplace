import { haversineMeters, type LatLng } from '@haul/types';

/**
 * ---------------------------------------------------------------------------
 * Straight-line distance — NOT FOR PRICING
 * ---------------------------------------------------------------------------
 * Locked decision 9: distance is kilometres **via a routing API, not
 * straight-line**. Everything in this file computes the crow's answer, and the
 * crow does not pay for the fuel.
 *
 * The gap is not academic. Central Tel Aviv is a one-way grid wrapped around
 * the Ayalon, and a routed leg there runs roughly 1.2–1.5× the straight line;
 * across the river-less but bridge-poor stretch between Bnei Brak and Givatayim
 * it is worse. Pricing a move off the crow's number undercharges every job and
 * undercharges the awkward ones most — which are exactly the jobs a driver
 * would rather refuse.
 *
 * So this module exists for three legitimate uses and no others:
 *
 *   1. ranking autocomplete suggestions against a bias point,
 *   2. the dispatch shortlist — "which drivers are worth asking the router
 *      about", the same job PostGIS does in `@haul/db`,
 *   3. sanity-checking a routed answer (see `isImplausiblyDirect`).
 *
 * The names are long on purpose. `straightLineMeters` reads as a distance;
 * `straightLineMetersNotForPricing` reads as a decision, and a decision is
 * harder to paste into a quote by accident.
 * ---------------------------------------------------------------------------
 */

/**
 * Great-circle metres between two points. Ranking and radius filters only.
 *
 * Delegates to `@haul/types` so there is exactly one haversine in the codebase
 * — a second one is a second place for the pricing engine to be wired to the
 * wrong number.
 */
export function straightLineMetersNotForPricing(a: LatLng, b: LatLng): number {
  return haversineMeters(a, b);
}

/**
 * Routed metres ÷ straight-line metres. Urban road networks land between about
 * 1.2 and 1.6; motorway-dominated inter-city legs come down toward 1.1.
 */
export function circuityRatio(routedMeters: number, straightMeters: number): number {
  if (straightMeters <= 0) return 1;
  return routedMeters / straightMeters;
}

/**
 * Below this ratio a "routed" distance is more likely to be a haversine number
 * that leaked through an adapter than a real road. Chosen low deliberately —
 * this is a tripwire for a wiring mistake, not an opinion about Tel Aviv's
 * street grid.
 */
export const MIN_PLAUSIBLE_CIRCUITY = 1.02;

/**
 * Legs shorter than this are exempt: a 200 m hop down one street genuinely is
 * a straight line, and flagging it would train everyone to ignore the flag.
 */
export const CIRCUITY_CHECK_FLOOR_METERS = 500;

/**
 * True when a routed distance is suspiciously close to the crow's flight.
 *
 * The failure this catches is the one decision 9 is written against: an adapter
 * that falls back to haversine on error, returns it as a routed distance, and
 * quietly underprices every job until someone reads a ledger. Ops should alert
 * on it; tests assert the fake never trips it.
 */
export function isImplausiblyDirect(routedMeters: number, straightMeters: number): boolean {
  if (straightMeters < CIRCUITY_CHECK_FLOOR_METERS) return false;
  return circuityRatio(routedMeters, straightMeters) < MIN_PLAUSIBLE_CIRCUITY;
}
