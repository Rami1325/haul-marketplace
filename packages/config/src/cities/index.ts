import {
  TEL_AVIV,
  type CalendarLocation,
  type OperatingHours,
  DEFAULT_OPERATING_HOURS,
} from '@haul/calendar';
import type { RateCard } from '@haul/pricing';
import { haversineMeters, type LatLng, type Locale } from '@haul/types';
import { TEL_AVIV_RATE_CARD } from './tel-aviv.js';

/**
 * A city is the unit of expansion.
 *
 * Everything market-shaped hangs off this object — rates, calendar, operating
 * hours, launch geography — so opening a second city is adding a record here
 * rather than a sweep through the codebase looking for hardcoded assumptions.
 */
export interface CityConfig {
  id: string;
  nameHe: string;
  nameEn: string;
  locale: Locale;
  rateCard: RateCard;
  /** Coordinates plus candle-lighting custom, which differs by city. */
  calendar: CalendarLocation;
  operatingHours: OperatingHours;
  /**
   * Launch geography. The plan is explicit: density beats coverage, and a
   * marketplace that works in three postcodes beats one that half-works across
   * a city. This is the cluster, not the metro.
   */
  launchArea: {
    centre: { lat: number; lng: number };
    radiusMeters: number;
    neighbourhoodsHe: readonly string[];
  };
  /**
   * How far past the launch cluster we will still send a truck.
   *
   * Modelled separately from `launchArea` because they answer different
   * questions. `launchArea` is where we concentrate supply and what the
   * marketing says. This is where a booking is still a booking rather than a
   * lead — a job in Givatayim is an hour's drive nobody minds, a job in Haifa
   * is a different city.
   *
   * The inner edge is `launchArea.radiusMeters`, deliberately not repeated
   * here: two radii that are supposed to be the same number eventually are not.
   */
  serviceArea: {
    /** Outer edge, from `launchArea.centre`. Beyond it we say so. */
    servedRadiusMeters: number;
    /** Names the wider area in the notice, so the copy is not hardcoded per city. */
    servedNameHe: string;
    servedNameEn: string;
  };
  isLive: boolean;
}

export const TEL_AVIV_CITY: CityConfig = {
  id: 'tel-aviv',
  nameHe: 'תל אביב והמרכז',
  nameEn: 'Tel Aviv & Gush Dan',
  locale: 'he',
  rateCard: TEL_AVIV_RATE_CARD,
  calendar: TEL_AVIV,
  operatingHours: DEFAULT_OPERATING_HOURS,
  launchArea: {
    // Central Tel Aviv. Deliberately tight — three postcodes that work beat a
    // city that half-works, and every kilometre of radius dilutes driver density.
    centre: { lat: 32.0785, lng: 34.7742 },
    radiusMeters: 4_000,
    neighbourhoodsHe: [
      'לב תל אביב',
      'הצפון הישן',
      'פלורנטין',
      'נווה צדק',
      'כרם התימנים',
      'מונטיפיורי',
    ],
  },
  serviceArea: {
    // Gush Dan as a driver understands it: Herzliya to Bat Yam, out to Petah
    // Tikva. Past that the return leg costs more than the job earns, and the
    // truck is out of the cluster for the rest of the day.
    servedRadiusMeters: 18_000,
    servedNameHe: 'גוש דן',
    servedNameEn: 'Gush Dan',
  },
  isLive: false,
};

export const CITIES: readonly CityConfig[] = [TEL_AVIV_CITY];

/**
 * The city a surface falls back to when nothing has selected one yet.
 *
 * Exported as the object and the id derived from it, rather than the other way
 * round. A caller holding only `DEFAULT_CITY_ID` has to look the city back up
 * and then deal with `cityById` returning `undefined` for the one id that
 * cannot be missing — which is a non-null assertion in every consumer, or a
 * throw at module scope in the unlucky ones.
 */
export const DEFAULT_CITY: CityConfig = TEL_AVIV_CITY;

