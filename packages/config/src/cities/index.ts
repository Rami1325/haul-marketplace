import {
  TEL_AVIV,
  type CalendarLocation,
  type OperatingHours,
  DEFAULT_OPERATING_HOURS,
} from '@haul/calendar';
import type { RateCard } from '@haul/pricing';
import type { Locale } from '@haul/types';
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
  isLive: false,
};

export const CITIES: readonly CityConfig[] = [TEL_AVIV_CITY];

export const DEFAULT_CITY_ID = TEL_AVIV_CITY.id;

export function cityById(id: string): CityConfig | undefined {
  return CITIES.find((city) => city.id === id);
}
