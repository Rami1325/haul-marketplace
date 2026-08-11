import {
  QuoteSchema,
  idPrefixOf,
  isQuoteExpired,
  quoteSecondsRemaining,
  verifyBreakdown,
} from '@haul/types';
import { describe, expect, it } from 'vitest';
import { computeQuote, type QuoteInput } from '../engine.js';
import { toQuote } from '../to-quote.js';
import {
  SMALL_MOVE,
  STOPS_GROUND_FLOOR,
  TEST_CATALOG,
  TEST_RATE_CARD,
  WORKDAY_SCHEDULE,
  manifest,
} from './fixtures.js';

const ISSUED_AT = new Date('2026-08-09T09:00:00.000Z');

const INPUT: QuoteInput = {
  cityId: 'test-city',
  manifest: SMALL_MOVE,
  stops: [...STOPS_GROUND_FLOOR],
  routedDistanceMeters: 8_400,
  vehicleClassId: 'van',
  crewSize: 2,
  schedule: WORKDAY_SCHEDULE,
};

function issue(overrides: Partial<QuoteInput> = {}, card = TEST_RATE_CARD) {
  const input = { ...INPUT, ...overrides };
  const result = computeQuote(input, card, TEST_CATALOG);
  return { input, result, quote: toQuote(input, result, card, { issuedAt: ISSUED_AT }) };
}

describe('the quote records the price that was actually computed', () => {
  it('carries the priced numbers through without touching them', () => {
    const { result, quote } = issue();
    expect(quote.lockedTotal).toBe(result.lockedTotal);
    expect(quote.driverPayout).toBe(result.driverPayout);
    expect(quote.breakdown).toEqual(result.breakdown);
    expect(quote.estimatedWorkingMinutes).toBe(result.estimatedWorkingMinutes);
    expect(quote.recommendedVehicleClass).toBe(result.recommendedVehicleClass);
  });

  it('keeps a receipt that still adds up', () => {
    const { quote } = issue();
    expect(verifyBreakdown(quote.breakdown)).toEqual({ ok: true });
    expect(quote.breakdown.grossTotal).toBe(quote.lockedTotal);
  });

  it('copies the job description from the input, not from a default', () => {
    const { quote } = issue({ crewSize: 3, routedDistanceMeters: 21_500, cityId: 'other-city' });
    expect(quote.cityId).toBe('other-city');
    expect(quote.crewSize).toBe(3);
    expect(quote.routedDistanceMeters).toBe(21_500);
  });

  it('carries the provenance a price is explained from', () => {
    const { input, result, quote } = issue();
    expect(quote.engineVersion).toBe(result.engineVersion);
    expect(quote.rateCardVersion).toBe(TEST_RATE_CARD.version);
    // The hash is what ties the row to a replayable input, so it has to be the
    // hash of the input that was priced — not of anything reconstructed here.
    expect(quote.inputHash).toBe(computeQuote(input, TEST_RATE_CARD, TEST_CATALOG).inputHash);
  });

  it('is a record the persistence layer accepts as it stands', () => {
    const { quote } = issue({ manifest: manifest([['piano_upright', 1]]) });
    expect(QuoteSchema.safeParse(quote).success).toBe(true);
  });
});

describe('the lock has a start and an end', () => {
  it('takes the start from the caller, because the server owns the clock', () => {
    const { quote } = issue();
    expect(quote.issuedAt.getTime()).toBe(ISSUED_AT.getTime());
  });

  it('derives the expiry from the rate card, not from a constant in the app', () => {
    const { quote } = issue();
    expect(quote.expiresAt.getTime() - quote.issuedAt.getTime()).toBe(
      TEST_RATE_CARD.quoteValidityMinutes * 60_000,
    );

    const patient = { ...TEST_RATE_CARD, quoteValidityMinutes: 120 };
    const longer = toQuote(INPUT, computeQuote(INPUT, patient, TEST_CATALOG), patient, {
      issuedAt: ISSUED_AT,
    });
    expect(longer.expiresAt.getTime() - longer.issuedAt.getTime()).toBe(120 * 60_000);
  });

  it('starts the customer’s countdown at the full window and lapses at zero', () => {
    const { quote } = issue();
    expect(quoteSecondsRemaining(quote, ISSUED_AT)).toBe(TEST_RATE_CARD.quoteValidityMinutes * 60);
    expect(isQuoteExpired(quote, ISSUED_AT)).toBe(false);

    const oneMsLate = new Date(quote.expiresAt.getTime() + 1);
    expect(isQuoteExpired(quote, oneMsLate)).toBe(true);
    expect(quoteSecondsRemaining(quote, oneMsLate)).toBe(0);
  });
});

describe('identity and sign-off', () => {
  it('mints a quote id that says what it identifies', () => {
    const { quote } = issue();
    expect(idPrefixOf(quote.id)).toBe('qte');
  });

  it('uses an id minted earlier in the request when it is given one', () => {
    const result = computeQuote(INPUT, TEST_RATE_CARD, TEST_CATALOG);
    const quote = toQuote(INPUT, result, TEST_RATE_CARD, {
      issuedAt: ISSUED_AT,
      id: 'qte_idempotency_key',
    });
    expect(quote.id).toBe('qte_idempotency_key');
  });

  it('never signs off its own human review', () => {
    // `needsHumanReview` is a question for ops. Answering it here would make
    // the review threshold decorative.
    const { result, quote } = issue({
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
    expect(result.needsHumanReview).toBe(true);
    expect(quote.reviewedBy).toBeNull();
  });

  it('records the reviewer once ops has actually looked', () => {
    const result = computeQuote(INPUT, TEST_RATE_CARD, TEST_CATALOG);
    const quote = toQuote(INPUT, result, TEST_RATE_CARD, {
      issuedAt: ISSUED_AT,
      reviewedBy: 'ops_rachel',
    });
    expect(quote.reviewedBy).toBe('ops_rachel');
  });
});
