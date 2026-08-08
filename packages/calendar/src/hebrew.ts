/**
 * ---------------------------------------------------------------------------
 * The Hebrew calendar
 * ---------------------------------------------------------------------------
 * Implemented rather than imported. Every published Hebrew-calendar package on
 * npm is GPL-2.0 or LGPL — copyleft, and wrong to link into a proprietary
 * product. The arithmetic itself is a fixed, publicly specified algorithm
 * (the Rambam's rules, as formalised by Dershowitz & Reingold), so owning it
 * costs about two hundred lines and removes the licence question entirely.
 *
 * Everything here works in "fixed days" (Rata Die): the count of days since the
 * proleptic Gregorian date 0001-01-01. Converting both calendars through a
 * single integer keeps the conversions symmetric and easy to test.
 * ---------------------------------------------------------------------------
 */

export interface HebrewDate {
  /** Anno Mundi, e.g. 5786. */
  year: number;
  /**
   * Month numbered from Nisan = 1, so Tishrei = 7. This is the convention the
   * classical algorithms use; the calendar's *year* begins at Tishrei but its
   * *months* are counted from Nisan, and fighting that costs more than it saves.
   * In a leap year, 12 = Adar I and 13 = Adar II.
   */
  month: number;
  day: number;
}

export const HebrewMonth = {
  Nisan: 1,
  Iyar: 2,
  Sivan: 3,
  Tammuz: 4,
  Av: 5,
  Elul: 6,
  Tishrei: 7,
  Cheshvan: 8,
  Kislev: 9,
  Tevet: 10,
  Shvat: 11,
  /** Adar in a plain year; Adar I in a leap year. */
  Adar: 12,
  /** Adar II. Only exists in a leap year. */
  AdarII: 13,
} as const;

/**
 * RD of 1 Tishrei, year 1 AM — i.e. 7 October 3761 BCE in the Julian calendar.
 * Verified against known anchors rather than trusted: 1 Tishrei 5786 must land
 * on RD 739517 (23 September 2025, a Tuesday), and it does.
 */
const HEBREW_EPOCH = -1373427;

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

// --- Gregorian ↔ fixed ------------------------------------------------------

export function isGregorianLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** Gregorian calendar date → Rata Die. */
export function gregorianToFixed(year: number, month: number, day: number): number {
  const priorYear = year - 1;
  return (
    365 * priorYear +
    floorDiv(priorYear, 4) -
    floorDiv(priorYear, 100) +
    floorDiv(priorYear, 400) +
    floorDiv(367 * month - 362, 12) +
    (month <= 2 ? 0 : isGregorianLeapYear(year) ? -1 : -2) +
    day
  );
}

/** Rata Die → Gregorian calendar date. */
export function fixedToGregorian(fixed: number): { year: number; month: number; day: number } {
  const d0 = fixed - 1;
  const n400 = floorDiv(d0, 146097);
  const d1 = d0 - n400 * 146097;
  const n100 = floorDiv(d1, 36524);
  const d2 = d1 - n100 * 36524;
  const n4 = floorDiv(d2, 1461);
  const d3 = d2 - n4 * 1461;
  const n1 = floorDiv(d3, 365);

  const year =
    400 * n400 + 100 * n100 + 4 * n4 + n1 + (n100 === 4 || n1 === 4 ? 0 : 1);

  // Recover month and day by walking back from the start of the year.
  const priorDays = fixed - gregorianToFixed(year, 1, 1);
  const correction =
    fixed < gregorianToFixed(year, 3, 1) ? 0 : isGregorianLeapYear(year) ? 1 : 2;
  const month = floorDiv(12 * (priorDays + correction) + 373, 367);
  const day = fixed - gregorianToFixed(year, month, 1) + 1;

  return { year, month, day };
}

// --- Hebrew year structure --------------------------------------------------

/** Seven leap years in every nineteen. */
export function isHebrewLeapYear(year: number): boolean {
  return ((7 * year + 1) % 19) < 7;
}

export function lastMonthOfHebrewYear(year: number): number {
  return isHebrewLeapYear(year) ? HebrewMonth.AdarII : HebrewMonth.Adar;
}

/**
 * Days elapsed from the epoch to Rosh Hashana of `year`, before the postponement
 * rules (dehiyot) are applied. Derived from the molad — the mean lunar
 * conjunction — reckoned in parts, where an hour is 1080 parts.
 */
