import {
  CraneNeed,
  DayKind,
  ElevatorKind,
  ParkingSituation,
  StopKind,
  bps,
  percent,
  shekels,
  verifyBreakdown,
} from '@haul/types';
import { describe, expect, it } from 'vitest';
import { computeQuote, type QuoteInput } from '../engine.js';
import { validateRateCard } from '../rate-card.js';
import {
  SMALL_MOVE,
  STOPS_GROUND_FLOOR,
  TEST_CATALOG,
  TEST_RATE_CARD,
  WORKDAY_SCHEDULE,
  access,
  manifest,
} from './fixtures.js';

function quote(overrides: Partial<QuoteInput> = {}) {
  const input: QuoteInput = {
    cityId: 'test-city',
    manifest: SMALL_MOVE,
    stops: [...STOPS_GROUND_FLOOR],
    routedDistanceMeters: 8_400,
    vehicleClassId: 'van',
    crewSize: 2,
    schedule: WORKDAY_SCHEDULE,
    ...overrides,
  };
  return computeQuote(input, TEST_RATE_CARD, TEST_CATALOG);
}

describe('the receipt always adds up', () => {
  it('sums lines to net, and net + VAT to gross', () => {
    const result = quote();
    expect(verifyBreakdown(result.breakdown)).toEqual({ ok: true });
  });

  it('adds up across a wide sweep of jobs', () => {
    // The one property that must never break. If a receipt does not reconcile,
    // the product's core promise is false.
    const variants: Partial<QuoteInput>[] = [];
    for (const distance of [0, 1_200, 8_400, 45_000]) {
      for (const crew of [1, 2, 3, 4]) {
        for (const floor of [0, 2, 5]) {
          variants.push({
            routedDistanceMeters: distance,
            crewSize: crew,
            stops: [
              { kind: StopKind.Pickup, access: access({ floor, stairFlights: floor }) },
              { kind: StopKind.Dropoff, access: access({ floor: 1, stairFlights: 1 }) },
            ],
          });
        }
      }
    }

    for (const variant of variants) {
      const result = quote(variant);
      const check = verifyBreakdown(result.breakdown);
      expect(check.ok, `${JSON.stringify(variant)} → ${check.reason}`).toBe(true);
    }
  });

  it('never produces a negative or zero total', () => {
    const result = quote({
      manifest: manifest([['box_medium', 1]]),
      routedDistanceMeters: 0,
      promo: { code: 'HUGE', percentOffBps: bps(9_000) },
    });
    expect(result.lockedTotal).toBeGreaterThan(0);
  });
});

describe('determinism', () => {
  it('produces an identical price and hash for identical inputs', () => {
    const a = quote();
    const b = quote();
    expect(b.lockedTotal).toBe(a.lockedTotal);
    expect(b.inputHash).toBe(a.inputHash);
  });

  it('changes the hash when any priced input changes', () => {
    const baseline = quote();
    const changes: Partial<QuoteInput>[] = [
      { routedDistanceMeters: 9_000 },
      { crewSize: 3 },
      { vehicleClassId: 'box_truck_4t' },
      { manifest: manifest([['box_medium', 13]]) },
      { schedule: { ...WORKDAY_SCHEDULE, dayKind: DayKind.ShortDay } },
      { demandFactorBps: bps(11_000) },
    ];
    for (const change of changes) {
      expect(quote(change).inputHash, JSON.stringify(change)).not.toBe(baseline.inputHash);
    }
  });
});

describe('the minimum fare and rounding', () => {
  it('never prices below the call-out minimum', () => {
    const result = quote({
      manifest: manifest([['box_medium', 1]]),
      routedDistanceMeters: 500,
      vehicleClassId: 'pickup',
      crewSize: 1,
    });
    expect(result.lockedTotal).toBeGreaterThanOrEqual(TEST_RATE_CARD.minimumFare);
  });

  it('rounds the gross to a clean figure', () => {
    // ₪247.83 reads as machine output; ₪250 reads as a price.
    for (const distance of [0, 3_300, 12_700, 31_100]) {
      const result = quote({ routedDistanceMeters: distance });
      expect(result.lockedTotal % TEST_RATE_CARD.roundGrossToAgorot).toBe(0);
    }
  });

  it('keeps the breakdown consistent after rounding', () => {
    const result = quote({ routedDistanceMeters: 7_777 });
    expect(verifyBreakdown(result.breakdown)).toEqual({ ok: true });
    expect(result.breakdown.grossTotal).toBe(result.lockedTotal);
  });
});

