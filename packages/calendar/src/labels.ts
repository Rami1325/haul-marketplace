import { localised, type Locale } from '@haul/types';
import { dayOfWeekFromFixed, gregorianToFixed } from './hebrew.js';
import { TIMEZONE, formatJerusalemTime, jerusalemWallClockToUtc, type Interval } from './israel.js';

/**
 * ---------------------------------------------------------------------------
 * Calendar labels
 * ---------------------------------------------------------------------------
 * The reading of a day, in both languages, owned here so that no app re-derives
 * it and no two surfaces disagree about what Saturday is called.
 *
 * `Intl` gets Hebrew dates right and Hebrew *weekdays* subtly wrong. Its long
 * form for Saturday is `יום שבת`, which nobody says; its narrow form is `ש׳`,
 * which no Israeli calendar prints; and the English narrow forms collide —
 * S, T, T, S — so they cannot head a seven-column grid at all. On top of that,
 * every one of those strings is whatever the running ICU decides today, and a
 * column header that changes with a Node upgrade is not a header.
 *
 * So the weekday names are a table. The dates around them are still `Intl`,
 * because month names genuinely are its job: `9 באוגוסט 2026` carries a bound
 * ב prefix that a hand-rolled table would get wrong the first time somebody
 * added a month.
 * ---------------------------------------------------------------------------
 */

/**
 * Column headers. Saturday breaks the pattern in Hebrew and is spelled out at
 * both sizes: the week counts א׳ to ו׳ and then stops, because שבת has a name
 * rather than a number.
 */
const WEEKDAY_SHORT_HE: readonly string[] = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'שבת'];
const WEEKDAY_LONG_HE: readonly string[] = [
  'יום ראשון',
  'יום שני',
  'יום שלישי',
  'יום רביעי',
  'יום חמישי',
  'יום שישי',
  'שבת',
];
const WEEKDAY_SHORT_EN: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LONG_EN: readonly string[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function lookupWeekday(dayOfWeek: number, table: readonly string[]): string {
  const label = table[dayOfWeek];
  if (label === undefined) {
    throw new RangeError(`weekday must be 0 (Sunday) … 6 (Saturday), got ${dayOfWeek}`);
  }
  return label;
}

/** Grid-header width: `א׳`, `שבת`, `Sun`. Takes 0 = Sunday … 6 = Saturday. */
export function weekdayLabelShort(dayOfWeek: number, locale: Locale): string {
  return lookupWeekday(
    dayOfWeek,
    localised(locale, { he: WEEKDAY_SHORT_HE, en: WEEKDAY_SHORT_EN }),
  );
}

/** Prose width: `יום ראשון`, `שבת`, `Sunday`. Takes 0 = Sunday … 6 = Saturday. */
export function weekdayLabelLong(dayOfWeek: number, locale: Locale): string {
  return lookupWeekday(dayOfWeek, localised(locale, { he: WEEKDAY_LONG_HE, en: WEEKDAY_LONG_EN }));
}

function civilParts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined || Number.isNaN(day)) {
    throw new TypeError(`expected YYYY-MM-DD, got "${iso}"`);
  }
  return { year, month, day };
}

/**
 * A civil date has no instant of its own, so pick midday: it is the only hour
 * that lands inside the intended date under either offset Israel keeps, which
 * makes the two DST changeover days format as themselves rather than as their
 * neighbours.
 */
function jerusalemMidday(parts: { year: number; month: number; day: number }): Date {
  return jerusalemWallClockToUtc(parts.year, parts.month, parts.day, 12, 0);
}

/**
 * `he-IL` and `en-GB` — day before month, on a 24-hour clock. That is how a
 * date is written here in either language, and it is what `formatJerusalemTime`
 * already assumes; `en-US` would disagree with it twice in one line.
 */
function intlLocale(locale: Locale): string {
  return localised(locale, { he: 'he-IL', en: 'en-GB' });
}

/**
 * A whole day as it is read aloud — `יום ראשון, 9 באוגוסט 2026`.
 *
 * The confirmation line, not the grid cell: it carries the year because a
 * booking that lands in the wrong one is the expensive mistake here.
 */
export function formatJerusalemDay(iso: string, locale: Locale): string {
  const parts = civilParts(iso);
  const weekday = weekdayLabelLong(
    dayOfWeekFromFixed(gregorianToFixed(parts.year, parts.month, parts.day)),
    locale,
  );
  const date = new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: TIMEZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(jerusalemMidday(parts));

  return `${weekday}, ${date}`;
}

/** The month grid's title — `אוגוסט 2026`. Any date within the month will do. */
export function formatJerusalemMonth(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: TIMEZONE,
    month: 'long',
    year: 'numeric',
  }).format(jerusalemMidday(civilParts(iso)));
}

/**
 * Unicode directional isolate. Everything between the two is laid out
 * left-to-right no matter what surrounds it. Written as escapes because both
 * characters are invisible, and an invisible character pasted into source is a
 * character the next person deletes by accident.
 */
const LTR_ISOLATE = '\u2066';
const POP_ISOLATE = '\u2069';

/**
 * An arrival window as `07:00–22:00`, wrapped in a directional isolate.
 *
 * The isolate is the entire reason this function exists rather than a template
 * string at the call site. Bidi treats the dash between two numbers as
 * right-to-left, so on a Hebrew page `07:00–22:00` renders as `22:00–07:00`:
 * a booking UI showing every window backwards, in the one language where
 * nobody would think to check. Isolating the run pins it wherever it is
 * dropped — Hebrew page, English page, SMS.
 *
 * No locale parameter, because once the times are isolated there is nothing
 * locale-dependent left; both languages read the same digits the same way.
 */
export function formatWindowRange(window: Interval): string {
  const start = formatJerusalemTime(window.start);
  const end = formatJerusalemTime(window.end);
  return `${LTR_ISOLATE}${start}–${end}${POP_ISOLATE}`;
}