function hebrewCalendarElapsedDays(year: number): number {
  const monthsElapsed = floorDiv(235 * year - 234, 19);
  const partsElapsed = 12084 + 13753 * monthsElapsed;
  const day = 29 * monthsElapsed + floorDiv(partsElapsed, 25920);
  // Dehiyah: Rosh Hashana never falls on Sunday, Wednesday or Friday.
  return (3 * (day + 1)) % 7 < 3 ? day + 1 : day;
}

/**
 * The remaining postponements, expressed as a correction of 0, 1 or 2 days.
 * These exist to keep every year to a legal length: no year may be 356 days
 * (too long) or 382 (too short), so the boundary shifts to absorb it.
 */
function hebrewYearLengthCorrection(year: number): number {
  const prior = hebrewCalendarElapsedDays(year - 1);
  const current = hebrewCalendarElapsedDays(year);
  const next = hebrewCalendarElapsedDays(year + 1);
  if (next - current === 356) return 2;
  if (current - prior === 382) return 1;
  return 0;
}

/** RD of 1 Tishrei of the given Hebrew year. */
export function hebrewNewYear(year: number): number {
  return HEBREW_EPOCH + hebrewCalendarElapsedDays(year) + hebrewYearLengthCorrection(year);
}

export function daysInHebrewYear(year: number): number {
  return hebrewNewYear(year + 1) - hebrewNewYear(year);
}

/** In a "complete" year Cheshvan gains a thirtieth day. */
export function isLongCheshvan(year: number): boolean {
  return daysInHebrewYear(year) % 10 === 5;
}

/** In a "deficient" year Kislev loses its thirtieth day. */
export function isShortKislev(year: number): boolean {
  return daysInHebrewYear(year) % 10 === 3;
}

export function lastDayOfHebrewMonth(year: number, month: number): number {
  if (
    month === HebrewMonth.Iyar ||
    month === HebrewMonth.Tammuz ||
    month === HebrewMonth.Elul ||
    month === HebrewMonth.Tevet ||
    month === HebrewMonth.AdarII
  ) {
    return 29;
  }
  if (month === HebrewMonth.Adar && !isHebrewLeapYear(year)) return 29;
  if (month === HebrewMonth.Cheshvan && !isLongCheshvan(year)) return 29;
  if (month === HebrewMonth.Kislev && isShortKislev(year)) return 29;
  return 30;
}

// --- Hebrew ↔ fixed ---------------------------------------------------------

export function hebrewToFixed(year: number, month: number, day: number): number {
  let dayCount = hebrewNewYear(year) + day - 1;

  if (month < HebrewMonth.Tishrei) {
    // Nisan..Elul fall in the *second* half of the Hebrew year, so count the
    // whole run from Tishrei to year end, then from Nisan up to this month.
    for (let m = HebrewMonth.Tishrei; m <= lastMonthOfHebrewYear(year); m++) {
      dayCount += lastDayOfHebrewMonth(year, m);
    }
    for (let m = HebrewMonth.Nisan; m < month; m++) {
      dayCount += lastDayOfHebrewMonth(year, m);
    }
  } else {
    for (let m = HebrewMonth.Tishrei; m < month; m++) {
      dayCount += lastDayOfHebrewMonth(year, m);
    }
  }

  return dayCount;
}

export function fixedToHebrew(fixed: number): HebrewDate {
  // Mean Hebrew year length is ~365.2468 days; start close and walk.
  let year = Math.floor((fixed - HEBREW_EPOCH) / 365.2468) + 1;
  while (hebrewNewYear(year + 1) <= fixed) year++;
  while (hebrewNewYear(year) > fixed) year--;

  let month = fixed < hebrewToFixed(year, HebrewMonth.Nisan, 1)
    ? HebrewMonth.Tishrei
    : HebrewMonth.Nisan;
  while (fixed > hebrewToFixed(year, month, lastDayOfHebrewMonth(year, month))) month++;

  const day = fixed - hebrewToFixed(year, month, 1) + 1;
  return { year, month, day };
}

// --- convenience over JS Date ----------------------------------------------

/** Convert a `YYYY-MM-DD` civil date string to its Hebrew equivalent. */
export function hebrewDateFromISO(iso: string): HebrewDate {
  const [y, m, d] = iso.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) {
    throw new TypeError(`hebrewDateFromISO: expected YYYY-MM-DD, got "${iso}"`);
  }
  return fixedToHebrew(gregorianToFixed(y, m, d));
}

export function isoFromHebrewDate(date: HebrewDate): string {
  const { year, month, day } = fixedToGregorian(hebrewToFixed(date.year, date.month, date.day));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Day of week for a fixed date. 0 = Sunday … 6 = Saturday. */
export function dayOfWeekFromFixed(fixed: number): number {
  return ((fixed % 7) + 7) % 7;
}
