import { Locale } from '@haul/types';
import { describe, expect, it } from 'vitest';
import { dayInfoForISO, formatJerusalemTime, jerusalemWallClockToUtc } from '../israel.js';
import {
  formatJerusalemDay,
  formatJerusalemMonth,
  formatWindowRange,
  weekdayLabelLong,
  weekdayLabelShort,
} from '../labels.js';

const LOCALES = [Locale.He, Locale.En] as const;
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

describe('weekday labels', () => {
  it('gives seven distinguishable labels at both sizes in both languages', () => {
    // The reason this is a table rather than Intl: its English narrow forms are
    // S, M, T, W, T, F, S — two pairs that collide, which cannot head a grid.
    for (const locale of LOCALES) {
      for (const label of [weekdayLabelShort, weekdayLabelLong]) {
        const labels = WEEKDAYS.map((d) => label(d, locale));
        expect(new Set(labels).size, `${locale} ${label.name}`).toBe(7);
        expect(labels.every((l) => l.length > 0)).toBe(true);
      }
    }
  });

  it('calls Saturday שבת at both sizes', () => {
    // Intl says יום שבת long and ש׳ short. Israelis say neither.
    expect(weekdayLabelShort(6, Locale.He)).toBe('שבת');
    expect(weekdayLabelLong(6, Locale.He)).toBe('שבת');
  });

  it('numbers Sunday through Friday and stops', () => {
    expect(weekdayLabelShort(0, Locale.He)).toBe('א׳');
    expect(weekdayLabelShort(5, Locale.He)).toBe('ו׳');
    expect(weekdayLabelLong(0, Locale.He)).toBe('יום ראשון');
  });

  it('never lets a short label be longer than its long form', () => {
    for (const locale of LOCALES) {
      for (const day of WEEKDAYS) {
        expect(weekdayLabelShort(day, locale).length).toBeLessThanOrEqual(
          weekdayLabelLong(day, locale).length,
        );
      }
    }
  });

  it('rejects a day index that is not a day of the week', () => {
    expect(() => weekdayLabelShort(7, Locale.He)).toThrow(RangeError);
    expect(() => weekdayLabelLong(-1, Locale.En)).toThrow(RangeError);
  });
});

describe('day formatting', () => {
  it('opens with the weekday the calendar assigns that date', () => {
    for (let day = 1; day <= 31; day++) {
      const iso = `2026-08-${String(day).padStart(2, '0')}`;
      const expected = weekdayLabelLong(dayInfoForISO(iso).dayOfWeek, Locale.He);
      expect(formatJerusalemDay(iso, Locale.He).startsWith(expected), iso).toBe(true);
    }
  });

  it('names the date it was given, on both sides of the DST changeovers', () => {
    // A civil date has no instant, and picking the wrong one shifts the label to
    // the neighbouring day for the two hours a year Israel changes its clocks.
    for (const iso of ['2026-01-01', '2026-03-27', '2026-03-28', '2026-10-24', '2026-12-31']) {
      const dayOfMonth = Number(iso.slice(8));
      for (const locale of LOCALES) {
        expect(formatJerusalemDay(iso, locale), iso).toContain(String(dayOfMonth));
        expect(formatJerusalemDay(iso, locale), iso).toContain('2026');
      }
    }
  });

  it('reads the way each language writes a date', () => {
    const he = formatJerusalemDay('2026-08-09', Locale.He);
    expect(he.startsWith('יום ראשון, ')).toBe(true);
    // Hebrew binds the preposition to the month name — באוגוסט, not אוגוסט.
    // Getting that right is the whole reason the date half stays with Intl.
    expect(he).toContain('באוגוסט');

    const en = formatJerusalemDay('2026-08-09', Locale.En);
    expect(en.startsWith('Sunday, ')).toBe(true);
    // Day before month in English too, because that is how it is written here.
    expect(en.indexOf('9')).toBeLessThan(en.indexOf('August'));
  });

  it('rejects anything that is not a civil date key', () => {
    expect(() => formatJerusalemDay('09/08/2026', Locale.He)).toThrow(TypeError);
    expect(() => formatJerusalemMonth('', Locale.En)).toThrow(TypeError);
  });
});

describe('month title', () => {
  it('titles the month any date inside it belongs to', () => {
    for (const iso of ['2026-08-01', '2026-08-17', '2026-08-31']) {
      expect(formatJerusalemMonth(iso, Locale.He)).toBe(
        formatJerusalemMonth('2026-08-09', Locale.He),
      );
    }
    expect(formatJerusalemMonth('2026-08-09', Locale.He)).not.toBe(
      formatJerusalemMonth('2026-09-09', Locale.He),
    );
  });

  it('carries the year, so a grid scrolled a year forward says so', () => {
    for (const locale of LOCALES) {
      expect(formatJerusalemMonth('2026-08-09', locale)).toContain('2026');
      expect(formatJerusalemMonth('2027-08-09', locale)).toContain('2027');
    }
  });
});

describe('window range', () => {
  const window = {
    start: jerusalemWallClockToUtc(2026, 8, 9, 7, 0),
    end: jerusalemWallClockToUtc(2026, 8, 9, 22, 0),
  };

  it('composes the times the rest of the package prints', () => {
    const range = formatWindowRange(window);
    expect(range).toContain(formatJerusalemTime(window.start));
    expect(range).toContain(formatJerusalemTime(window.end));
  });

  it('keeps the start before the end', () => {
    const range = formatWindowRange(window);
    expect(range.indexOf(formatJerusalemTime(window.start))).toBeLessThan(
      range.indexOf(formatJerusalemTime(window.end)),
    );
  });

  it('isolates the range so an RTL page cannot reverse it', () => {
    // Without the isolate, bidi resolves the dash between two numbers as
    // right-to-left and a Hebrew page renders 07:00–22:00 as 22:00–07:00.
    const range = formatWindowRange(window);
    expect(range.codePointAt(0)).toBe(0x2066);
    expect(range.codePointAt(range.length - 1)).toBe(0x2069);
  });

  it('prints the evening tail of a Shabbat as an evening', () => {
    const motzash = {
      start: jerusalemWallClockToUtc(2026, 6, 27, 20, 30),
      end: jerusalemWallClockToUtc(2026, 6, 27, 22, 0),
    };
    expect(formatWindowRange(motzash)).toContain('20:30');
    expect(formatWindowRange(motzash)).toContain('22:00');
  });
});
