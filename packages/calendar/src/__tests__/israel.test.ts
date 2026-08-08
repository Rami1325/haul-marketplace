import { DayKind } from '@haul/types';
import { describe, expect, it } from 'vitest';
import { gregorianToFixed } from '../hebrew.js';
import {
  DEFAULT_OPERATING_HOURS,
  TEL_AVIV,
  JERUSALEM,
  dayInfoForISO,
  dispatchWindowsFor,
  formatJerusalemTime,
  holidayOn,
  isDispatchableAt,
  jerusalemWallClockToUtc,
  nextDispatchableAfter,
  restrictedPeriodsBetween,
  tishaBAvFixed,
  yomHaatzmautFixed,
} from '../israel.js';
import { candleLightingAt, sunsetAt } from '../solar.js';
import { HebrewMonth, fixedToHebrew } from '../hebrew.js';

const fixedOf = (iso: string) =>
  gregorianToFixed(...(iso.split('-').map(Number) as [number, number, number]));

describe('day classification', () => {
  it('treats Sunday as an ordinary working day', () => {
    // The mistake every off-the-shelf scheduler makes.
    expect(dayInfoForISO('2026-08-09').kind).toBe(DayKind.Workday);
    expect(dayInfoForISO('2026-08-09').dayOfWeek).toBe(0);
  });

  it('treats Friday as a short day and Saturday as Shabbat', () => {
    expect(dayInfoForISO('2026-08-07').kind).toBe(DayKind.ShortDay);
    expect(dayInfoForISO('2026-08-08').kind).toBe(DayKind.Shabbat);
  });

  it('marks yom tov', () => {
    expect(dayInfoForISO('2026-04-02').kind).toBe(DayKind.Holiday); // Pesach
    expect(dayInfoForISO('2025-10-02').kind).toBe(DayKind.Holiday); // Yom Kippur
  });

  it('marks the eve of a festival as a short day', () => {
    // Erev Pesach 5786 — work stops at candle lighting, exactly like a Friday.
    expect(dayInfoForISO('2026-04-01').kind).toBe(DayKind.HolidayEve);
  });

  it('recognises Chol HaMoed, which is a demand spike rather than a holiday', () => {
    const day = dayInfoForISO('2026-04-05'); // 18 Nisan 5786
    expect(day.isCholHaMoed).toBe(true);
    expect(day.kind).toBe(DayKind.Workday);
  });
});

describe('national days', () => {
  it('never lets Yom Ha’atzmaut abut Shabbat', () => {
    for (let year = 5780; year < 5820; year++) {
      const fixed = yomHaatzmautFixed(year);
      const dow = ((fixed % 7) + 7) % 7;
      // Never Friday, Saturday, or the Monday that would put Yom HaZikaron on Sunday.
      expect([5, 6, 1].includes(dow), `year ${year} lands on day ${dow}`).toBe(false);
    }
  });

  it('places Yom HaZikaron the day before', () => {
    const independence = yomHaatzmautFixed(5786);
    expect(holidayOn(independence)?.id).toBe('yom_haatzmaut');
    expect(holidayOn(independence - 1)?.id).toBe('yom_hazikaron');
  });

  it('pushes Tisha B’Av off Shabbat', () => {
    for (let year = 5780; year < 5820; year++) {
      const observed = tishaBAvFixed(year);
      const dow = ((observed % 7) + 7) % 7;
      // The fast is never observed on Shabbat; it is deferred to the Sunday.
      expect(dow, `year ${year}`).not.toBe(6);

      const hebrew = fixedToHebrew(observed);
      expect(hebrew.month).toBe(HebrewMonth.Av);
      // Either the 9th, or the 10th when the 9th fell on Shabbat.
      expect([9, 10]).toContain(hebrew.day);
      if (hebrew.day === 10) expect(dow).toBe(0);
    }
  });
});

