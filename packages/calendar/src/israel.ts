import { DayKind } from '@haul/types';
import {
  HebrewMonth,
  dayOfWeekFromFixed,
  fixedToGregorian,
  fixedToHebrew,
  gregorianToFixed,
  hebrewToFixed,
  isHebrewLeapYear,
} from './hebrew.js';
import { candleLightingAt, nightfallAt, type GeoPoint } from './solar.js';

/**
 * ---------------------------------------------------------------------------
 * The Israeli operating calendar
 * ---------------------------------------------------------------------------
 * Answers the only calendar question the product actually asks: *can we send a
 * truck right now, and if not, when can we next?*
 *
 * Two things make this more than a weekend check:
 *
 *  1. The restricted period runs sunset-to-nightfall, not midnight-to-midnight.
 *     A civil Saturday is roughly 60% restricted and 40% prime working time —
 *     motzei Shabbat is a real moving window in Israel, and treating Saturday
 *     as a dead day throws away one of the busiest evenings of the week.
 *  2. Chol HaMoed is the opposite of a holiday for this business. The country
 *     is off work for a week and a great many people move house during it. It
 *     is a demand *spike*, and pricing should know that.
 * ---------------------------------------------------------------------------
 */

export const TIMEZONE = 'Asia/Jerusalem';

export interface CalendarLocation extends GeoPoint {
  /** Minutes before sunset that Shabbat begins. 18 for most of Israel, 40 in Jerusalem. */
  candleLightingMinutes: number;
  /** Minutes after sunset that it ends (צאת הכוכבים). */
  nightfallMinutes: number;
}

export const TEL_AVIV: CalendarLocation = {
  lat: 32.0853,
  lng: 34.7818,
  candleLightingMinutes: 18,
  nightfallMinutes: 40,
};

export const JERUSALEM: CalendarLocation = {
  lat: 31.7683,
  lng: 35.2137,
  candleLightingMinutes: 40,
  nightfallMinutes: 40,
};

export const HAIFA: CalendarLocation = {
  lat: 32.794,
  lng: 34.9896,
  candleLightingMinutes: 22,
  nightfallMinutes: 40,
};

// --- holidays ---------------------------------------------------------------

export interface HolidayInfo {
  id: string;
  nameHe: string;
  nameEn: string;
  /** Work prohibited — no dispatch at all. */
  isYomTov: boolean;
}

/**
 * Festival days on which work is prohibited. Israel keeps one day of yom tov
 * where the diaspora keeps two, which is why this list is shorter than a
 * calendar bought abroad would suggest.
 */
const YOM_TOV: ReadonlyArray<{ month: number; day: number } & HolidayInfo> = [
  { month: HebrewMonth.Tishrei, day: 1, id: 'rosh_hashana_1', nameHe: 'ראש השנה', nameEn: 'Rosh Hashana', isYomTov: true },
  { month: HebrewMonth.Tishrei, day: 2, id: 'rosh_hashana_2', nameHe: 'ראש השנה ב׳', nameEn: 'Rosh Hashana II', isYomTov: true },
  { month: HebrewMonth.Tishrei, day: 10, id: 'yom_kippur', nameHe: 'יום כיפור', nameEn: 'Yom Kippur', isYomTov: true },
  { month: HebrewMonth.Tishrei, day: 15, id: 'sukkot_1', nameHe: 'סוכות', nameEn: 'Sukkot', isYomTov: true },
  { month: HebrewMonth.Tishrei, day: 22, id: 'shmini_atzeret', nameHe: 'שמיני עצרת', nameEn: 'Shmini Atzeret', isYomTov: true },
  { month: HebrewMonth.Nisan, day: 15, id: 'pesach_1', nameHe: 'פסח', nameEn: 'Pesach', isYomTov: true },
  { month: HebrewMonth.Nisan, day: 21, id: 'pesach_7', nameHe: 'שביעי של פסח', nameEn: 'Seventh of Pesach', isYomTov: true },
  { month: HebrewMonth.Sivan, day: 6, id: 'shavuot', nameHe: 'שבועות', nameEn: 'Shavuot', isYomTov: true },
];

