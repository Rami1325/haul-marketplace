import { resolveSeasonalFactor, resolveTimeFactor } from '@haul/pricing';
import { DayKind } from '@haul/types';
import { describe, expect, it } from 'vitest';
import { TEL_AVIV_CITY } from '../cities/index.js';
import { TEL_AVIV_RATE_CARD } from '../cities/tel-aviv.js';
import { scheduleInputFor } from '../schedule-input.js';

/**
 * ---------------------------------------------------------------------------
 * The schedule builder
 * ---------------------------------------------------------------------------
 * Every assertion here is stated as a price or a factor rather than as a field
 * value, because the field values are not the point — a `localHour` of 16 is not
 * wrong in the abstract, it is wrong because the job is at 19:30 and the evening
 * band never fires. So the tests ask the engine the same question a quote would.
 * ---------------------------------------------------------------------------
 */

const card = TEL_AVIV_RATE_CARD;
const factorAt = (at: Date) => resolveTimeFactor(scheduleInputFor(at, TEL_AVIV_CITY), card);

describe('the evening band, which a UTC hour misses entirely', () => {
  it('fires for a job that is 19:30 in Jerusalem and 16:30 in UTC', () => {
    const at = new Date('2026-10-13T16:30:00Z');
    // The trap, stated: reading the hour off the Date gives 16, which is below
    // the card's evening threshold, so the surcharge silently never applies.
    expect(at.getUTCHours()).toBeLessThan(card.eveningFromHour);
    expect(scheduleInputFor(at, TEL_AVIV_CITY).localHour).toBeGreaterThanOrEqual(
      card.eveningFromHour,
    );
    expect(factorAt(at)).toBe(card.timeFactorBps['evening']);
  });

  it('does not fire an hour earlier', () => {
    expect(factorAt(new Date('2026-10-13T14:30:00Z'))).toBe(card.timeFactorBps[DayKind.Workday]);
  });

  it('survives the summer/winter offset change', () => {
    // 19:00 Jerusalem is 16:00Z in summer and 17:00Z in winter. Both are evening.
    expect(scheduleInputFor(new Date('2026-07-15T16:00:00Z'), TEL_AVIV_CITY).localHour).toBe(19);
    expect(scheduleInputFor(new Date('2026-01-14T17:00:00Z'), TEL_AVIV_CITY).localHour).toBe(19);
  });
});

describe('the month, which a UTC month moves', () => {
  it('takes a job just after Jerusalem midnight into the new month', () => {
    // 00:30 on 1 April, local. In UTC it is still 31 March, so the seasonal
    // factor would be March's — and March and April differ on this card.
    const at = new Date('2026-03-31T21:30:00Z');
    expect(at.getUTCMonth() + 1).toBe(3);

    const schedule = scheduleInputFor(at, TEL_AVIV_CITY);
    expect(schedule.month).toBe(4);
    expect(resolveSeasonalFactor(schedule, card)).toBe(card.seasonalFactorBps['4']);
    expect(card.seasonalFactorBps['4']).not.toBe(card.seasonalFactorBps['3']);
  });

  it('reads the month from the same civil day as the day classification', () => {
    // Not a second timezone conversion: one date, one answer.
    for (const iso of ['2026-01-01T00:30:00Z', '2026-06-30T21:30:00Z', '2026-12-31T22:30:00Z']) {
      const schedule = scheduleInputFor(new Date(iso), TEL_AVIV_CITY);
      expect(schedule.month).toBeGreaterThanOrEqual(1);
      expect(schedule.month).toBeLessThanOrEqual(12);
    }
  });
});

describe('the day rolls at sunset, not at midnight', () => {
  it('calls a winter Friday afternoon Shabbat once candle lighting has passed', () => {
    // 9 January 2026: Shabbat comes in at about 16:35 in Tel Aviv. 15:30 is still
    // Friday and earns the short-day surcharge; 17:00 is Shabbat and must not.
    const beforeCandles = scheduleInputFor(new Date('2026-01-09T13:30:00Z'), TEL_AVIV_CITY);
    const afterCandles = scheduleInputFor(new Date('2026-01-09T15:00:00Z'), TEL_AVIV_CITY);

    expect(beforeCandles.dayKind).toBe(DayKind.ShortDay);
    expect(afterCandles.dayKind).toBe(DayKind.Shabbat);
    expect(resolveTimeFactor(afterCandles, card)).not.toBe(card.timeFactorBps[DayKind.ShortDay]);
  });

  it('calls a winter Saturday evening an ordinary working day once Shabbat is out', () => {
    // Same weekend, nightfall about 17:34. Motzei Shabbat is one of the busiest
    // moving windows of the week here and must not price as the day it follows.
    expect(scheduleInputFor(new Date('2026-01-10T14:00:00Z'), TEL_AVIV_CITY).dayKind).toBe(
      DayKind.Shabbat,
    );
    expect(scheduleInputFor(new Date('2026-01-10T15:40:00Z'), TEL_AVIV_CITY).dayKind).toBe(
      DayKind.Workday,
    );
  });

  it('leaves an ordinary weekday evening alone', () => {
    // The Hebrew day rolls every night. Applying that here would put a Friday
    // surcharge on Thursday at 21:00, which is a normal working evening.
    const thursdayNight = scheduleInputFor(new Date('2026-10-15T18:00:00Z'), TEL_AVIV_CITY);
    expect(thursdayNight.dayKind).toBe(DayKind.Workday);
  });
});

describe('chol hamoed, the demand spike the calendar has to supply', () => {
  it('marks an intermediate Pesach day and prices it above a plain workday', () => {
    const cholHaMoed = scheduleInputFor(new Date('2026-04-05T07:00:00Z'), TEL_AVIV_CITY);
    expect(cholHaMoed.isCholHaMoed).toBe(true);
    expect(cholHaMoed.dayKind).toBe(DayKind.Workday);
    expect(resolveTimeFactor(cholHaMoed, card)).toBeGreaterThan(
      card.timeFactorBps[DayKind.Workday]!,
    );
  });

  it('is false on the festival day itself', () => {
    const pesach = scheduleInputFor(new Date('2026-04-02T07:00:00Z'), TEL_AVIV_CITY);
    expect(pesach.dayKind).toBe(DayKind.Holiday);
    expect(pesach.isCholHaMoed).toBe(false);
  });
});

describe('the instant it was built from', () => {
  it('is carried through untouched', () => {
    const at = new Date('2026-10-13T16:30:00Z');
    expect(scheduleInputFor(at, TEL_AVIV_CITY).at).toBe(at);
  });

  it('stays inside the bounds the rate card indexes by', () => {
    // Every hour of a full year, sampled: an out-of-range hour or month would
    // fall through to a default factor rather than throw.
    for (let hour = 0; hour < 24 * 366; hour += 7) {
      const schedule = scheduleInputFor(new Date(Date.UTC(2026, 0, 1, hour, 17)), TEL_AVIV_CITY);
      expect(schedule.localHour).toBeGreaterThanOrEqual(0);
      expect(schedule.localHour).toBeLessThanOrEqual(23);
      expect(card.seasonalFactorBps[String(schedule.month)]).toBeDefined();
      expect(card.timeFactorBps[schedule.dayKind]).toBeDefined();
    }
  });
});
