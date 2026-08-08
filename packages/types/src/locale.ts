import { z } from 'zod';

/**
 * ---------------------------------------------------------------------------
 * Locale — Hebrew-first, RTL-first
 * ---------------------------------------------------------------------------
 * Hebrew is the default and RTL is the default. English exists, but it is the
 * fallback rather than the reference implementation. Building it the other way
 * round produces a product that reads as translated, and Israeli users can tell
 * within one screen.
 * ---------------------------------------------------------------------------
 */

export const Locale = { He: 'he', En: 'en' } as const;
export type Locale = (typeof Locale)[keyof typeof Locale];
export const LocaleSchema = z.enum([Locale.He, Locale.En]);
export const DEFAULT_LOCALE: Locale = Locale.He;
export const SUPPORTED_LOCALES: readonly Locale[] = [Locale.He, Locale.En];

export type TextDirection = 'rtl' | 'ltr';

export function directionFor(locale: Locale): TextDirection {
  return locale === Locale.He ? 'rtl' : 'ltr';
}

/** Pick the right field off a `{ ...He, ...En }` pair. */
export function localised<T>(locale: Locale, values: { he: T; en: T }): T {
  return locale === Locale.He ? values.he : values.en;
}

// --- phone numbers ----------------------------------------------------------

export const IL_COUNTRY_CODE = '+972';

/** Israeli mobile prefixes, without the leading zero. */
const IL_MOBILE_PREFIXES = ['50', '51', '52', '53', '54', '55', '56', '58', '59'] as const;

/**
 * Normalise any way an Israeli writes their number into E.164.
 *
 * Accepts `0521234567`, `052-123-4567`, `+972521234567`, `972 52 1234567`.
 * Returns `+972521234567`, or null when it isn't a valid Israeli mobile.
 *
 * Mobile only, deliberately: this number receives the OTP and the driver's
 * arrival SMS, so a landline is a failed booking waiting to happen.
 */
export function normaliseIsraeliMobile(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');

  let national: string;
  if (digits.startsWith('+972')) {
    national = digits.slice(4);
  } else if (digits.startsWith('972')) {
    national = digits.slice(3);
  } else if (digits.startsWith('0')) {
    national = digits.slice(1);
  } else {
    national = digits;
  }

  // National mobile format is 9 digits: 2-digit prefix + 7-digit subscriber.
  if (!/^\d{9}$/.test(national)) return null;
  const prefix = national.slice(0, 2);
  if (!IL_MOBILE_PREFIXES.includes(prefix as (typeof IL_MOBILE_PREFIXES)[number])) return null;

  return `${IL_COUNTRY_CODE}${national}`;
}

export function isIsraeliMobile(input: string): boolean {
  return normaliseIsraeliMobile(input) !== null;
}

/** Display as `052-123-4567` — how the number appears on every Israeli form. */
export function formatIsraeliMobile(e164: string): string {
  const national = e164.startsWith(IL_COUNTRY_CODE) ? e164.slice(4) : e164;
  if (!/^\d{9}$/.test(national)) return e164;
  return `0${national.slice(0, 2)}-${national.slice(2, 5)}-${national.slice(5)}`;
}

export const IsraeliMobileSchema = z
  .string()
  .transform((v, ctx) => {
    const normalised = normaliseIsraeliMobile(v);
    if (!normalised) {
      ctx.addIssue({ code: 'custom', message: 'not a valid Israeli mobile number' });
      return z.NEVER;
    }
    return normalised;
  });

// --- the Israeli week -------------------------------------------------------

/**
 * The working week here is Sunday–Thursday. Friday is a short day that winds
 * down toward Shabbat, and Saturday is not a working day for most of the
 * market. Treating Saturday and Sunday as "the weekend" — as every off-the-shelf
 * scheduling library does — produces a calendar that is wrong twice a week.
 */
export const DayKind = {
  /** ראשון–חמישי. Normal working day. */
  Workday: 'workday',
  /** שישי. Short day; work generally stops well before candle lighting. */
  ShortDay: 'short_day',
  /** שבת. Not a working day for most drivers and most customers. */
  Shabbat: 'shabbat',
  /** ערב חג — behaves like a Friday. */
  HolidayEve: 'holiday_eve',
  /** חג — behaves like Shabbat. */
  Holiday: 'holiday',
} as const;
export type DayKind = (typeof DayKind)[keyof typeof DayKind];
export const DayKindSchema = z.enum([
  DayKind.Workday,
  DayKind.ShortDay,
  DayKind.Shabbat,
  DayKind.HolidayEve,
  DayKind.Holiday,
]);

/** Is this a day we would normally dispatch on? */
export function isDispatchableDay(kind: DayKind): boolean {
  return kind === DayKind.Workday || kind === DayKind.ShortDay || kind === DayKind.HolidayEve;
}

export const IANA_TIMEZONE = 'Asia/Jerusalem';

/**
 * Day of week in Jerusalem time, regardless of where the server is.
 * 0 = Sunday … 6 = Saturday.
 */
export function israeliDayOfWeek(date: Date): number {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: IANA_TIMEZONE,
    weekday: 'short',
  }).format(date);
  const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(formatted);
  return index === -1 ? date.getUTCDay() : index;
}

/** Local wall-clock parts in Jerusalem. Servers run UTC; humans do not. */
export function israeliClock(date: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IANA_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return { hour, minute };
}

/** `YYYY-MM-DD` in Jerusalem time — the key for holiday-calendar lookups. */
export function israeliDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IANA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