/** Intermediate festival days. Not work-prohibited — and a demand spike. */
function isCholHaMoed(month: number, day: number): boolean {
  if (month === HebrewMonth.Tishrei && day >= 16 && day <= 21) return true;
  if (month === HebrewMonth.Nisan && day >= 16 && day <= 20) return true;
  return false;
}

/**
 * Yom Ha'atzmaut, with the postponement rules in force since 2004. Nominally
 * 5 Iyar, but it is moved so that Yom HaZikaron — the day before it — never
 * abuts Shabbat, because the transition ceremonies cannot be held then.
 */
export function yomHaatzmautFixed(hebrewYear: number): number {
  const nominal = hebrewToFixed(hebrewYear, HebrewMonth.Iyar, 5);
  switch (dayOfWeekFromFixed(nominal)) {
    case 5: // Friday → back to Thursday
      return nominal - 1;
    case 6: // Saturday → back to Thursday
      return nominal - 2;
    case 1: // Monday → forward to Tuesday
      return nominal + 1;
    default:
      return nominal;
  }
}

/** 9 Av, pushed to the 10th when the 9th falls on Shabbat. */
export function tishaBAvFixed(hebrewYear: number): number {
  const nominal = hebrewToFixed(hebrewYear, HebrewMonth.Av, 9);
  return dayOfWeekFromFixed(nominal) === 6 ? nominal + 1 : nominal;
}

function purimFixed(hebrewYear: number): number {
  const month = isHebrewLeapYear(hebrewYear) ? HebrewMonth.AdarII : HebrewMonth.Adar;
  return hebrewToFixed(hebrewYear, month, 14);
}

export function holidayOn(fixed: number): HolidayInfo | null {
  const hebrew = fixedToHebrew(fixed);

  const yomTov = YOM_TOV.find((h) => h.month === hebrew.month && h.day === hebrew.day);
  if (yomTov) {
    return { id: yomTov.id, nameHe: yomTov.nameHe, nameEn: yomTov.nameEn, isYomTov: true };
  }

  if (fixed === yomHaatzmautFixed(hebrew.year)) {
    return { id: 'yom_haatzmaut', nameHe: 'יום העצמאות', nameEn: 'Independence Day', isYomTov: false };
  }
  if (fixed === yomHaatzmautFixed(hebrew.year) - 1) {
    return { id: 'yom_hazikaron', nameHe: 'יום הזיכרון', nameEn: 'Memorial Day', isYomTov: false };
  }
  if (fixed === tishaBAvFixed(hebrew.year)) {
    return { id: 'tisha_bav', nameHe: 'תשעה באב', nameEn: "Tisha B'Av", isYomTov: false };
  }
  if (fixed === purimFixed(hebrew.year)) {
    return { id: 'purim', nameHe: 'פורים', nameEn: 'Purim', isYomTov: false };
  }

  return null;
}

function isYomTovOn(fixed: number): boolean {
  const hebrew = fixedToHebrew(fixed);
  return YOM_TOV.some((h) => h.month === hebrew.month && h.day === hebrew.day);
}

/** Shabbat or yom tov — the days on which no truck moves. */
function isRestrictedDay(fixed: number): boolean {
  return dayOfWeekFromFixed(fixed) === 6 || isYomTovOn(fixed);
}

// --- day classification -----------------------------------------------------

export interface IsraeliDayInfo {
  /** `YYYY-MM-DD` civil date. */
  dateKey: string;
  fixed: number;
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: number;
  kind: DayKind;
  holiday: HolidayInfo | null;
  /**
   * Chol HaMoed. Dispatchable, and historically a *high* demand period —
   * the country is off work and a lot of people move house.
   */
  isCholHaMoed: boolean;
  /** Any dispatch possible at all today, even for part of the day. */
  isDispatchable: boolean;
}