describe('restricted periods run sunset to nightfall', () => {
  it('starts Shabbat before midnight on Friday, not at midnight on Saturday', () => {
    const saturday = fixedOf('2026-08-08');
    const [period] = restrictedPeriodsBetween(saturday, saturday, TEL_AVIV);
    expect(period).toBeDefined();

    // Begins on the Friday evening.
    expect(period!.start.getTime()).toBeLessThan(
      jerusalemWallClockToUtc(2026, 8, 8, 0, 0).getTime(),
    );
    // Ends on the Saturday evening, not at Sunday midnight.
    expect(period!.end.getTime()).toBeLessThan(
      jerusalemWallClockToUtc(2026, 8, 9, 0, 0).getTime(),
    );
    expect(period!.reasonHe).toContain('שבת');
  });

  it('merges a festival running into Shabbat into one block', () => {
    // Find a year where a yom tov falls on Friday or Sunday adjacent to Shabbat.
    const pesach = fixedOf('2026-04-02');
    const periods = restrictedPeriodsBetween(pesach - 2, pesach + 2, TEL_AVIV);
    // Whatever the arrangement, no two periods may overlap or touch.
    for (let i = 1; i < periods.length; i++) {
      expect(periods[i]!.start.getTime()).toBeGreaterThan(periods[i - 1]!.end.getTime());
    }
  });

  it('lights candles 18 minutes before sunset in Tel Aviv and 40 in Jerusalem', () => {
    const friday = fixedOf('2026-08-07');
    const tlvSunset = sunsetAt(friday, TEL_AVIV)!;
    const tlvCandles = candleLightingAt(friday, TEL_AVIV, TEL_AVIV.candleLightingMinutes)!;
    expect((tlvSunset.getTime() - tlvCandles.getTime()) / 60_000).toBe(18);

    const jlmCandles = candleLightingAt(friday, JERUSALEM, JERUSALEM.candleLightingMinutes)!;
    const jlmSunset = sunsetAt(friday, JERUSALEM)!;
    expect((jlmSunset.getTime() - jlmCandles.getTime()) / 60_000).toBe(40);
  });
});

describe('sunset is plausible for Israel', () => {
  it('sets late in summer and early in winter', () => {
    // Tel Aviv, high summer: sunset is around 19:45–19:50 local.
    const summer = formatJerusalemTime(sunsetAt(fixedOf('2026-06-21'), TEL_AVIV)!);
    const [summerHour] = summer.split(':').map(Number) as [number, number];
    expect(summerHour).toBeGreaterThanOrEqual(19);
    expect(summerHour).toBeLessThanOrEqual(20);

    // Midwinter: sunset is around 16:45–16:55 local.
    const winter = formatJerusalemTime(sunsetAt(fixedOf('2026-12-21'), TEL_AVIV)!);
    const [winterHour] = winter.split(':').map(Number) as [number, number];
    expect(winterHour).toBe(16);
  });

  it('moves monotonically toward the solstices', () => {
    let previous = -Infinity;
    for (let d = 1; d <= 20; d++) {
      const iso = `2026-06-${String(d).padStart(2, '0')}`;
      const sunset = sunsetAt(fixedOf(iso), TEL_AVIV)!;
      const minutesLocal =
        sunset.getTime() - jerusalemWallClockToUtc(2026, 6, d, 0, 0).getTime();
      expect(minutesLocal).toBeGreaterThan(previous);
      previous = minutesLocal;
    }
  });
});

