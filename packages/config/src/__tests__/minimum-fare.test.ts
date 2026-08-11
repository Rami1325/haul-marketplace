import {
  advertisedMinimum,
  computeQuote,
  validateRateCard,
  type QuoteInput,
  type RateCard,
} from '@haul/pricing';
import {
  CraneNeed,
  DayKind,
  ElevatorKind,
  ParkingSituation,
  StopKind,
  extractVat,
  formatILS,
  shekels,
  type AccessDetails,
  type Agorot,
} from '@haul/types';
import { describe, expect, it } from 'vitest';
import { CATALOG_BY_ID } from '../catalog.js';
import { TEL_AVIV_RATE_CARD } from '../cities/tel-aviv.js';

/**
 * ---------------------------------------------------------------------------
 * The minimum fare is stored gross. Everything else on the card is net.
 * ---------------------------------------------------------------------------
 * One field on a card of thirty money fields uses the opposite VAT convention,
 * and getting it wrong costs nothing visible: the card parses, the engine runs,
 * the receipt reconciles, and the advertised "from ₪400" quietly becomes ₪338.98
 * — a 15% hole under exactly the smallest jobs, where the margin already is.
 *
 * These tests pin the two conventions to each other. The card says gross and the
 * engine reads gross, and neither can drift without one of these failing.
 * ---------------------------------------------------------------------------
 */

function access(overrides: Partial<AccessDetails> = {}): AccessDetails {
  return {
    floor: 0,
    elevator: ElevatorKind.None,
    stairFlights: 0,
    carryDistanceMeters: 0,
    parking: ParkingSituation.StreetEasy,
    narrowStairwell: false,
    crane: CraneNeed.NotNeeded,
    permitRequired: false,
    notes: null,
    ...overrides,
  };
}

/** The cheapest job the product can produce: one small box, no distance, ground floor. */
const TRIVIAL_JOB: QuoteInput = {
  cityId: 'tel-aviv',
  manifest: {
    lines: [
      {
        catalogItemId: 'box_small',
        quantity: 1,
        customLabel: null,
        stopIndex: 0,
        addedDuringJob: false,
        loadedAt: null,
        unloadedAt: null,
      },
    ],
    presetId: null,
    source: 'picker',
  },
  stops: [
    { kind: StopKind.Pickup, access: access() },
    { kind: StopKind.Dropoff, access: access() },
  ],
  routedDistanceMeters: 0,
  vehicleClassId: 'pickup',
  crewSize: 2,
  schedule: {
    at: new Date('2026-10-13T07:00:00Z'),
    dayKind: DayKind.Workday,
    isCholHaMoed: false,
    localHour: 9,
    month: 10, // neutral seasonal factor
  },
};

/**
 * Builds the card by spread rather than through `RateCardSchema`, deliberately:
 * the net-stored case below has to be constructible to be shown to cost less,
 * and the parser now refuses it. The convention under test is the engine's, not
 * the schema's.
 */
function withMinimum(gross: Agorot): RateCard {
  return { ...TEL_AVIV_RATE_CARD, minimumFare: advertisedMinimum(gross) } as RateCard;
}

describe('the advertised minimum fare', () => {
  it('passes the card validator', () => {
    // The validator no longer carries this rule on its own. It used to guess —
    // "an advertised minimum is a round number of shekels" — which caught ₪400
    // stored net (₪338.98) by luck and waved through every figure that is a
    // multiple of 59, ₪590 net being exactly ₪500. The schema now refuses a bare
    // integer outright, so what the validator reports here is only that nothing
    // else on the shipped card is off.
    expect(validateRateCard(TEL_AVIV_RATE_CARD)).toEqual([]);
  });

  it('charges exactly the stored figure when a job hits the floor', () => {
    // ₪900 rather than the card's real ₪400 because the shipped card's cheapest
    // base fare already exceeds ₪400 — see the test below. Everything else is
    // the real card, so what is being tested is the convention, not a fixture.
    const card = withMinimum(shekels(900));
    const result = computeQuote(TRIVIAL_JOB, card, CATALOG_BY_ID);

    expect(
      result.lockedTotal,
      `floored job quoted ${formatILS(result.lockedTotal, 'en')} against a stored minimum of ₪900`,
    ).toBe(shekels(900));
    expect(result.breakdown.lines.some((line) => line.key === 'minimum_fare')).toBe(true);
  });

  it('pays strictly less when the same figure is stored net — the bug, behaviourally', () => {
    const gross = computeQuote(TRIVIAL_JOB, withMinimum(shekels(900)), CATALOG_BY_ID);
    const netByMistake = extractVat(shekels(900), TEL_AVIV_RATE_CARD.vatRate).net;
    const buggy = computeQuote(TRIVIAL_JOB, withMinimum(netByMistake), CATALOG_BY_ID);

    expect(
      buggy.lockedTotal,
      `net-stored minimum quoted ${formatILS(buggy.lockedTotal, 'en')}, gross-stored ${formatILS(gross.lockedTotal, 'en')}`,
    ).toBeLessThan(gross.lockedTotal);
  });

  it('never lets a real job price below the advertised figure', () => {
    // Holds whether or not the floor binds, which is the point: the shipped card
    // advertises ₪400 while its cheapest base fare is ₪450, so today the floor is
    // slack. Drop a base fare and this is the test that notices.
    const result = computeQuote(TRIVIAL_JOB, TEL_AVIV_RATE_CARD, CATALOG_BY_ID);
    expect(
      result.lockedTotal,
      `cheapest possible job quoted ${formatILS(result.lockedTotal, 'en')}, advertised minimum ${formatILS(TEL_AVIV_RATE_CARD.minimumFare.amount, 'en')}`,
    ).toBeGreaterThanOrEqual(TEL_AVIV_RATE_CARD.minimumFare.amount);
  });
});

describe('the reschedule cutoff', () => {
  it('covers the night before the slot', () => {
    // The crew and the truck are assigned the evening before. A cutoff shorter
    // than that window protects nothing: the customer moves the job at 07:00 for
    // a 10:00 slot, and the driver has already turned down the alternative.
    expect(
      TEL_AVIV_RATE_CARD.rescheduleCutoffHours,
      'a cutoff inside the dispatch window leaves the driver holding the empty slot',
    ).toBeGreaterThanOrEqual(12);
  });
});
