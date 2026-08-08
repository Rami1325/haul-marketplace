/**
 * ---------------------------------------------------------------------------
 * Solar events
 * ---------------------------------------------------------------------------
 * Shabbat does not begin at midnight. It begins at candle lighting, which is a
 * fixed offset before sunset, and sunset in Tel Aviv moves by nearly two hours
 * across the year. A booking calendar that hardcodes "Friday after 16:00 is
 * blocked" is wrong for half the year in one direction and the other half in
 * the other.
 *
 * This is the standard sunrise/sunset approximation from the Almanac for
 * Computers — accurate to about a minute at Israeli latitudes, which is well
 * inside the eighteen-minute cushion that candle lighting already builds in.
 *
 * Everything returned is UTC. Local wall-clock conversion goes through Intl
 * with the Asia/Jerusalem zone, so Israeli DST is handled by the platform
 * rather than by rules hardcoded here that would drift when the Knesset
 * changes them.
 * ---------------------------------------------------------------------------
 */

import { fixedToGregorian, gregorianToFixed } from './hebrew.js';

const DEG = Math.PI / 180;

const sin = (deg: number) => Math.sin(deg * DEG);
const cos = (deg: number) => Math.cos(deg * DEG);
const tan = (deg: number) => Math.tan(deg * DEG);
const asin = (x: number) => Math.asin(x) / DEG;
const acos = (x: number) => Math.acos(x) / DEG;
const atan = (x: number) => Math.atan(x) / DEG;

function normaliseDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function normaliseHours(value: number): number {
  return ((value % 24) + 24) % 24;
}

export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

/** Standard zenith for sunrise/sunset, including atmospheric refraction. */
export const ZENITH_OFFICIAL = 90.833333;

export type SolarEvent = 'sunrise' | 'sunset';

/**
 * UTC hour-of-day (as a fraction) for the given solar event, or null when the
 * sun neither rises nor sets that day. Israel never hits the null case; the
 * check exists so the function is honest if the codebase ever moves north.
 */
export function solarEventUtcHours(
  fixed: number,
  location: GeoPoint,
  event: SolarEvent,
  zenith: number = ZENITH_OFFICIAL,
): number | null {
  const { year } = fixedToGregorian(fixed);
  const dayOfYear = fixed - gregorianToFixed(year, 1, 1) + 1;

  const lngHour = location.lng / 15;
  const approxTime = dayOfYear + ((event === 'sunset' ? 18 : 6) - lngHour) / 24;

  // Sun's mean anomaly, then its true longitude.
  const meanAnomaly = 0.9856 * approxTime - 3.289;
  const trueLongitude = normaliseDegrees(
    meanAnomaly + 1.916 * sin(meanAnomaly) + 0.02 * sin(2 * meanAnomaly) + 282.634,
  );

  // Right ascension, forced into the same quadrant as the true longitude.
  let rightAscension = normaliseDegrees(atan(0.91764 * tan(trueLongitude)));
  const longitudeQuadrant = Math.floor(trueLongitude / 90) * 90;
  const ascensionQuadrant = Math.floor(rightAscension / 90) * 90;
  rightAscension = (rightAscension + (longitudeQuadrant - ascensionQuadrant)) / 15;

  const sinDeclination = 0.39782 * sin(trueLongitude);
  const cosDeclination = cos(asin(sinDeclination));

  const cosHourAngle =
    (cos(zenith) - sinDeclination * sin(location.lat)) / (cosDeclination * cos(location.lat));

  // Polar day or polar night.
  if (cosHourAngle > 1 || cosHourAngle < -1) return null;

  const hourAngle = (event === 'sunset' ? acos(cosHourAngle) : 360 - acos(cosHourAngle)) / 15;

  const localMeanTime = hourAngle + rightAscension - 0.06571 * approxTime - 6.622;
  return normaliseHours(localMeanTime - lngHour);
}

/** The solar event as an absolute instant. */
export function solarEventAt(
  fixed: number,
  location: GeoPoint,
  event: SolarEvent,
  zenith: number = ZENITH_OFFICIAL,
): Date | null {
  const hours = solarEventUtcHours(fixed, location, event, zenith);
  if (hours === null) return null;

  const { year, month, day } = fixedToGregorian(fixed);
  const ms = Date.UTC(year, month - 1, day) + Math.round(hours * 3_600_000);
  return new Date(ms);
}

export function sunsetAt(fixed: number, location: GeoPoint): Date | null {
  return solarEventAt(fixed, location, 'sunset');
}

export function sunriseAt(fixed: number, location: GeoPoint): Date | null {
  return solarEventAt(fixed, location, 'sunrise');
}

/**
 * Candle lighting — when Shabbat or a festival begins for scheduling purposes.
 *
 * Most of Israel lights 18–20 minutes before sunset; Jerusalem's custom is 40.
 * The offset is a parameter rather than a constant because getting it wrong in
 * Jerusalem means offering a booking window during Shabbat, which is not a
 * scheduling bug so much as a reputational one.
 */
export function candleLightingAt(
  fixed: number,
  location: GeoPoint,
  minutesBeforeSunset: number,
): Date | null {
  const sunset = sunsetAt(fixed, location);
  if (!sunset) return null;
  return new Date(sunset.getTime() - minutesBeforeSunset * 60_000);
}

/**
 * Nightfall (צאת הכוכבים) — when Shabbat or a festival ends and dispatch can
 * resume. Motzei Shabbat is a genuine working window in Israel, not dead time,
 * so this boundary is worth computing properly rather than rounding to "Sunday".
 */
export function nightfallAt(
  fixed: number,
  location: GeoPoint,
  minutesAfterSunset: number,
): Date | null {
  const sunset = sunsetAt(fixed, location);
  if (!sunset) return null;
  return new Date(sunset.getTime() + minutesAfterSunset * 60_000);
}