describe('dispatch windows', () => {
  const hours = DEFAULT_OPERATING_HOURS;

  it('gives a full day on an ordinary workday', () => {
    const windows = dispatchWindowsFor('2026-08-09', TEL_AVIV, hours); // Sunday
    expect(windows).toHaveLength(1);
    expect(formatJerusalemTime(windows[0]!.start)).toBe('07:00');
    expect(formatJerusalemTime(windows[0]!.end)).toBe('22:00');
  });

  it('cuts Friday off well before candle lighting', () => {
    const windows = dispatchWindowsFor('2026-08-07', TEL_AVIV, hours);
    expect(windows).toHaveLength(1);

    const candles = candleLightingAt(fixedOf('2026-08-07'), TEL_AVIV, 18)!;
    const gapMinutes = (candles.getTime() - windows[0]!.end.getTime()) / 60_000;
    // A move takes hours; the cushion must actually be there.
    expect(gapMinutes).toBeGreaterThanOrEqual(hours.preShabbatBufferMinutes);
  });

  it('opens Saturday evening after nightfall — motzei Shabbat is real working time', () => {
    const windows = dispatchWindowsFor('2026-08-08', TEL_AVIV, hours);
    expect(windows.length).toBeGreaterThan(0);

    const [motzash] = windows;
    // Starts in the evening, not the morning.
    const startHour = Number(formatJerusalemTime(motzash!.start).split(':')[0]);
    expect(startHour).toBeGreaterThanOrEqual(19);
    expect(formatJerusalemTime(motzash!.end)).toBe('22:00');
  });

  it('offers nothing during Yom Kippur itself', () => {
    // Yom Kippur 5786 ran Wed evening to Thu evening. Nothing is bookable
    // during the day; the only candidate is the tail after nightfall.
    const windows = dispatchWindowsFor('2025-10-02', TEL_AVIV, hours);
    for (const w of windows) {
      const hour = Number(formatJerusalemTime(w.start).split(':')[0]);
      expect(hour, 'no daytime window on Yom Kippur').toBeGreaterThanOrEqual(18);
    }
  });

  it('lets ops suppress a commercially dead evening tail with one knob', () => {
    // Motzei Yom Kippur is halachically dispatchable and commercially dead —
    // everybody is breaking a fast, nobody is moving a fridge. The calendar
    // reports the truth; the minimum-window threshold is where the business
    // decides not to sell it.
    const permissive = dispatchWindowsFor('2025-10-02', TEL_AVIV, {
      ...hours,
      minimumWindowMinutes: 30,
    });
    const strict = dispatchWindowsFor('2025-10-02', TEL_AVIV, {
      ...hours,
      minimumWindowMinutes: 240,
    });
    expect(permissive.length).toBeGreaterThan(0);
    expect(strict).toHaveLength(0);
  });
});

describe('point-in-time checks', () => {
  it('refuses a Saturday midday slot and allows a Sunday one', () => {
    expect(isDispatchableAt(jerusalemWallClockToUtc(2026, 8, 8, 12, 0), TEL_AVIV)).toBe(false);
    expect(isDispatchableAt(jerusalemWallClockToUtc(2026, 8, 9, 12, 0), TEL_AVIV)).toBe(true);
  });

  it('reports when dispatch resumes', () => {
    const saturdayNoon = jerusalemWallClockToUtc(2026, 8, 8, 12, 0);
    const resumes = nextDispatchableAfter(saturdayNoon, TEL_AVIV);
    expect(resumes.getTime()).toBeGreaterThan(saturdayNoon.getTime());
    expect(isDispatchableAt(new Date(resumes.getTime() + 60_000), TEL_AVIV)).toBe(true);
  });
});

describe('Jerusalem wall clock', () => {
  it('handles both sides of the DST changeover', () => {
    // Israel is UTC+2 in winter, UTC+3 in summer.
    expect(jerusalemWallClockToUtc(2026, 1, 15, 12, 0).toISOString()).toBe(
      '2026-01-15T10:00:00.000Z',
    );
    expect(jerusalemWallClockToUtc(2026, 7, 15, 12, 0).toISOString()).toBe(
      '2026-07-15T09:00:00.000Z',
    );
  });

  it('round-trips a wall-clock time back to itself', () => {
    for (const [m, d] of [
      [1, 15],
      [3, 28],
      [6, 1],
      [10, 26],
      [12, 31],
    ] as const) {
      const instant = jerusalemWallClockToUtc(2026, m, d, 14, 30);
      expect(formatJerusalemTime(instant), `${m}-${d}`).toBe('14:30');
    }
  });
});
