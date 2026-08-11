import { DayKind } from '@haul/types';
import {
  dayInfoFor,
  dayInfoForDate,
  isDispatchableAt,
  jerusalemOffsetMinutes,
} from '@haul/calendar';
import type { ScheduleInput } from '@haul/pricing';
import type { CityConfig } from './cities/index.js';

/**
 * ---------------------------------------------------------------------------
 * Building a ScheduleInput
 * ---------------------------------------------------------------------------
 * `ScheduleInput` is four derived facts about an instant, and every one of them
 * is wrong if you take it off the Date object directly. `getUTCHours()` is two
 * or three hours behind Jerusalem, so an 18:30 job — the first hour of the
 * evening band — reports 15 and prices as an afternoon. `getUTCMonth()` moves
 * every month boundary by the same offset, and the seasonal factor is the
 * largest single swing on the card. `dayKind` cannot be derived from a Date at
 * all without the Hebrew calendar.
 *
 * None of that throws. The quote comes back, it reconciles, it is simply the
 * wrong number — which is the failure this whole product exists to prevent. So
 * there is one sanctioned constructor and this is it.
 * ---------------------------------------------------------------------------
 */

/**
 * The only supported way to build a `ScheduleInput`.
 *
 * Do not assemble the object by hand. `dayKind`, `localHour` and `month` are
 * not independent fields a caller gets to fill in — they are three readings of
 * one instant in one timezone, and a caller who mixes a Jerusalem day with a
 * UTC hour produces a quote that is internally inconsistent and silently wrong.
 *
 * Takes the city because the day does not roll at midnight here. Shabbat and
 * yom tov start at candle lighting and end at nightfall, both of which depend
 * on where you are standing — Jerusalem lights 40 minutes before sunset, Tel
 * Aviv 18. So the civil-date classification is right for a 09:00 job and wrong
 * twice a week:
 *
 *   · A winter Friday at 17:00 is a `short_day` by the calendar and Shabbat in
 *     fact — Shabbat began at 16:20. Priced from the civil date it earns the
 *     Friday surcharge for a slot no truck can work.
 *   · A winter Saturday at 17:30 is `shabbat` by the calendar and an ordinary
 *     Sunday evening in fact, because nightfall has passed. Motzei Shabbat is
 *     one of the busiest moving windows of the week in Israel and it must not
 *     price as the dead day it follows.
 *
 * The roll applies only to days that carry a restricted period. It deliberately
 * does NOT apply every night, even though the Hebrew day does: rolling Thursday
 * 21:00 into Friday would attach a short-day surcharge to a perfectly ordinary
 * Thursday evening.
 *
 * `month` stays the civil month of `at` in every case. The seasonal factor is
 * about lease turnover in the school holidays, which is a Gregorian fact.
 */
export function scheduleInputFor(at: Date, city: CityConfig): ScheduleInput {
  const civil = dayInfoForDate(at);
  // `isDispatchableAt` is the city's own sunset-to-nightfall test, so
  // "restricted" here means the real boundary rather than the civil date.
  const inRestrictedPeriod = !isDispatchableAt(at, city.calendar);

  let effective = civil;
  if (inRestrictedPeriod) {
    effective = { ...civil, kind: restrictedKindFor(civil.kind) };
  } else if (civil.kind === DayKind.Shabbat || civil.kind === DayKind.Holiday) {
    // Nightfall has passed on a restricted day: the next day has begun.
    effective = dayInfoFor(civil.fixed + 1);
  }

  return {
    at,
    dayKind: effective.kind,
    isCholHaMoed: effective.isCholHaMoed,
    localHour: jerusalemHour(at),
    // Read off the civil day's own dateKey rather than by a second timezone
    // conversion, so the month and the day classification can never disagree
    // about which date this is.
    month: Number(civil.dateKey.slice(5, 7)),
  };
}

/**
 * The eve of a restricted day, once the restriction has started, IS the
 * restricted day. A Friday after candle lighting is Shabbat; a festival eve
 * after candle lighting is yom tov.
 */
function restrictedKindFor(civilKind: DayKind): DayKind {
  if (civilKind === DayKind.ShortDay) return DayKind.Shabbat;
  if (civilKind === DayKind.HolidayEve) return DayKind.Holiday;
  return civilKind;
}

/**
 * Jerusalem wall-clock hour, 0–23.
 *
 * Shifting the instant by the offset and reading it back as UTC, rather than
 * formatting and parsing: `Intl` has emitted "24" for midnight under some ICU
 * versions of `en-GB`, and an hour of 24 would sail past every bound check on
 * the way to the rate card.
 */
function jerusalemHour(at: Date): number {
  return new Date(at.getTime() + jerusalemOffsetMinutes(at) * 60_000).getUTCHours();
}