describe('the crane', () => {
  const withCraneCandidate = manifest([
    ['sofa_3_seat', 1],
    ['wardrobe_3_door', 1],
    ['box_medium', 10],
  ]);

  it('is recommended for a narrow stairwell with big furniture', () => {
    const result = quote({
      manifest: withCraneCandidate,
      stops: [
        {
          kind: StopKind.Pickup,
          access: access({ floor: 3, stairFlights: 3, narrowStairwell: true }),
        },
        { kind: StopKind.Dropoff, access: access() },
      ],
    });
    const pickup = result.craneAssessments[0]!.assessment;
    expect(pickup.need).toBe(CraneNeed.Recommended);
    expect(pickup.reasonHe).toContain('צר');
    expect(result.breakdown.lines.some((l) => l.key.startsWith('crane.'))).toBe(true);
  });

  it('is not needed when the lift takes furniture', () => {
    const result = quote({
      manifest: withCraneCandidate,
      stops: [
        {
          kind: StopKind.Pickup,
          access: access({ floor: 5, stairFlights: 5, elevator: ElevatorKind.Standard }),
        },
        { kind: StopKind.Dropoff, access: access() },
      ],
    });
    expect(result.craneAssessments[0]!.assessment.need).toBe(CraneNeed.NotNeeded);
    expect(result.breakdown.lines.some((l) => l.kind === 'crane')).toBe(false);
  });

  it('sees through a small lift, which is the trap', () => {
    // "Yes, there's an elevator" — but it takes people, not sofas.
    const result = quote({
      manifest: withCraneCandidate,
      stops: [
        {
          kind: StopKind.Pickup,
          access: access({ floor: 4, stairFlights: 4, elevator: ElevatorKind.Small }),
        },
        { kind: StopKind.Dropoff, access: access() },
      ],
    });
    expect(result.craneAssessments[0]!.assessment.need).toBe(CraneNeed.Recommended);
  });

  it('does not bill stairs and a crane for the same lift', () => {
    // Charging both is the double-billing that ends up in a one-star review.
    const stops = [
      {
        kind: StopKind.Pickup,
        access: access({ floor: 4, stairFlights: 4, narrowStairwell: true }),
      },
      { kind: StopKind.Dropoff, access: access() },
    ];
    const result = quote({ manifest: withCraneCandidate, stops });

    const stairLine = result.breakdown.lines.find((l) => l.key === 'access.stairs');
    const craneLine = result.breakdown.lines.find((l) => l.key.startsWith('crane.'));
    expect(craneLine).toBeDefined();
    // The pickup's four flights must not also appear as a stairs charge.
    expect(stairLine).toBeUndefined();
  });

  it('respects a customer who says no crane is needed', () => {
    const result = quote({
      manifest: withCraneCandidate,
      stops: [
        {
          kind: StopKind.Pickup,
          access: access({
            floor: 5,
            stairFlights: 5,
            narrowStairwell: true,
            crane: CraneNeed.NotNeeded,
          }),
        },
        { kind: StopKind.Dropoff, access: access() },
      ],
    });
    expect(result.craneAssessments[0]!.assessment.need).toBe(CraneNeed.NotNeeded);
  });

  it('asks rather than guesses on the ambiguous second floor', () => {
    const result = quote({
      manifest: withCraneCandidate,
      stops: [
        { kind: StopKind.Pickup, access: access({ floor: 2, stairFlights: 2 }) },
        { kind: StopKind.Dropoff, access: access() },
      ],
    });
    expect(result.needsCraneConfirmation).toBe(true);
  });
});

