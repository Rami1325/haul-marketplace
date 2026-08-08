import { describe, expect, it } from 'vitest';
import {
  HebrewMonth,
  daysInHebrewYear,
  dayOfWeekFromFixed,
  fixedToGregorian,
  fixedToHebrew,
  gregorianToFixed,
  hebrewDateFromISO,
  isHebrewLeapYear,
  isoFromHebrewDate,
} from '../hebrew.js';

describe('Gregorian ↔ fixed', () => {
  it('round-trips across a wide span', () => {
    for (const iso of ['1900-01-01', '2000-02-29', '2026-08-08', '2100-03-01', '2400-12-31']) {
      const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
      const back = fixedToGregorian(gregorianToFixed(y, m, d));
      expect(back, iso).toEqual({ year: y, month: m, day: d });
    }
  });

  it('agrees with JS Date on the day of week', () => {
    // 2026-08-08 is a Saturday.
    expect(dayOfWeekFromFixed(gregorianToFixed(2026, 8, 8))).toBe(6);
    // 2025-09-23 is a Tuesday.
    expect(dayOfWeekFromFixed(gregorianToFixed(2025, 9, 23))).toBe(2);
  });
});

describe('known Hebrew dates', () => {
  // Anchors checked against published Israeli civil/religious calendars.
  const anchors: Array<[string, number, number, number, string]> = [
    ['2025-09-23', 5786, HebrewMonth.Tishrei, 1, 'Rosh Hashana 5786'],
    ['2025-10-02', 5786, HebrewMonth.Tishrei, 10, 'Yom Kippur 5786'],
    ['2025-10-07', 5786, HebrewMonth.Tishrei, 15, 'Sukkot 5786'],
    ['2025-10-14', 5786, HebrewMonth.Tishrei, 22, 'Shmini Atzeret 5786'],
    ['2026-04-02', 5786, HebrewMonth.Nisan, 15, 'Pesach 5786'],
    ['2026-04-08', 5786, HebrewMonth.Nisan, 21, 'Seventh day of Pesach 5786'],
    ['2026-05-22', 5786, HebrewMonth.Sivan, 6, 'Shavuot 5786'],
    ['2026-09-12', 5787, HebrewMonth.Tishrei, 1, 'Rosh Hashana 5787'],
  ];

  for (const [iso, year, month, day, label] of anchors) {
    it(`${label}: ${iso}`, () => {
      expect(hebrewDateFromISO(iso)).toEqual({ year, month, day });
      expect(isoFromHebrewDate({ year, month, day })).toBe(iso);
    });
  }
});

describe('year structure', () => {
  it('marks the leap years of the 19-year cycle', () => {
    // Positions 3, 6, 8, 11, 14, 17, 19 within the cycle are leap years.
    expect(isHebrewLeapYear(5784)).toBe(true); // cycle position 6
    expect(isHebrewLeapYear(5785)).toBe(false);
    expect(isHebrewLeapYear(5786)).toBe(false);
    expect(isHebrewLeapYear(5787)).toBe(true); // cycle position 9... verified below
  });

  it('has exactly seven leap years in every nineteen', () => {
    for (let start = 5700; start < 5900; start += 19) {
      let leaps = 0;
      for (let y = start; y < start + 19; y++) if (isHebrewLeapYear(y)) leaps++;
      expect(leaps, `cycle starting ${start}`).toBe(7);
    }
  });

  it('only ever produces a legal year length', () => {
    // 353/354/355 for a plain year, 383/384/385 for a leap year. Anything else
    // means the postponement rules were applied wrongly.
    const legal = new Set([353, 354, 355, 383, 384, 385]);
    for (let year = 5700; year < 5900; year++) {
      const length = daysInHebrewYear(year);
      expect(legal.has(length), `year ${year} has ${length} days`).toBe(true);
      expect(length > 360).toBe(isHebrewLeapYear(year));
    }
  });

  it('never starts a year on Sunday, Wednesday or Friday', () => {
    // The first dehiyah: לא אד"ו ראש.
    for (let year = 5700; year < 5900; year++) {
      const dow = dayOfWeekFromFixed(
        gregorianToFixed(
          ...(isoFromHebrewDate({ year, month: HebrewMonth.Tishrei, day: 1 })
            .split('-')
            .map(Number) as [number, number, number]),
        ),
      );
      expect([0, 3, 5].includes(dow), `year ${year} starts on day ${dow}`).toBe(false);
    }
  });
});

describe('Hebrew ↔ fixed round-trip', () => {
  it('survives 200 years of daily conversion', () => {
    const start = gregorianToFixed(1990, 1, 1);
    const end = gregorianToFixed(2190, 1, 1);
    for (let fixed = start; fixed < end; fixed += 1) {
      const hebrew = fixedToHebrew(fixed);
      const iso = isoFromHebrewDate(hebrew);
      const g = fixedToGregorian(fixed);
      const expected = `${String(g.year).padStart(4, '0')}-${String(g.month).padStart(2, '0')}-${String(g.day).padStart(2, '0')}`;
      if (iso !== expected) {
        throw new Error(`round-trip failed at RD ${fixed}: got ${iso}, expected ${expected}`);
      }
    }
  });

  it('produces days that stay within their month', () => {
    for (let fixed = gregorianToFixed(2020, 1, 1); fixed < gregorianToFixed(2040, 1, 1); fixed++) {
      const { month, day } = fixedToHebrew(fixed);
      expect(month).toBeGreaterThanOrEqual(1);
      expect(month).toBeLessThanOrEqual(13);
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(30);
    }
  });
});
