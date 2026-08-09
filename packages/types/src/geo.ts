import { z } from 'zod';

/**
 * ---------------------------------------------------------------------------
 * Geography & addresses
 * ---------------------------------------------------------------------------
 * Distance in HAUL is always metres (integer), surfaced as kilometres. Never
 * straight-line: a routed distance is the only honest input to a locked price,
 * because Tel Aviv traffic and one-way streets don't care about the crow.
 * ---------------------------------------------------------------------------
 */

export const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLngSchema>;

/** Rough bounding box for Israel. Used to warn ops about bad geocodes, not to reject. */
const IL_BOUNDS = { minLat: 29.4, maxLat: 33.4, minLng: 34.2, maxLng: 35.95 } as const;

export function isWithinIsrael(point: LatLng): boolean {
  return (
    point.lat >= IL_BOUNDS.minLat &&
    point.lat <= IL_BOUNDS.maxLat &&
    point.lng >= IL_BOUNDS.minLng &&
    point.lng <= IL_BOUNDS.maxLng
  );
}

/**
 * Israeli addresses need more parts than a US one. A Tel Aviv building routinely
 * has multiple entrances (כניסה א/ב), and "דירה 5, כניסה ב" is the difference
 * between a driver finding the door and phoning the customer from the street.
 */
export const AddressSchema = z.object({
  /** רחוב */
  street: z.string().min(1).max(200),
  /** מספר בית — string because "12א" and "12/3" are both normal here */
  houseNumber: z.string().min(1).max(20),
  /** כניסה */
  entrance: z.string().max(20).nullable().default(null),
  /** דירה */
  apartment: z.string().max(20).nullable().default(null),
  /** עיר */
  city: z.string().min(1).max(120),
  /** מיקוד — 7 digits since the 2013 reform; older 5-digit codes still appear */
  postalCode: z
    .string()
    .regex(/^\d{5}(\d{2})?$/, 'Israeli postal codes are 5 or 7 digits')
    .nullable()
    .default(null),
  countryCode: z.literal('IL').default('IL'),

  coordinates: LatLngSchema,
  /** Google Places id, so a repeat booking resolves to the identical pin. */
  placeId: z.string().max(300).nullable().default(null),
  /** Single-line rendering as returned by the geocoder, for display. */
  formatted: z.string().max(500),
  /** "קוד שער 1234", "מאחורי בית המרקחת" — free text the driver sees on arrival. */
  notes: z.string().max(500).nullable().default(null),
});
export type Address = z.infer<typeof AddressSchema>;

/** A routed leg between two points. Distance is metres, duration is seconds. */
export const RouteLegSchema = z.object({
  distanceMeters: z.number().int().min(0),
  durationSeconds: z.number().int().min(0),
  /** Encoded polyline for drawing the route. */
  polyline: z.string().nullable().default(null),
  /** True when the routing provider failed and we fell back to an estimate. */
  isEstimated: z.boolean().default(false),
});
export type RouteLeg = z.infer<typeof RouteLegSchema>;

export function metersToKm(meters: number): number {
  return meters / 1000;
}

/** Display helper — "8.4 ק״מ". One decimal is as precise as anyone needs. */
export function formatKm(meters: number, locale: 'he' | 'en' = 'he'): string {
  const km = (meters / 1000).toFixed(1);
  return locale === 'he' ? `${km} ק״מ` : `${km} km`;
}

/**
 * Haversine distance in metres. For ranking and radius filters only — never for
 * pricing. The pricing engine takes a routed distance or refuses to quote.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