export function dayInfoFor(fixed: number): IsraeliDayInfo {
  const hebrew = fixedToHebrew(fixed);
  const dayOfWeek = dayOfWeekFromFixed(fixed);
  const holiday = holidayOn(fixed);
  const gregorian = fixedToGregorian(fixed);
  const dateKey = `${String(gregorian.year).padStart(4, '0')}-${String(gregorian.month).padStart(2, '0')}-${String(gregorian.day).padStart(2, '0')}`;

  let kind: DayKind;
  if (isYomTovOn(fixed)) {
    kind = DayKind.Holiday;
  } else if (dayOfWeek === 6) {
    kind = DayKind.Shabbat;
  } else if (isYomTovOn(fixed + 1)) {
    // Erev chag. Work stops at candle lighting, exactly as on a Friday.
    kind = DayKind.HolidayEve;
  } else if (dayOfWeek === 5) {
    kind = DayKind.ShortDay;
  } else {
    kind = DayKind.Workday;
  }

  return {
    dateKey,
    fixed,
    dayOfWeek,
    kind,
    holiday,
    isCholHaMoed: isCholHaMoed(hebrew.month, hebrew.day),
    // Even Shabbat and yom tov have a dispatchable tail after nightfall,
    // unless the next day is restricted too.
    isDispatchable: kind !== DayKind.Holiday || !isRestrictedDay(fixed + 1),
  };
}

export function dayInfoForISO(iso: string): IsraeliDayInfo {
  const [y, m, d] = iso.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) {
    throw new TypeError(`dayInfoForISO: expected YYYY-MM-DD, got "${iso}"`);
  }
  return dayInfoFor(gregorianToFixed(y, m, d));
}

export function dayInfoForDate(date: Date): IsraeliDayInfo {
  return dayInfoForISO(israeliDateKey(date));
}

// --- restricted periods and dispatch windows --------------------------------

export interface Interval {
  start: Date;
  end: Date;
}

export interface RestrictedPeriod extends Interval {
  reason: string;
  reasonHe: string;
}

/**
 * The contiguous no-dispatch periods overlapping a range of civil days.
 *
 * Consecutive restricted days are merged, which is what makes a three-day
 * stretch — yom tov running straight into Shabbat — come back as one block
 * rather than two with an impossible two-hour gap between them.
 */
export function restrictedPeriodsBetween(
  fromFixed: number,
  toFixed: number,
  location: CalendarLocation,
): RestrictedPeriod[] {
  const periods: RestrictedPeriod[] = [];
  // Look one day either side so a period straddling the boundary is caught.
  let fixed = fromFixed - 1;

  while (fixed <= toFixed + 1) {
    if (!isRestrictedDay(fixed)) {
      fixed += 1;
      continue;
    }

    const runStart = fixed;
    let runEnd = fixed;
    while (isRestrictedDay(runEnd + 1)) runEnd += 1;

    // Begins at candle lighting on the eve, ends at nightfall on the last day.
    const start = candleLightingAt(runStart - 1, location, location.candleLightingMinutes);
    const end = nightfallAt(runEnd, location, location.nightfallMinutes);

    if (start && end) {
      const labels = collectRestrictionLabels(runStart, runEnd);
      periods.push({ start, end, reason: labels.en, reasonHe: labels.he });
    }

    fixed = runEnd + 1;
  }

  return periods;
}

function collectRestrictionLabels(fromFixed: number, toFixed: number): { he: string; en: string } {
  const he: string[] = [];
  const en: string[] = [];
  for (let f = fromFixed; f <= toFixed; f++) {
    if (dayOfWeekFromFixed(f) === 6) {
      if (!he.includes('שבת')) {
        he.push('שבת');
        en.push('Shabbat');
      }
      continue;
    }
    const holiday = holidayOn(f);
    if (holiday && !he.includes(holiday.nameHe)) {
      he.push(holiday.nameHe);
      en.push(holiday.nameEn);
    }
  }
  return { he: he.join(' · '), en: en.join(' · ') };
}

export interface OperatingHours {
  /** Local Jerusalem wall-clock hour dispatch opens, e.g. 7. */
  startHour: number;
  /** Local wall-clock hour dispatch closes, e.g. 21. */
  endHour: number;
  /**
   * Cushion in minutes before candle lighting after which we will not start a
   * job. A move takes hours; beginning one forty minutes before Shabbat is how
   * a crew ends up unloading in the dark on a day they will not work.
   */
  preShabbatBufferMinutes: number;
  /**
   * Discard windows shorter than this.
   *
   * Doubles as the lever for a policy question the calendar deliberately does
   * not answer: motzei Shabbat is prime moving time, but the equivalent tail
   * after Yom Kippur is technically dispatchable and commercially dead. Raising
   * this suppresses the short tails without teaching the calendar which
   * festivals people feel like moving house after.
   */
  minimumWindowMinutes: number;
}

