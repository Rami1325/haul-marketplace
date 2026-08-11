import { CANCELLATION_REASONS, CancellationReason } from '@haul/types';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  BookJobRequestSchema,
  CUSTOMER_CANCELLATION_REASONS,
  CancelJobRequestSchema,
  CreateQuoteRequestSchema,
  isCustomerSelectableReason,
} from '../requests.js';

/**
 * ---------------------------------------------------------------------------
 * The price authority rule, enforced
 * ---------------------------------------------------------------------------
 * The rule is that a request body cannot carry money. The rule is not "we
 * reviewed it once" — it is this walk over every request schema in the package,
 * nested, failing on any key that reads like a price. A field added in a hurry
 * for the refund path fails here, which is the point at which adding it is
 * still a conversation rather than an incident.
 *
 * The pattern is deliberately blunt. A false positive costs a rename; a false
 * negative costs the product's only promise.
 * ---------------------------------------------------------------------------
 */
const MONEY_KEY =
  /(price|total|amount|agorot|shekel|fare|cost|payout|discount|vat|charge|fee|money|balance|tip|breakdown|surcharge)/i;

/** Every key in a schema, nested through objects, arrays, optionals and defaults. */
function keysOf(schema: z.ZodType, seen = new Set<z.ZodType>()): string[] {
  if (seen.has(schema)) return [];
  seen.add(schema);

  if (schema instanceof z.ZodObject) {
    const shape: Record<string, z.ZodType> = schema.shape;
    return Object.entries(shape).flatMap(([key, value]) => [key, ...keysOf(value, seen)]);
  }
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodReadonly
  ) {
    return keysOf(schema.unwrap() as z.ZodType, seen);
  }
  if (schema instanceof z.ZodArray) {
    return keysOf(schema.element as z.ZodType, seen);
  }
  return [];
}

const REQUEST_SCHEMAS: ReadonlyArray<[string, z.ZodType]> = [
  ['CreateQuoteRequestSchema', CreateQuoteRequestSchema],
  ['BookJobRequestSchema', BookJobRequestSchema],
  ['CancelJobRequestSchema', CancelJobRequestSchema],
];

describe('no request body can carry a price', () => {
  it.each(REQUEST_SCHEMAS)('%s has no money-shaped key', (_name, schema) => {
    const offenders = keysOf(schema).filter((key) => MONEY_KEY.test(key));
    expect(offenders).toEqual([]);
  });

  it('the walker would actually catch one', () => {
    // Guarding the guard: a key test that cannot fail is decoration.
    const bad = z.object({ draftId: z.string(), quoted: z.object({ lockedTotal: z.number() }) });
    expect(keysOf(bad).filter((key) => MONEY_KEY.test(key))).toEqual(['lockedTotal']);
  });

  it('strips a money field a client sends anyway', () => {
    const parsed = CreateQuoteRequestSchema.parse({
      draftId: 'drf_1',
      lockedTotal: 1,
      breakdown: { grossTotal: 1 },
    });
    expect(parsed).toEqual({ draftId: 'drf_1', previewHash: null });
  });
});

describe('CreateQuoteRequest', () => {
  it('needs the draft and nothing else', () => {
    expect(CreateQuoteRequestSchema.parse({ draftId: 'drf_1' })).toEqual({
      draftId: 'drf_1',
      previewHash: null,
    });
  });

  it('accepts a preview hash for drift telemetry', () => {
    const parsed = CreateQuoteRequestSchema.parse({ draftId: 'drf_1', previewHash: 'abc123' });
    expect(parsed.previewHash).toBe('abc123');
  });

  it('refuses a body with no draft to price', () => {
    expect(CreateQuoteRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('BookJobRequest', () => {
  const valid = {
    quoteId: 'qte_1',
    draftId: 'drf_1',
    paymentMethodToken: 'tok_live_1',
    idempotencyKey: 'book-0f3a9c21',
  };

  it('carries the quote, the draft and a card token', () => {
    const parsed = BookJobRequestSchema.parse(valid);
    expect(parsed.quoteId).toBe('qte_1');
    expect(parsed.draftId).toBe('drf_1');
    expect(parsed.previewHash).toBeNull();
  });

  it('will not book without an idempotency key, because this one moves money', () => {
    expect(BookJobRequestSchema.safeParse({ ...valid, idempotencyKey: undefined }).success).toBe(
      false,
    );
    expect(BookJobRequestSchema.safeParse({ ...valid, idempotencyKey: 'short' }).success).toBe(
      false,
    );
  });
});

describe('CancelJobRequest', () => {
  const valid = {
    jobId: 'job_1',
    reasonCode: CancellationReason.PriceTooHigh,
    idempotencyKey: 'cancel-0f3a9c21',
  };

  it('takes a code from the closed vocabulary', () => {
    expect(CancelJobRequestSchema.parse(valid).reasonCode).toBe(CancellationReason.PriceTooHigh);
  });

  it('refuses the free text the code replaced', () => {
    for (const prose of ['price too high', 'PRICE_TOO_HIGH', 'too expensive', '']) {
      expect(CancelJobRequestSchema.safeParse({ ...valid, reasonCode: prose }).success).toBe(false);
    }
  });

  it('keeps room for the specifics a human reads', () => {
    const parsed = CancelJobRequestSchema.parse({ ...valid, reasonText: 'הדירה עוד לא פנויה' });
    expect(parsed.reasonText).toBe('הדירה עוד לא פנויה');
    expect(CancelJobRequestSchema.parse(valid).reasonText).toBeNull();
  });

  it('has no acknowledgement-of-fee field for a client to answer stale', () => {
    expect(Object.keys(CancelJobRequestSchema.shape).sort()).toEqual([
      'idempotencyKey',
      'jobId',
      'reasonCode',
      'reasonText',
    ]);
  });
});

describe('which cancellation reasons a customer may file', () => {
  it('is a subset of the vocabulary, not a second list', () => {
    const vocabulary = CANCELLATION_REASONS.map((entry) => entry.code);
    for (const reason of CUSTOMER_CANCELLATION_REASONS) {
      expect(vocabulary).toContain(reason);
    }
  });

  it('excludes every bucket that measures us rather than the customer', () => {
    for (const reason of [
      CancellationReason.NoDriverFound,
      CancellationReason.DriverCancelled,
      CancellationReason.PaymentFailed,
      CancellationReason.OpsCancelled,
      CancellationReason.AddressUnreachable,
      CancellationReason.ItemRefusedAtPickup,
    ]) {
      expect(isCustomerSelectableReason(reason)).toBe(false);
    }
  });

  it('includes the reasons only the customer knows', () => {
    for (const reason of [
      CancellationReason.CustomerChangedPlans,
      CancellationReason.CustomerFoundAnotherMover,
      CancellationReason.PriceTooHigh,
      CancellationReason.DateChanged,
      CancellationReason.DuplicateBooking,
    ]) {
      expect(isCustomerSelectableReason(reason)).toBe(true);
    }
  });

  it('leaves the schema open to the full vocabulary, because ops posts here too', () => {
    const parsed = CancelJobRequestSchema.safeParse({
      jobId: 'job_1',
      reasonCode: CancellationReason.OpsCancelled,
      idempotencyKey: 'cancel-0f3a9c21',
    });
    expect(parsed.success).toBe(true);
  });
});
