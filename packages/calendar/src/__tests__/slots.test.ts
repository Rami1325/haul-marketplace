import { DayKind } from '@haul/types';
import { describe, expect, it } from 'vitest';
import { gregorianToFixed } from '../hebrew.js';
import {
  DEFAULT_OPERATING_HOURS,
  TEL_AVIV,
  isDispatchableAt,
  jerusalemWallClockToUtc,
  type Interval,
} from '../israel.js';
import { bookableDaysBetween, nextBookableDay, sliceIntoSlots } from '../slots.js';
import { nightfallAt } from '../solar.js';

const fixedOf = (iso: string) =>
  gregorianToFixed(...(iso.split('-').map(Number) as [number, number, number]));

const hours = DEFAULT_OPERATING_HOURS;

const dayOf = (iso: string, overrides: Partial<typeof hours> = {}) => {
  const [day] = bookableDaysBetween(iso, 1, TEL_AVIV, { ...hours, ...overrides });
  expect(day).toBeDefined();
  return day!;
};

const minutes = (interval: Interval) =>
  (interval.end.getTime() - interval.start.getTime()) / 60_000;

describe('bookableDaysBetween', () => {
  it('returns the requested run of consecutive days', () => {
    const days = bookableDaysBetween('2026-08-06', 10, TEL_AVIV, hours);
    expect(days).toHaveLength(10);
    expect(days[0]!.dateKey).toBe('2026-08-06');
    expect(days[9]!.dateKey).toBe('2026-08-15');
    for (let i = 1; i < days.length; i++) {
      expect(days[i]!.fixed - days[i - 1]!.fixed).toBe(1);
      expect(days[i]!.dayOfWeek).toBe((days[i - 1]!.dayOfWeek + 1) % 7);
    }
  });

  it('rejects a nonsense span rather than guessing', () => {
    expect(() => bookableDaysBetween('2026-08-06', -1, TEL_AVIV, hours)).toThrow(RangeError);
    expect(() => bookableDaysBetween('2026-08-06', 1.5, TEL_AVIV, hours)).toThrow(RangeError);
    expect(bookableDaysBetween('2026-08-06', 0, TEL_AVIV, hours)).toEqual([]);
  });

  it('marks a plain Sunday bookable all day and not busy', () => {
    const sunday = dayOf('2026-08-09');
    expect(sunday.kind).toBe(DayKind.Workday);
    expect(sunday.isBookable).toBe(true);
    expect(sunday.isHighDemand).toBe(false);
    expect(sunday.windows).toHaveLength(1);
  });
});

describe('days nothing can be sold on', () => {
  it('offers nothing during Yom Kippur itself', () => {
    // Yom Kippur 5786 — 2025-10-02. The fast runs Wednesday evening to Thursday
    // nightfall, so nothing on the Thursday is bookable before the stars come out.
    const yomKippur = dayOf('2025-10-02');
    expect(yomKippur.kind).toBe(DayKind.Holiday);

    const nightfall = nightfallAt(fixedOf('2025-10-02'), TEL_AVIV, TEL_AVIV.nightfallMinutes)!;
    for (const window of yomKippur.windows) {
      expect(window.start.getTime()).toBeGreaterThanOrEqual(nightfall.getTime());
    }

    // The tail after the fast is halachically dispatchable and commercially
    // dead, and ops closes it with the minimum-window knob rather than with a
    // rule teaching the calendar which festivals people move house after.
    const closed = dayOf('2025-10-02', { minimumWindowMinutes: 240 });
    expect(closed.windows).toEqual([]);
    expect(closed.isBookable).toBe(false);
  });

  it('offers nothing at all on a festival that runs straight into Shabbat', () => {
    // Shavuot 5786 falls on a Friday, so the restricted block runs from Thursday
    // candle lighting to Saturday nightfall and the Friday has no tail to sell.
    const shavuot = dayOf('2026-05-22');
    expect(shavuot.kind).toBe(DayKind.Holiday);
    expect(shavuot.dayOfWeek).toBe(5);
    expect(shavuot.windows).toEqual([]);
    expect(shavuot.isBookable).toBe(false);
  });
});

describe('motzei Shabbat is live', () => {
  it('sells the evening of a midsummer Saturday', () => {
    // High summer: Shabbat does not end until about 20:15, which is exactly why
    // the default close is 22:00 rather than 21:00.
    const saturday = dayOf('2026-06-27');
    expect(saturday.kind).toBe(DayKind.Shabbat);
    expect(saturday.isBookable).toBe(true);
    expect(saturday.windows).toHaveLength(1);

    const tail = saturday.windows[0]!;
    const nightfall = nightfallAt(fixedOf('2026-06-27'), TEL_AVIV, TEL_AVIV.nightfallMinutes)!;
    expect(tail.start.getTime()).toBeGreaterThanOrEqual(nightfall.getTime());
    expect(tail.end.getTime()).toBe(
      jerusalemWallClockToUtc(2026, 6, 27, hours.endHour, 0).getTime(),
    );
    // Long enough to hold a real arrival window, not a rounding artefact.
    expect(minutes(tail)).toBeGreaterThanOrEqual(hours.minimumWindowMinutes);
  });
});

