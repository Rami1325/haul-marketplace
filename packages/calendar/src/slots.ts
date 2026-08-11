import {
  DEFAULT_OPERATING_HOURS,
  dayInfoFor,
  dayInfoForISO,
  dispatchWindowsFor,
  type CalendarLocation,
  type Interval,
  type IsraeliDayInfo,
  type OperatingHours,
} from './israel.js';

/**
 * ---------------------------------------------------------------------------
 * Bookable days and slots
 * ---------------------------------------------------------------------------
 * `dispatchWindowsFor()` answers the operational question — what is open on
 * this date — one day at a time, in raw intervals. That is the right primitive
 * and the wrong shape for a month grid and a slot picker, which need two more
 * things from the same arithmetic. Both are things an app re-derives badly:
 *
 *  1. A run of days classified in one pass, carrying enough to paint a cell.
 *     Including whether the day is *busy*: Chol HaMoed is a demand spike
 *     wearing a festival's clothes — the country is off work for a week and a
 *     great many people move house — so a calendar that greys it out is wrong
 *     in the most expensive direction available.
 *  2. Windows cut into slots a customer can actually pick, with the dispatch
 *     lead time already applied. An arrival window opening in twenty minutes is
 *     one no driver can be sent to, and offering it is how a locked price turns
 *     into a cancelled job.
 *
 * Nothing here re-implements the calendar. Every answer comes from
 * `dayInfoFor()` and `dispatchWindowsFor()`; this module only reshapes them.
 * ---------------------------------------------------------------------------
 */

export interface BookableDay extends IsraeliDayInfo {
  /**
   * What is actually sellable, after operating hours, restricted periods and
   * the pre-Shabbat cushion. Empty on a day with nothing to offer.
   */
  windows: Interval[];
  /**
   * Anything at all to sell today.
   *
   * Deliberately not the inherited `isDispatchable`, which is the calendar's
   * answer — is any part of this civil day outside a restricted period — and
   * stays true for a Shabbat whose motzash tail is too short to clear
   * `minimumWindowMinutes`. This is the answer the UI needs: can the customer
   * tap this cell.
   */
  isBookable: boolean;
  /** Demand spikes today rather than disappearing. See `isHighDemandDay`. */
  isHighDemand: boolean;
}

/**
 * Days the business should treat as peak.
 *
 * Only Chol HaMoed so far, and it is kept as its own flag rather than aliased
 * to `isCholHaMoed` because the two say different things. `isCholHaMoed` is a
 * fact about the Hebrew calendar; this is the decision handed to pricing and to
 * the UI — mark this day busy — and the set of reasons behind it will grow
 * before its callers do.
 */
export function isHighDemandDay(day: IsraeliDayInfo): boolean {
  return day.isCholHaMoed;
}

function bookableDayFor(
  fixed: number,
  location: CalendarLocation,
  hours: OperatingHours,
): BookableDay {
  const info = dayInfoFor(fixed);
  const windows = dispatchWindowsFor(info.dateKey, location, hours);
  return {
    ...info,
    windows,
    isBookable: windows.length > 0,
    isHighDemand: isHighDemandDay(info),
  };
}

/**
 * A run of consecutive civil days, classified in one pass — the month grid's
 * data source.
 *
 * Takes a count rather than an end date because that is the question a grid
 * asks: six weeks from the first cell, whatever month boundaries fall inside
 * them.
 */
export function bookableDaysBetween(
  fromIso: string,
  days: number,
  location: CalendarLocation,
  hours: OperatingHours = DEFAULT_OPERATING_HOURS,
): BookableDay[] {
  if (!Number.isInteger(days) || days < 0) {
    throw new RangeError(`bookableDaysBetween: days must be a non-negative integer, got ${days}`);
  }

  const first = dayInfoForISO(fromIso);
  const result: BookableDay[] = [];
  for (let offset = 0; offset < days; offset++) {
    result.push(bookableDayFor(first.fixed + offset, location, hours));
  }
  return result;
}

/**
 * The next day with something to sell, counting `fromIso` itself.
 *
 * The horizon is there because "never" is a legitimate answer. The longest
 * unbookable stretch the Israeli calendar can produce is three days — two days
 * of Rosh Hashana running into Shabbat — so a fortnight of nothing does not
 * mean the calendar is busy, it means the operating hours passed in are
 * unsellable. Say so with null rather than searching forever.
 */
export function nextBookableDay(
  fromIso: string,
  location: CalendarLocation,
  hours: OperatingHours = DEFAULT_OPERATING_HOURS,
  horizonDays = 14,
): BookableDay | null {
  const first = dayInfoForISO(fromIso);
  for (let offset = 0; offset <= horizonDays; offset++) {
    const day = bookableDayFor(first.fixed + offset, location, hours);
    if (day.isBookable) return day;
  }
  return null;
}

/**
 * Cut a dispatch window into arrival windows a customer can pick.
 *
 * Slots run from the start of the window rather than snapping to the clock.
 * Snapping reads tidier — 21:00 beats 20:28 — but a window start is a real
 * boundary, not a rounding artefact: rounding it down offers a slot inside
 * Shabbat, and rounding it up throws away the opening half hour of motzei
 * Shabbat, one of the busiest moving windows of the week. A trailing remainder
 * shorter than a full slot is dropped, because half an arrival window is not a
 * bookable one.
 *
 * `now` is a parameter rather than a read of the clock so that a server
 * rendering the picker, a browser and a test pinned to a fixed instant all get
 * the same answer.
 */
export function sliceIntoSlots(
  window: Interval,
  slotMinutes: number,
  leadMinutes: number,
  now: Date = new Date(),
): Interval[] {
  if (!Number.isFinite(slotMinutes) || slotMinutes <= 0) {
    throw new RangeError(`sliceIntoSlots: slotMinutes must be positive, got ${slotMinutes}`);
  }
  if (!Number.isFinite(leadMinutes) || leadMinutes < 0) {
    throw new RangeError(`sliceIntoSlots: leadMinutes must not be negative, got ${leadMinutes}`);
  }

  const slotMs = slotMinutes * 60_000;
  const earliestStart = now.getTime() + leadMinutes * 60_000;
  const windowEnd = window.end.getTime();

  const slots: Interval[] = [];
  for (let start = window.start.getTime(); start + slotMs <= windowEnd; start += slotMs) {
    if (start < earliestStart) continue;
    slots.push({ start: new Date(start), end: new Date(start + slotMs) });
  }
  return slots;
}
