import { StopKind, bps, shekels, type Manifest } from '@haul/types';
import { describe, expect, it } from 'vitest';
import { canonicalQuoteInput, parseCanonicalQuoteInput } from '../canonical-input.js';
import { computeQuote, type QuoteInput } from '../engine.js';
import { canonicalJson } from '../hash.js';
import {
  SMALL_MOVE,
  STOPS_GROUND_FLOOR,
  TEST_CATALOG,
  TEST_RATE_CARD,
  WORKDAY_SCHEDULE,
  access,
} from './fixtures.js';

const BASE: QuoteInput = {
  cityId: 'test-city',
  manifest: SMALL_MOVE,
  stops: [...STOPS_GROUND_FLOOR],
  routedDistanceMeters: 8_400,
  vehicleClassId: 'van',
  crewSize: 2,
  schedule: WORKDAY_SCHEDULE,
};

/** Mid-job manifest: the only place a `Date` other than `schedule.at` lives. */
const PART_LOADED: Manifest = {
  ...SMALL_MOVE,
  lines: SMALL_MOVE.lines.map((line, index) => ({
    ...line,
    loadedAt: index === 0 ? new Date('2026-08-09T10:15:00.000Z') : null,
    unloadedAt: index === 0 ? new Date('2026-08-09T11:40:30.500Z') : null,
  })),
};

const CASES: ReadonlyArray<readonly [string, QuoteInput]> = [
  ['a plain move', BASE],
  [
    'a discounted, protected, peak-hour move',
    {
      ...BASE,
      demandFactorBps: bps(11_500),
      promo: { code: 'FIRST50', amountOff: shekels(50) },
      protectionTierId: 'standard',
      schedule: { ...WORKDAY_SCHEDULE, isCholHaMoed: true, localHour: 19 },
    },
  ],
  [
    'a percentage promo with an ops crane override and split load shares',
    {
      ...BASE,
      promo: { code: 'WINTER10', percentOffBps: bps(1_000) },
      craneRules: { craneFromFloor: 4, neverBelowFloor: 2 },
      stops: [
        {
          kind: StopKind.Pickup,
          access: access({ floor: 5, stairFlights: 5, narrowStairwell: true, notes: 'שער אחורי' }),
          loadShare: 1,
        },
        { kind: StopKind.Dropoff, access: access({ floor: 2, stairFlights: 2 }), loadShare: 0.6 },
        { kind: StopKind.Dropoff, access: access({ carryDistanceMeters: 90 }), loadShare: 0.4 },
      ],
    },
  ],
  ['a manifest already part-loaded', { ...BASE, manifest: PART_LOADED }],
];

/** The whole point of the canonical form: nothing here may reach jsonb as a Date. */
function containsDate(value: unknown): boolean {
  if (value instanceof Date) return true;
  if (Array.isArray(value)) return value.some(containsDate);
  if (value !== null && typeof value === 'object') return Object.values(value).some(containsDate);
  return false;
}

describe('a stored pricing input re-derives the price it was stored for', () => {
  for (const [name, input] of CASES) {
    it(`replays ${name} to the same hash and the same total`, () => {
      const original = computeQuote(input, TEST_RATE_CARD, TEST_CATALOG);

      // Exactly what a jsonb column does to it and back.
      const stored: unknown = JSON.parse(JSON.stringify(canonicalQuoteInput(input)));
      const replayed = computeQuote(parseCanonicalQuoteInput(stored), TEST_RATE_CARD, TEST_CATALOG);

      expect(replayed.inputHash).toBe(original.inputHash);
      expect(replayed.lockedTotal).toBe(original.lockedTotal);
      expect(replayed.driverPayout).toBe(original.driverPayout);
    });
  }

  it('survives being stored and canonicalised again', () => {
    const stored: unknown = JSON.parse(JSON.stringify(canonicalQuoteInput(BASE)));
    expect(canonicalQuoteInput(parseCanonicalQuoteInput(stored))).toEqual(stored);
  });
});