describe('Chol HaMoed is a demand spike, not a holiday', () => {
  it('flags it high-demand and keeps it bookable', () => {
    const cholHaMoed = dayOf('2026-04-05'); // 18 Nisan 5786
    expect(cholHaMoed.isCholHaMoed).toBe(true);
    expect(cholHaMoed.isHighDemand).toBe(true);
    expect(cholHaMoed.isBookable).toBe(true);
    expect(cholHaMoed.kind).toBe(DayKind.Workday);
  });

  it('flags the whole intermediate stretch of Pesach but not the festival days', () => {
    const pesach = bookableDaysBetween('2026-04-02', 8, TEL_AVIV, hours);
    const busy = pesach.filter((d) => d.isHighDemand);

    expect(busy.length).toBeGreaterThan(0);
    for (const day of busy) {
      expect(day.kind).not.toBe(DayKind.Holiday);
      expect(day.isBookable).toBe(true);
    }
    // Yom tov is the opposite case: closed, and never marked busy.
    for (const day of pesach.filter((d) => d.kind === DayKind.Holiday)) {
      expect(day.isHighDemand).toBe(false);
    }
  });
});

describe('nextBookableDay', () => {
  it('answers with today when today still has a window', () => {
    expect(nextBookableDay('2026-08-09', TEL_AVIV, hours)?.dateKey).toBe('2026-08-09');
  });

  it('sends a Friday-festival enquiry to motzei Shabbat rather than to Sunday', () => {
    const next = nextBookableDay('2026-05-22', TEL_AVIV, hours);
    expect(next?.dateKey).toBe('2026-05-23');
    expect(next?.kind).toBe(DayKind.Shabbat);
  });

  it('always lands on a day it claims is bookable', () => {
    for (let offset = 0; offset < 40; offset++) {
      const from = bookableDaysBetween('2026-03-25', offset + 1, TEL_AVIV, hours).at(-1)!;
      const next = nextBookableDay(from.dateKey, TEL_AVIV, hours);
      expect(next, from.dateKey).not.toBeNull();
      expect(next!.isBookable).toBe(true);
      expect(next!.fixed).toBeGreaterThanOrEqual(from.fixed);
    }
  });

  it('returns null rather than searching forever when the hours are unsellable', () => {
    const impossible = { ...hours, minimumWindowMinutes: 24 * 60 };
    expect(nextBookableDay('2026-08-09', TEL_AVIV, impossible)).toBeNull();
  });
});

describe('sliceIntoSlots', () => {
  const window: Interval = {
    start: jerusalemWallClockToUtc(2026, 8, 9, 7, 0),
    end: jerusalemWallClockToUtc(2026, 8, 9, 22, 0),
  };

  it('cuts whole slots and drops the remainder', () => {
    const slots = sliceIntoSlots(window, 120, 0, jerusalemWallClockToUtc(2026, 8, 9, 0, 0));
    // Fifteen hours holds seven two-hour slots; the last hour is not an arrival window.
    expect(slots).toHaveLength(7);
    expect(slots[0]!.start.getTime()).toBe(window.start.getTime());
    expect(slots.at(-1)!.end.getTime()).toBeLessThanOrEqual(window.end.getTime());
    for (const slot of slots) expect(minutes(slot)).toBe(120);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i]!.start.getTime()).toBe(slots[i - 1]!.end.getTime());
    }
  });

  it('drops every slot that starts inside the lead time', () => {
    const now = jerusalemWallClockToUtc(2026, 8, 9, 8, 0);
    const lead = 60;
    const slots = sliceIntoSlots(window, 120, lead, now);

    const earliest = now.getTime() + lead * 60_000;
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) expect(slot.start.getTime()).toBeGreaterThanOrEqual(earliest);
    // The 07:00 slot was already running and the 09:00 one starts exactly on the
    // lead boundary, so the cut lands on the boundary rather than past it.
    expect(slots[0]!.start.getTime()).toBe(jerusalemWallClockToUtc(2026, 8, 9, 9, 0).getTime());
  });

  it('never offers more as the lead time grows', () => {
    const now = jerusalemWallClockToUtc(2026, 8, 9, 7, 0);
    let previous = Infinity;
    for (const lead of [0, 30, 90, 240, 600, 1440]) {
      const count = sliceIntoSlots(window, 60, lead, now).length;
      expect(count, `lead ${lead}`).toBeLessThanOrEqual(previous);
      previous = count;
    }
    expect(previous).toBe(0);
  });

  it('offers nothing when the window cannot hold one whole slot', () => {
    const short: Interval = {
      start: jerusalemWallClockToUtc(2026, 8, 9, 20, 30),
      end: jerusalemWallClockToUtc(2026, 8, 9, 22, 0),
    };
    expect(sliceIntoSlots(short, 120, 0, short.start)).toEqual([]);
    expect(sliceIntoSlots(short, 90, 0, short.start)).toHaveLength(1);
  });

  it('refuses a slot length or lead that cannot mean anything', () => {
    expect(() => sliceIntoSlots(window, 0, 0, window.start)).toThrow(RangeError);
    expect(() => sliceIntoSlots(window, -60, 0, window.start)).toThrow(RangeError);
    expect(() => sliceIntoSlots(window, 60, -1, window.start)).toThrow(RangeError);
  });
});

describe('slots agree with the calendar that produced them', () => {
  it('never offers a slot that overlaps Shabbat or a festival', () => {
    // Six weeks spanning Shavuot, several Fridays and every motzei Shabbat in them.
    const days = bookableDaysBetween('2026-05-10', 42, TEL_AVIV, hours);
    let checked = 0;

    for (const day of days) {
      expect(day.isBookable).toBe(day.windows.length > 0);
      for (const window of day.windows) {
        for (const slot of sliceIntoSlots(window, 90, 0, window.start)) {
          expect(isDispatchableAt(slot.start, TEL_AVIV), `${day.dateKey} slot start`).toBe(true);
          // The instant before the slot closes is still inside it.
          expect(
            isDispatchableAt(new Date(slot.end.getTime() - 1), TEL_AVIV),
            `${day.dateKey} slot end`,
          ).toBe(true);
          checked++;
        }
      }
    }

    expect(checked).toBeGreaterThan(100);
  });
});
