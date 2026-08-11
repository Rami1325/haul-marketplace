import { z } from 'zod';
import { AddressSchema, LatLngSchema, LocaleSchema, type Address, type LatLng } from '@haul/types';
import type { GeoProviderId, GeoResult } from './result.js';

/**
 * ---------------------------------------------------------------------------
 * Places — turning what a customer types into somewhere a truck can go
 * ---------------------------------------------------------------------------
 * Hebrew is the input, not a translation of the input. "דיזנגוף 50",
 * "רח' הרצל 12א", "אבן גבירול 30 תל אביב" all have to work, and so does a
 * customer who switches to Latin halfway through because their keyboard did.
 *
 * The part worth stating plainly: **no geocoder in the world knows the
 * entrance.** Google returns a street, a number, a city and a pin. It does not
 * return כניסה ב, it does not return דירה 5, and on a Tel Aviv building with
 * three entrances off two streets that is the difference between a driver at
 * the door and a driver phoning from the pavement. Those fields come from the
 * booking form and are joined to the geocode by `withAccessDetails` — which is
 * why `PlaceDetails.address` always carries them as null.
 * ---------------------------------------------------------------------------
 */

/**
 * How well the provider pinned the place. Dispatch cares: a street centroid
 * sends the truck to the middle of דיזנגוף, which is a kilometre from either
 * end of it.
 */
export const GeocodePrecision = {
  /** The building. Safe to dispatch to. */
  Rooftop: 'rooftop',
  /** Interpolated along the street from the house number. Usually within a few doors. */
  Interpolated: 'interpolated',
  /** The street, not a building. Ask for a house number before quoting. */
  Street: 'street',
  /** A city or neighbourhood centroid. Never dispatchable. */
  Locality: 'locality',
} as const;
export type GeocodePrecision = (typeof GeocodePrecision)[keyof typeof GeocodePrecision];

/**
 * Whether we would send a truck to this pin. The quote flow gates on it, so a
 * street-level match cannot become a booked job without a house number.
 */
export function isDispatchable(precision: GeocodePrecision): boolean {
  return precision === GeocodePrecision.Rooftop || precision === GeocodePrecision.Interpolated;
}

export const AddressSuggestionSchema = z.object({
  /** Provider handle. The only thing to send back to `details()`. */
  placeId: z.string().min(1).max(300),
  /** Full single line, in the requested language. */
  description: z.string().min(1).max(500),
  /** "דיזנגוף 50" — the line the UI bolds. */
  primaryText: z.string().max(300),
  /** "תל אביב-יפו" — the quieter second line. */
  secondaryText: z.string().max(300),
  precision: z.enum([
    GeocodePrecision.Rooftop,
    GeocodePrecision.Interpolated,
    GeocodePrecision.Street,
    GeocodePrecision.Locality,
  ]),
  /**
   * Straight-line metres from the bias point, when one was given. Ranking only
   * — see `distance.ts`. Never a routed number and never an input to a price.
   */
  straightLineMetersFromBias: z.number().int().min(0).nullable(),
});
export type AddressSuggestion = z.infer<typeof AddressSuggestionSchema>;

export const PlaceDetailsSchema = z.object({
  placeId: z.string().min(1).max(300),
  precision: z.enum([
    GeocodePrecision.Rooftop,
    GeocodePrecision.Interpolated,
    GeocodePrecision.Street,
    GeocodePrecision.Locality,
  ]),
  coordinates: LatLngSchema,
  formatted: z.string().max(500),
  /**
   * Null for a street or an area: there is no building, so there is nothing a
   * driver could be sent to. Callers must handle it rather than defaulting the
   * house number to "1".
   *
   * When present, `entrance`, `apartment` and `notes` are always null — the
   * geocoder cannot know them.
   */
  address: AddressSchema.nullable(),
});
export type PlaceDetails = z.infer<typeof PlaceDetailsSchema>;

/**
 * Join the geocoder's half of an address to the customer's half.
 *
 * Kept as a named function rather than an object spread at each call site so
 * that "where do כניסה and דירה come from" has exactly one answer, and so that
 * a future provider claiming to return them has one place to be wired in.
 */
export function withAccessDetails(
  address: Address,
  parts: {
    /** כניסה */
    entrance?: string | null;
    /** דירה */
    apartment?: string | null;
    /** "קוד שער 1234" — what the driver reads on arrival. */
    notes?: string | null;
  },
): Address {
  return {
    ...address,
    entrance: parts.entrance ?? address.entrance,
    apartment: parts.apartment ?? address.apartment,
    notes: parts.notes ?? address.notes,
  };
}

// --- requests ---------------------------------------------------------------

export const AutocompleteRequestSchema = z.object({
  /** Raw user input, exactly as typed. Normalisation is the provider's job. */
  query: z.string().max(300),
  /** Language the suggestions come back in. Hebrew unless told otherwise. */
  language: LocaleSchema.default('he'),
  /**
   * Bias toward where the customer is booking, without restricting to it.
   * Restricting would break the common case of moving out of the launch area.
   */
  bias: z
    .object({ centre: LatLngSchema, radiusMeters: z.number().int().min(100).max(200_000) })
    .nullable()
    .default(null),
  /**
   * Groups a burst of keystrokes into one billable session at the provider.
   * Opaque to us; the caller mints one per address field and drops it after
   * `details()`.
   */
  sessionToken: z.string().max(128).nullable().default(null),
  limit: z.number().int().min(1).max(20).default(5),
});
export type AutocompleteRequest = z.input<typeof AutocompleteRequestSchema>;

export interface PlaceDetailsOptions {
  language?: 'he' | 'en';
  sessionToken?: string | null;
}

// --- the interface ----------------------------------------------------------

export interface PlacesProvider {
  readonly id: GeoProviderId;

  /**
   * Whether the provider bills a burst of keystrokes as one session. Drives how
   * aggressively the UI may debounce — with sessions, per-keystroke lookups are
   * affordable; without them, they are the largest line on the maps invoice.
   */
  readonly supportsSessionTokens: boolean;

  /** As-you-type suggestions. Must accept Hebrew, Latin, and a mixture. */
  autocomplete(request: AutocompleteRequest): Promise<GeoResult<readonly AddressSuggestion[]>>;

  /** Resolve a suggestion into coordinates and address parts. */
  details(placeId: string, options?: PlaceDetailsOptions): Promise<GeoResult<PlaceDetails>>;

  /**
   * A dropped pin back into an address — the driver app's "I'm here", and the
   * ops console fixing a customer's typo against where the truck actually went.
   */
  reverseGeocode(point: LatLng, options?: PlaceDetailsOptions): Promise<GeoResult<PlaceDetails>>;
}