export const DEFAULT_CITY_ID = DEFAULT_CITY.id;

export function cityById(id: string): CityConfig | undefined {
  return CITIES.find((city) => city.id === id);
}

/**
 * How well a city covers a point.
 *
 * Three answers rather than two, because the honest answer at launch is "one
 * neighbourhood cluster inside Gush Dan" and that boundary is fuzzy. A binary
 * in/out forces the fuzziness onto a customer in Givatayim, who is a job we
 * want.
 */
export const ServiceCoverage = {
  /** Inside the launch cluster. Book it and say nothing. */
  Core: 'core',
  /** Outside the cluster, inside the metro. Book it and say so. */
  Fringe: 'fringe',
  /** Somewhere we do not work yet. Still take the request. */
  Outside: 'outside',
} as const;
export type ServiceCoverage = (typeof ServiceCoverage)[keyof typeof ServiceCoverage];

export interface ServiceAreaCheck {
  cityId: string;
  coverage: ServiceCoverage;
  /**
   * Straight-line metres from the city centre. For this decision only — a price
   * is never computed from a crow-flies distance, `routedDistanceMeters` is.
   */
  distanceMeters: number;
  /**
   * What to show the customer, or null when there is nothing to say.
   *
   * A sentence, not an error code: this is copy the booking flow renders beside
   * the address, and it is the whole point of the function.
   */
  noticeHe: string | null;
  noticeEn: string | null;
}

/**
 * Where a point sits relative to a city's service area, with the sentence to
 * show for it.
 *
 * NOT A GATE. Nothing here refuses a booking, and the booking flow must not
 * turn `Outside` into a disabled button. At launch the served area is a handful
 * of postcodes with a soft edge, and a hard block on a soft edge throws away
 * the jobs a dispatcher would happily have taken by hand — which, in the first
 * hundred jobs, is most of the evidence about where the edge actually is. The
 * customer in Haifa gets told plainly that we are not there yet; they do not
 * get a dead screen.
 */
export function serviceAreaFor(point: LatLng, city: CityConfig): ServiceAreaCheck {
  const distanceMeters = haversineMeters(point, city.launchArea.centre);
  const { servedNameHe, servedNameEn } = city.serviceArea;

  if (distanceMeters <= city.launchArea.radiusMeters) {
    return {
      cityId: city.id,
      coverage: ServiceCoverage.Core,
      distanceMeters,
      noticeHe: null,
      noticeEn: null,
    };
  }

  if (distanceMeters <= city.serviceArea.servedRadiusMeters) {
    return {
      cityId: city.id,
      coverage: ServiceCoverage.Fringe,
      distanceMeters,
      noticeHe: `הכתובת מחוץ לאזור ההשקה שלנו אך בתוך ${servedNameHe} — נוכל לקחת את ההובלה, ייתכן שניצור קשר לתיאום.`,
      noticeEn: `Outside our launch cluster but still inside ${servedNameEn} — we can take this job, we may call to arrange it.`,
    };
  }

  return {
    cityId: city.id,
    coverage: ServiceCoverage.Outside,
    distanceMeters,
    noticeHe: `עדיין לא פועלים בכתובת הזו. כרגע אנחנו מובילים ב${servedNameHe} — אפשר להשאיר בקשה ונחזור אליכם.`,
    noticeEn: `We are not working at this address yet. For now we move within ${servedNameEn} — leave the request and we will come back to you.`,
  };
}

/**
 * True when the address is somewhere this city drives — core or fringe.
 *
 * The convenience form, for a caller that only needs the flag: a driver-radius
 * filter, an analytics bucket. A customer-facing screen wants `serviceAreaFor`
 * instead, because true here still covers "we will call you to arrange it" and
 * false does not mean refused.
 */
export function isInServiceArea(point: LatLng, city: CityConfig): boolean {
  return serviceAreaFor(point, city).coverage !== ServiceCoverage.Outside;
}