export const DEFAULT_OPERATING_HOURS: OperatingHours = {
  startHour: 7,
  // 22:00, not 21:00. In midsummer Shabbat does not end until roughly 20:15,
  // so an earlier close would throw away motzei Shabbat — which in Israel is
  // one of the busiest moving windows of the week — for half the year.
  endHour: 22,
  preShabbatBufferMinutes: 180,
  minimumWindowMinutes: 60,
};

/**
 * Bookable windows on a given civil date: operating hours, minus any restricted
 * period, minus the pre-Shabbat cushion.
 */
export function dispatchWindowsFor(
  iso: string,
  location: CalendarLocation,
  hours: OperatingHours = DEFAULT_OPERATING_HOURS,
): Interval[] {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const fixed = gregorianToFixed(y, m, d);

  const dayStart = jerusalemWallClockToUtc(y, m, d, hours.startHour, 0);
  const dayEnd = jerusalemWallClockToUtc(y, m, d, hours.endHour, 0);

  let windows: Interval[] = [{ start: dayStart, end: dayEnd }];

  for (const period of restrictedPeriodsBetween(fixed, fixed, location)) {
    // Push the start of the block earlier by the cushion, so we never begin a
    // job that cannot finish before it lands.
    const blockedFrom = new Date(
      period.start.getTime() - hours.preShabbatBufferMinutes * 60_000,
    );
    windows = windows.flatMap((w) => subtractInterval(w, { start: blockedFrom, end: period.end }));
  }

  return windows.filter(
    (w) => w.end.getTime() - w.start.getTime() >= hours.minimumWindowMinutes * 60_000,
  );
}

function subtractInterval(window: Interval, blocked: Interval): Interval[] {
  const ws = window.start.getTime();
  const we = window.end.getTime();
  const bs = blocked.start.getTime();
  const be = blocked.end.getTime();

  if (be <= ws || bs >= we) return [window];

  const result: Interval[] = [];
  if (bs > ws) result.push({ start: window.start, end: new Date(Math.min(bs, we)) });
  if (be < we) result.push({ start: new Date(Math.max(be, ws)), end: window.end });
  return result;
}

export function isDispatchableAt(instant: Date, location: CalendarLocation): boolean {
  const fixed = gregorianToFixed(
    ...(israeliDateKey(instant).split('-').map(Number) as [number, number, number]),
  );
  return !restrictedPeriodsBetween(fixed, fixed, location).some(
    (p) => instant >= p.start && instant < p.end,
  );
}

/** The next moment dispatch resumes, if we are currently inside a restricted period. */
export function nextDispatchableAfter(instant: Date, location: CalendarLocation): Date {
  const fixed = gregorianToFixed(
    ...(israeliDateKey(instant).split('-').map(Number) as [number, number, number]),
  );
  for (const period of restrictedPeriodsBetween(fixed, fixed + 1, location)) {
    if (instant >= period.start && instant < period.end) return period.end;
  }
  return instant;
}

// --- Jerusalem wall-clock helpers -------------------------------------------

/** `YYYY-MM-DD` in Jerusalem local time. */
export function israeliDateKey(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Jerusalem's UTC offset in minutes at a given instant — DST-aware via Intl. */
export function jerusalemOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asIfUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour') % 24,
    value('minute'),
    value('second'),
  );
  return (asIfUtc - instant.getTime()) / 60_000;
}

/**
 * A Jerusalem wall-clock time as an absolute instant.
 *
 * Two passes: guess with the offset that applies at the naive instant, then
 * re-check with the offset that applies at the corrected one. That second pass
 * is what makes the two DST changeover days come out right.
 */
export function jerusalemWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const firstGuess = new Date(naive - jerusalemOffsetMinutes(new Date(naive)) * 60_000);
  const corrected = new Date(naive - jerusalemOffsetMinutes(firstGuess) * 60_000);
  return corrected;
}

/** `HH:MM` in Jerusalem local time — for displaying candle lighting. */
export function formatJerusalemTime(instant: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
}