describe('multipliers', () => {
  it('charges more on a Friday than a Sunday', () => {
    const sunday = quote();
    const friday = quote({
      schedule: { ...WORKDAY_SCHEDULE, dayKind: DayKind.ShortDay },
    });
    expect(friday.lockedTotal).toBeGreaterThan(sunday.lockedTotal);
  });

  it('treats Chol HaMoed as peak, not as a holiday', () => {
    const ordinary = quote();
    const cholHaMoed = quote({
      schedule: { ...WORKDAY_SCHEDULE, isCholHaMoed: true },
    });
    expect(cholHaMoed.lockedTotal).toBeGreaterThan(ordinary.lockedTotal);
  });

  it('caps the demand factor', () => {
    const capped = quote({ demandFactorBps: bps(50_000) });
    const atCap = quote({ demandFactorBps: TEST_RATE_CARD.maxDemandFactorBps });
    expect(capped.lockedTotal).toBe(atCap.lockedTotal);
  });

  it('never discounts below the base via a demand factor under 1', () => {
    const normal = quote();
    const suppressed = quote({ demandFactorBps: bps(4_000) });
    expect(suppressed.lockedTotal).toBe(normal.lockedTotal);
  });

  it('does not scale the crane call-out or a piano surcharge by demand', () => {
    // These are third-party and fixed costs. Inflating them by evening demand
    // would raise the number with no underlying cost behind it.
    const stops = [
      { kind: StopKind.Pickup, access: access({ floor: 4, stairFlights: 4, narrowStairwell: true }) },
      { kind: StopKind.Dropoff, access: access() },
    ];
    const withPiano = manifest([
      ['piano_upright', 1],
      ['sofa_3_seat', 1],
    ]);

    const normal = quote({ manifest: withPiano, stops });
    const peak = quote({ manifest: withPiano, stops, demandFactorBps: bps(13_000) });

    const craneOf = (r: typeof normal) =>
      r.breakdown.lines.filter((l) => l.kind === 'crane').reduce((a, l) => a + l.amount, 0);
    const pianoOf = (r: typeof normal) =>
      r.breakdown.lines.filter((l) => l.kind === 'heavy_item').reduce((a, l) => a + l.amount, 0);

    expect(craneOf(peak)).toBe(craneOf(normal));
    expect(pianoOf(peak)).toBe(pianoOf(normal));
    expect(peak.lockedTotal).toBeGreaterThan(normal.lockedTotal);
  });

  it('never labels a surcharge as surge', () => {
    const peak = quote({ demandFactorBps: bps(13_000) });
    const text = JSON.stringify(peak.breakdown.lines);
    expect(text.toLowerCase()).not.toContain('surge');
    expect(text).not.toContain('תמחור דינמי');
  });
});

describe('promotions come out of our margin, not the driver’s', () => {
  it('pays the driver on the undiscounted fare', () => {
    const full = quote();
    const discounted = quote({ promo: { code: 'FIRST50', amountOff: shekels(50) } });

    expect(discounted.lockedTotal).toBeLessThan(full.lockedTotal);
    // The whole point: the driver's number does not move because a customer
    // had a code. Rounding may shift it by a few agorot, not by the discount.
    expect(Math.abs(discounted.driverPayout - full.driverPayout)).toBeLessThan(shekels(2));
  });

  it('reports the discount so the ledger can book it as marketing spend', () => {
    const discounted = quote({ promo: { code: 'FIRST50', amountOff: shekels(50) } });
    expect(discounted.promoAmountGross).toBeGreaterThan(0);
  });

  it('cannot discount a job below the minimum fare', () => {
    const result = quote({
      manifest: manifest([['box_medium', 2]]),
      routedDistanceMeters: 800,
      promo: { code: 'MASSIVE', percentOffBps: bps(9_500) },
    });
    expect(result.lockedTotal).toBeGreaterThanOrEqual(TEST_RATE_CARD.minimumFare);
  });
});

describe('access is priced honestly', () => {
  it('charges more for stairs than for a lift', () => {
    const stairs = quote({
      stops: [
        { kind: StopKind.Pickup, access: access({ floor: 4, stairFlights: 4 }) },
        { kind: StopKind.Dropoff, access: access() },
      ],
    });
    const lift = quote({
      stops: [
        {
          kind: StopKind.Pickup,
          access: access({ floor: 4, stairFlights: 4, elevator: ElevatorKind.Standard }),
        },
        { kind: StopKind.Dropoff, access: access() },
      ],
    });
    expect(stairs.lockedTotal).toBeGreaterThan(lift.lockedTotal);
  });

  it('charges for a long carry only beyond the free allowance', () => {
    const inside = quote({
      stops: [
        { kind: StopKind.Pickup, access: access({ carryDistanceMeters: 15 }) },
        { kind: StopKind.Dropoff, access: access() },
      ],
    });
    const beyond = quote({
      stops: [
        { kind: StopKind.Pickup, access: access({ carryDistanceMeters: 80 }) },
        { kind: StopKind.Dropoff, access: access() },
      ],
    });
    expect(inside.breakdown.lines.some((l) => l.key === 'access.carry')).toBe(false);
    expect(beyond.lockedTotal).toBeGreaterThan(inside.lockedTotal);
  });

  it('charges for contested parking', () => {
    const easy = quote();
    const hard = quote({
      stops: [
        { kind: StopKind.Pickup, access: access({ parking: ParkingSituation.StreetHard }) },
        { kind: StopKind.Dropoff, access: access() },
      ],
    });
    expect(hard.lockedTotal).toBeGreaterThan(easy.lockedTotal);
  });

  it('charges for extra stops', () => {
    const single = quote();
    const multi = quote({
      stops: [
        { kind: StopKind.Pickup, access: access() },
        { kind: StopKind.Dropoff, access: access() },
        { kind: StopKind.Dropoff, access: access() },
      ],
    });
    expect(multi.lockedTotal).toBeGreaterThan(single.lockedTotal);
  });
});

