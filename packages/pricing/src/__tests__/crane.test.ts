import {
  CraneNeed,
  ParkingSituation,
  StopKind,
  type AccessDetails,
  type ManifestTotals,
} from '@haul/types';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CRANE_RULES, assessCraneNeed, craneIsPriced, type CraneRules } from '../crane.js';
import { computeQuote, type QuoteInput } from '../engine.js';
import { TEST_CATALOG, TEST_RATE_CARD, WORKDAY_SCHEDULE, access, manifest } from './fixtures.js';

/**
 * ---------------------------------------------------------------------------
 * The crane ladder, walked floor by floor
 * ---------------------------------------------------------------------------
 * Which floors reach a crane is a pricing policy — several hundred shekels on a
 * job that might total ₪1,900 — so it is walked here rather than sampled. The
 * defect these tests exist for was that floor 1 fell past every guard onto the
 * terminal "recommend and confirm", and floors 3, 4 and 5 (the only ones the
 * suite covered) all looked right while it did.
 *
 * `CraneNeed.Unknown` is the schema default, so an unanswered crane question is
 * the ordinary booking path and not an edge case. Every assessment below leaves
 * it unanswered unless the test is about the answer.
 * ---------------------------------------------------------------------------
 */

const CRANE_CANDIDATES: Pick<ManifestTotals, 'hasCraneCandidate' | 'craneCandidateVolumeM3'> = {
  hasCraneCandidate: true,
  craneCandidateVolumeM3: 2.2,
};

function assess(
  floor: number,
  rules: CraneRules = DEFAULT_CRANE_RULES,
  overrides: Partial<AccessDetails> = {},
) {
  return assessCraneNeed(
    access({ floor, stairFlights: Math.max(0, floor), ...overrides }),
    CRANE_CANDIDATES,
    rules,
  );
}

describe('the crane ladder under the default rules', () => {
  // craneFromFloor 3, neverBelowFloor 2. Below the hard floor a flight is
  // carried; the floor beneath the threshold is the one genuinely ambiguous
  // rung, so it is the only one that asks.
  const ladder: ReadonlyArray<readonly [floor: number, need: CraneNeed, confirm: boolean]> = [
    [-1, CraneNeed.NotNeeded, false],
    [0, CraneNeed.NotNeeded, false],
    [1, CraneNeed.NotNeeded, false],
    [2, CraneNeed.Recommended, true],
    [3, CraneNeed.Recommended, false],
    [4, CraneNeed.Recommended, false],
    [5, CraneNeed.Recommended, false],
    [6, CraneNeed.Recommended, false],
    [7, CraneNeed.Recommended, false],
    [12, CraneNeed.Recommended, false],
    [25, CraneNeed.Recommended, false],
  ];

  it('carries below the hard floor, asks on the rung beneath the threshold, hoists above it', () => {
    for (const [floor, need, confirm] of ladder) {
      const assessment = assess(floor);
      expect(assessment.need, `floor ${floor} need`).toBe(need);
      expect(assessment.needsCustomerConfirmation, `floor ${floor} confirmation`).toBe(confirm);
      expect(craneIsPriced(assessment), `floor ${floor} priced`).toBe(need !== CraneNeed.NotNeeded);
    }
  });

  it('says why in Hebrew on the floors it declines', () => {
    // A crane that is not booked still has to be explainable — the reason is
    // shown, not silently applied.
    expect(assess(1).reasonHe.length).toBeGreaterThan(0);
    expect(assess(1).reasonEn.toLowerCase()).toContain('stairs');
    expect(assess(1).volumeM3).toBe(0);
  });
});

describe('the hard floor holds against every inferred signal', () => {
  it('does not book a crane for a first floor with a stairwell the customer calls narrow', () => {
    // "One flight is carried, always." A narrow stairwell is the strongest
    // signal we infer from, and on the first floor it still does not buy a
    // crane — otherwise `neverBelowFloor` means nothing.
    const assessment = assess(1, DEFAULT_CRANE_RULES, { narrowStairwell: true });
    expect(assessment.need).toBe(CraneNeed.NotNeeded);
    expect(craneIsPriced(assessment)).toBe(false);
  });

  it('still obeys a customer who says a crane is required down there', () => {
    // Their answer wins over our inference: they have seen the staircase.
    const assessment = assess(1, DEFAULT_CRANE_RULES, { crane: CraneNeed.Required });
    expect(assessment.need).toBe(CraneNeed.Required);
  });

  it('recommends without asking on a narrow stairwell from the ask band up', () => {
    const assessment = assess(2, DEFAULT_CRANE_RULES, { narrowStairwell: true });
    expect(assessment.need).toBe(CraneNeed.Recommended);
    expect(assessment.needsCustomerConfirmation).toBe(false);
    expect(assessment.reasonHe).toContain('צר');
  });
});

