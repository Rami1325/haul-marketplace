import { bps, shekels } from '@haul/types';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { CraneRules } from '../crane.js';
import {
  computeQuote,
  type PromoInput,
  type QuoteInput,
  type QuoteStopInput,
  type ScheduleInput,
} from '../engine.js';
import {
  type CraneRulesSchema,
  type PromoInputSchema,
  QuoteInputSchema,
  type QuoteStopInputSchema,
  type ScheduleInputSchema,
} from '../input-schema.js';
import { TEST_CATALOG, TEST_RATE_CARD } from './fixtures.js';

/**
 * Mutual assignability *and* key-set equality.
 *
 * Assignability alone would accept a field that exists on one side only, as
 * long as it were optional — which is precisely the drift that matters: an
 * optional field on the type that the schema does not know about is a field a
 * client can send and nothing checks.
 */
type Mirrors<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? [keyof A] extends [keyof B]
      ? [keyof B] extends [keyof A]
        ? true
        : false
      : false
    : false
  : false;

/** A request body as it arrives: JSON, so dates are strings and nothing is branded. */
function rawBody(overrides: Record<string, unknown> = {}): unknown {
  return {
    cityId: 'test-city',
    manifest: {
      lines: [
        { catalogItemId: 'box_medium', quantity: 12 },
        { catalogItemId: 'sofa_3_seat', quantity: 1 },
      ],
      presetId: null,
      source: 'picker',
    },
    stops: [
      {
        kind: 'pickup',
        access: { floor: 0, elevator: 'none', stairFlights: 0, parking: 'street_easy' },
      },
      {
        kind: 'dropoff',
        access: { floor: 3, elevator: 'none', stairFlights: 3, parking: 'street_hard' },
      },
    ],
    routedDistanceMeters: 8_400,
    vehicleClassId: 'van',
    crewSize: 2,
    schedule: {
      at: '2026-08-09T09:00:00.000Z',
      dayKind: 'workday',
      isCholHaMoed: false,
      localHour: 10,
      month: 3,
    },
    ...overrides,
  };
}

describe('the schema is the QuoteInput type, not an approximation of it', () => {
  it('mirrors QuoteInput in both directions, field for field', () => {
    // This fails to *compile*, not merely to run, the moment either side gains
    // or loses a field. The assertion below only carries it into the report.
    const mirrors: Mirrors<z.infer<typeof QuoteInputSchema>, QuoteInput> = true;
    expect(mirrors).toBe(true);
  });

  it('mirrors every sub-shape', () => {
    const stop: Mirrors<z.infer<typeof QuoteStopInputSchema>, QuoteStopInput> = true;
    const schedule: Mirrors<z.infer<typeof ScheduleInputSchema>, ScheduleInput> = true;
    const promo: Mirrors<z.infer<typeof PromoInputSchema>, PromoInput> = true;
    const craneRules: Mirrors<z.infer<typeof CraneRulesSchema>, CraneRules> = true;
    expect([stop, schedule, promo, craneRules]).toEqual([true, true, true, true]);
  });
});

describe('parsing an untrusted body', () => {
  it('produces something the engine prices without a cast', () => {
    const input = QuoteInputSchema.parse(rawBody());
    const result = computeQuote(input, TEST_RATE_CARD, TEST_CATALOG);
    expect(result.lockedTotal).toBeGreaterThan(0);
  });

  it('turns the ISO instant back into a Date', () => {
    const input = QuoteInputSchema.parse(rawBody());
    expect(input.schedule.at).toBeInstanceOf(Date);
    expect(input.schedule.at.toISOString()).toBe('2026-08-09T09:00:00.000Z');
  });

  it('drops anything the engine does not take, so a price cannot be smuggled in', () => {
    const input = QuoteInputSchema.parse(
      rawBody({ lockedTotal: 1, driverPayout: 999, inputHash: 'forged' }),
    );
    expect(Object.keys(input)).not.toContain('lockedTotal');
    expect(computeQuote(input, TEST_RATE_CARD, TEST_CATALOG).lockedTotal).toBeGreaterThan(1);
  });

  it('leaves an omitted optional omitted rather than defaulting it to null', () => {
    // A null is a value the input hash would see. Absent has to stay absent or
    // a parsed input stops hashing like the one it was parsed from.
    const input = QuoteInputSchema.parse(rawBody());
    expect('promo' in input).toBe(false);
    expect('demandFactorBps' in input).toBe(false);
    expect('craneRules' in input).toBe(false);
  });

  it('refuses a body that could only come from a bug or an attacker', () => {
    const rejected: Array<[string, unknown]> = [
      ['no destination', rawBody({ stops: [(rawBody() as { stops: unknown[] }).stops[0]] })],
      ['a crew of nobody', rawBody({ crewSize: 0 })],
      ['negative distance', rawBody({ routedDistanceMeters: -1 })],
      ['fractional metres', rawBody({ routedDistanceMeters: 8_400.5 })],
      ['a thirteenth month', rawBody({ schedule: { ...scheduleOf(rawBody()), month: 13 } })],
      ['an hour off the clock', rawBody({ schedule: { ...scheduleOf(rawBody()), localHour: 24 } })],
      [
        'a day kind nobody has',
        rawBody({ schedule: { ...scheduleOf(rawBody()), dayKind: 'tuesday' } }),
      ],
      ['an unparseable instant', rawBody({ schedule: { ...scheduleOf(rawBody()), at: 'soon' } })],
      ['an empty manifest', rawBody({ manifest: { lines: [], presetId: null, source: 'picker' } })],
      ['a vehicle we do not run', rawBody({ vehicleClassId: 'helicopter' })],
      ['a stop carrying more than the whole load', rawBody({ stops: stopsWithShare(3) })],
    ];
    for (const [name, body] of rejected) {
      expect(QuoteInputSchema.safeParse(body).success, name).toBe(false);
    }
  });

  it('refuses a promo code that discounts nothing', () => {
    // The customer typed a code and would be told it worked while the total
    // never moved. Better to reject it than to lie quietly.
    expect(QuoteInputSchema.safeParse(rawBody({ promo: { code: 'GHOST' } })).success).toBe(false);
    expect(
      QuoteInputSchema.safeParse(rawBody({ promo: { code: 'FIRST50', amountOff: shekels(50) } }))
        .success,
    ).toBe(true);
  });

  it('accepts every optional the engine understands', () => {
    const input = QuoteInputSchema.parse(
      rawBody({
        demandFactorBps: bps(11_000),
        promo: { code: 'FIRST50', percentOffBps: bps(1_000) },
        protectionTierId: 'standard',
        craneRules: { craneFromFloor: 4, neverBelowFloor: 2 },
      }),
    );
    const result = computeQuote(input, TEST_RATE_CARD, TEST_CATALOG);
    expect(result.breakdown.lines.some((l) => l.kind === 'protection')).toBe(true);
    expect(result.promoAmountGross).toBeGreaterThan(0);
  });
});

function scheduleOf(body: unknown): Record<string, unknown> {
  return (body as { schedule: Record<string, unknown> }).schedule;
}

function stopsWithShare(loadShare: number): unknown {
  const stops = (rawBody() as { stops: Record<string, unknown>[] }).stops;
  return stops.map((stop) => ({ ...stop, loadShare }));
}