describe('monotonicity — more work always costs more', () => {
  it('prices more items above fewer', () => {
    let previous = 0;
    for (const count of [1, 5, 10, 20, 40]) {
      const result = quote({ manifest: manifest([['box_medium', count]]) });
      expect(result.lockedTotal, `${count} boxes`).toBeGreaterThanOrEqual(previous);
      previous = result.lockedTotal;
    }
  });

  it('prices more distance above less', () => {
    let previous = 0;
    for (const meters of [0, 5_000, 15_000, 40_000, 90_000]) {
      const result = quote({ routedDistanceMeters: meters });
      expect(result.lockedTotal, `${meters}m`).toBeGreaterThanOrEqual(previous);
      previous = result.lockedTotal;
    }
  });

  it('prices more floors above fewer', () => {
    let previous = 0;
    for (const floor of [0, 1, 2, 3]) {
      const result = quote({
        manifest: manifest([['box_medium', 20]]), // no crane candidates
        stops: [
          { kind: StopKind.Pickup, access: access({ floor, stairFlights: floor }) },
          { kind: StopKind.Dropoff, access: access() },
        ],
      });
      expect(result.lockedTotal, `floor ${floor}`).toBeGreaterThanOrEqual(previous);
      previous = result.lockedTotal;
    }
  });
});

describe('the driver’s side', () => {
  it('leaves a take rate inside the band the model assumes', () => {
    const result = quote();
    const takeShare = (result.lockedTotal - result.driverPayout) / result.lockedTotal;
    // Plan §08: below 15% doesn't cover costs, above 25% drivers organise off-platform.
    expect(takeShare).toBeGreaterThan(0.15);
    expect(takeShare).toBeLessThan(0.25);
  });

  it('flags a large quote for human review', () => {
    const big = quote({
      manifest: manifest([
        ['wardrobe_3_door', 4],
        ['sofa_3_seat', 3],
        ['fridge_large', 2],
        ['piano_upright', 1],
        ['box_medium', 80],
      ]),
      routedDistanceMeters: 60_000,
      crewSize: 4,
      vehicleClassId: 'box_truck_8t',
    });
    expect(big.needsHumanReview).toBe(true);
    expect(quote().needsHumanReview).toBe(false);
  });
});

describe('resilience', () => {
  it('still quotes when the client sends an unknown item id', () => {
    // A stale client must never be able to stop the server quoting.
    const result = quote({
      manifest: manifest([
        ['box_medium', 5],
        ['item_that_does_not_exist', 2],
      ]),
    });
    expect(result.lockedTotal).toBeGreaterThan(0);
    expect(result.unknownItemIds).toContain('item_that_does_not_exist');
  });
});

describe('rate card validation', () => {
  it('accepts the test card', () => {
    expect(validateRateCard(TEST_RATE_CARD)).toEqual([]);
  });

  it('rejects a take rate outside the workable band', () => {
    expect(
      validateRateCard({ ...TEST_RATE_CARD, driverShareBps: bps(9_000) }),
    ).toContainEqual(expect.stringContaining('take rate'));
  });

  it('rejects a demand cap that would read as surge', () => {
    expect(
      validateRateCard({ ...TEST_RATE_CARD, maxDemandFactorBps: bps(20_000) }),
    ).toContainEqual(expect.stringContaining('surge'));
  });

  it('rejects a thin buffer on a locked price', () => {
    expect(
      validateRateCard({
        ...TEST_RATE_CARD,
        workingMinutes: { ...TEST_RATE_CARD.workingMinutes, bufferBps: bps(100) },
      }),
    ).toContainEqual(expect.stringContaining('buffer'));
  });

  it('rejects a nonsense VAT-adjacent time factor', () => {
    expect(
      validateRateCard({
        ...TEST_RATE_CARD,
        timeFactorBps: { ...TEST_RATE_CARD.timeFactorBps, workday: bps(30_000) },
      }),
    ).toContainEqual(expect.stringContaining('time factor'));
  });
});

describe('VAT', () => {
  it('quotes VAT-inclusive, as Israeli consumer prices must be', () => {
    const result = quote();
    expect(result.breakdown.vatRate).toBe(percent(18));
    expect(result.breakdown.netSubtotal + result.breakdown.vat).toBe(result.lockedTotal);
    expect(result.breakdown.vat).toBeGreaterThan(0);
  });
});