describe('an ops override moves the whole ladder, not just the wording', () => {
  it('prices a crane away when the threshold is put out of reach', () => {
    const rules: CraneRules = { craneFromFloor: 60, neverBelowFloor: 60 };
    for (let floor = 0; floor < 60; floor += 1) {
      expect(craneIsPriced(assess(floor, rules)), `floor ${floor}`).toBe(false);
    }
    expect(assess(60, rules).need).toBe(CraneNeed.Recommended);
  });

  it('keeps the ask band against the threshold instead of everything beneath it', () => {
    // Raising only `craneFromFloor` must not leave floors 2–59 billable with a
    // question mark attached — that is a priced crane by another name.
    const rules: CraneRules = { craneFromFloor: 60, neverBelowFloor: 2 };
    for (let floor = 0; floor <= 58; floor += 1) {
      expect(craneIsPriced(assess(floor, rules)), `floor ${floor}`).toBe(false);
    }
    expect(assess(59, rules).needsCustomerConfirmation).toBe(true);
    expect(assess(60, rules).needsCustomerConfirmation).toBe(false);
  });

  it('lowers the ladder as readily as it raises it', () => {
    const rules: CraneRules = { craneFromFloor: 2, neverBelowFloor: 1 };
    expect(assess(0, rules).need).toBe(CraneNeed.NotNeeded);
    expect(assess(1, rules).needsCustomerConfirmation).toBe(true);
    expect(assess(2, rules).need).toBe(CraneNeed.Recommended);
    expect(assess(2, rules).needsCustomerConfirmation).toBe(false);
  });
});

// --- the same thing, in shekels ---------------------------------------------

const WARDROBE_MOVE = manifest([
  ['wardrobe_3_door', 1],
  ['box_medium', 10],
]);

function quote(overrides: Partial<QuoteInput> = {}) {
  const input: QuoteInput = {
    cityId: 'test-city',
    manifest: WARDROBE_MOVE,
    stops: [
      { kind: StopKind.Pickup, access: access() },
      { kind: StopKind.Dropoff, access: access() },
    ],
    routedDistanceMeters: 8_400,
    vehicleClassId: 'van',
    crewSize: 2,
    schedule: WORKDAY_SCHEDULE,
    ...overrides,
  };
  return computeQuote(input, TEST_RATE_CARD, TEST_CATALOG);
}

function stopsAt(floor: number, crane: CraneNeed) {
  return [
    {
      kind: StopKind.Pickup,
      access: access({
        floor,
        stairFlights: floor,
        parking: ParkingSituation.StreetHard,
        crane,
      }),
    },
    { kind: StopKind.Dropoff, access: access() },
  ];
}

describe('a first-floor walk-up is not a crane job', () => {
  it('quotes the same price whether or not the crane question was answered', () => {
    // The audit's reproduction: floor 1, no lift, contested parking, one
    // wardrobe. An unanswered question used to add a crane line the customer
    // never asked for and no mover would have quoted.
    const unanswered = quote({ stops: stopsAt(1, CraneNeed.Unknown) });
    const answeredNo = quote({ stops: stopsAt(1, CraneNeed.NotNeeded) });

    expect(unanswered.breakdown.lines.some((l) => l.key.startsWith('crane.'))).toBe(false);
    expect(unanswered.needsCraneConfirmation).toBe(false);
    expect(unanswered.lockedTotal).toBe(answeredNo.lockedTotal);
  });

  it('still hoists from the threshold up', () => {
    const third = quote({ stops: stopsAt(3, CraneNeed.Unknown) });
    expect(third.breakdown.lines.some((l) => l.key.startsWith('crane.'))).toBe(true);
  });
});

describe('the crane override is worth money, not only wording', () => {
  it('drops the crane line and the price when the threshold is raised past the stop', () => {
    const stops = stopsAt(4, CraneNeed.Unknown);
    const byDefault = quote({ stops });
    const overridden = quote({ stops, craneRules: { craneFromFloor: 60, neverBelowFloor: 60 } });

    expect(byDefault.breakdown.lines.some((l) => l.key.startsWith('crane.'))).toBe(true);
    expect(overridden.breakdown.lines.some((l) => l.key.startsWith('crane.'))).toBe(false);
    expect(overridden.lockedTotal).toBeLessThan(byDefault.lockedTotal);
  });
});