describe('the Date/string boundary is crossed once, explicitly', () => {
  it('holds no Date anywhere in the stored form', () => {
    for (const [name, input] of CASES) {
      expect(containsDate(canonicalQuoteInput(input)), name).toBe(false);
    }
  });

  it('gives back a real Date rather than the string that was stored', () => {
    const stored: unknown = JSON.parse(
      JSON.stringify(canonicalQuoteInput({ ...BASE, manifest: PART_LOADED })),
    );
    expect(typeof canonicalQuoteInput(BASE).schedule.at).toBe('string');

    const parsed = parseCanonicalQuoteInput(stored);
    expect(parsed.schedule.at).toBeInstanceOf(Date);
    expect(parsed.schedule.at.getTime()).toBe(BASE.schedule.at.getTime());

    const loadedAt = parsed.manifest.lines[0]?.loadedAt;
    expect(loadedAt).toBeInstanceOf(Date);
    expect(loadedAt?.getTime()).toBe(PART_LOADED.lines[0]?.loadedAt?.getTime());
  });

  it('keeps sub-second precision, which a truncated timestamp would lose', () => {
    const stored: unknown = JSON.parse(
      JSON.stringify(canonicalQuoteInput({ ...BASE, manifest: PART_LOADED })),
    );
    const unloadedAt = parseCanonicalQuoteInput(stored).manifest.lines[0]?.unloadedAt;
    expect(unloadedAt?.getTime()).toBe(PART_LOADED.lines[0]?.unloadedAt?.getTime());
  });
});

describe('the stored text is stable', () => {
  it('is already in canonical order, so the bytes are comparable as they stand', () => {
    for (const [name, input] of CASES) {
      const canonical = canonicalQuoteInput(input);
      expect(JSON.stringify(canonical), name).toBe(canonicalJson(canonical));
    }
  });

  it('does not depend on the order the input was assembled in', () => {
    const assembledDifferently: QuoteInput = {
      schedule: {
        month: WORKDAY_SCHEDULE.month,
        localHour: WORKDAY_SCHEDULE.localHour,
        isCholHaMoed: WORKDAY_SCHEDULE.isCholHaMoed,
        dayKind: WORKDAY_SCHEDULE.dayKind,
        at: WORKDAY_SCHEDULE.at,
      },
      crewSize: BASE.crewSize,
      vehicleClassId: BASE.vehicleClassId,
      routedDistanceMeters: BASE.routedDistanceMeters,
      stops: BASE.stops,
      manifest: BASE.manifest,
      cityId: BASE.cityId,
    };
    expect(JSON.stringify(canonicalQuoteInput(assembledDifferently))).toBe(
      JSON.stringify(canonicalQuoteInput(BASE)),
    );
  });

  it('omits an absent optional rather than writing a null the hash would see', () => {
    const canonical = canonicalQuoteInput(BASE);
    expect('promo' in canonical).toBe(false);
    expect('demandFactorBps' in canonical).toBe(false);
    expect('protectionTierId' in canonical).toBe(false);
    expect('craneRules' in canonical).toBe(false);
    expect('loadShare' in (canonical.stops[0] ?? {})).toBe(false);
  });

  it('proves a re-price is the same job by comparing the stored text', () => {
    // What a booking-time re-price actually does: canonicalise the input it is
    // about to price and check it against the text the quote was issued from.
    const atBooking: QuoteInput = { ...BASE, stops: [...BASE.stops] };
    expect(JSON.stringify(canonicalQuoteInput(atBooking))).toBe(
      JSON.stringify(canonicalQuoteInput(BASE)),
    );

    const oneBoxMore: QuoteInput = {
      ...BASE,
      manifest: {
        ...SMALL_MOVE,
        lines: SMALL_MOVE.lines.map((line, index) =>
          index === 0 ? { ...line, quantity: line.quantity + 1 } : line,
        ),
      },
    };
    expect(JSON.stringify(canonicalQuoteInput(oneBoxMore))).not.toBe(
      JSON.stringify(canonicalQuoteInput(BASE)),
    );
  });
});
