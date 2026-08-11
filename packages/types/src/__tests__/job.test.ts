import { describe, expect, it } from 'vitest';
import {
  CANCELLATION_REASONS,
  CancellationReason,
  CancellationReasonSchema,
  CancellationSchema,
} from '../job.js';

/** The Hebrew Unicode block. */
const HEBREW = /[֐-׿]/;

function cancellation(overrides: Record<string, unknown> = {}) {
  return {
    cancelledBy: 'customer',
    cancelledAt: new Date('2026-03-01T09:00:00Z'),
    reasonCode: CancellationReason.PriceTooHigh,
    afterDriverCommitted: false,
    ...overrides,
  };
}

describe('the cancellation vocabulary', () => {
  it('gives every reason exactly one row of copy', () => {
    // A code with no row cannot be rendered; a row with no code cannot be
    // written. Either way one of the two surfaces silently falls back.
    const codes = Object.values(CancellationReason);
    const tabled = CANCELLATION_REASONS.map((r) => r.code);
    expect([...tabled].sort()).toEqual([...codes].sort());
    expect(new Set(tabled).size).toBe(tabled.length);
  });

  it('accepts every code in the table and nothing else', () => {
    for (const reason of CANCELLATION_REASONS) {
      expect(CancellationReasonSchema.parse(reason.code)).toBe(reason.code);
    }
    expect(CancellationReasonSchema.safeParse('customer_was_annoyed').success).toBe(false);
    expect(CancellationReasonSchema.safeParse('').success).toBe(false);
  });

  it('is closed against the free text it replaced', () => {
    // The whole point: ops could not group cancellations while any string was
    // a legal reason code, so a stale client's prose must now be rejected.
    for (const legacy of ['changed mind', 'לקוח ביטל', 'PRICE_TOO_HIGH', 'price too high']) {
      expect(CancellationReasonSchema.safeParse(legacy).success, legacy).toBe(false);
    }
  });

  it('carries a real Hebrew label and a distinct English one for every reason', () => {
    for (const reason of CANCELLATION_REASONS) {
      expect(reason.labelHe.trim(), reason.code).not.toBe('');
      expect(reason.labelEn.trim(), reason.code).not.toBe('');
      // Guards the copy-paste that leaves English sitting in the Hebrew slot on
      // a Hebrew-first product.
      expect(HEBREW.test(reason.labelHe), `${reason.code} labelHe`).toBe(true);
      expect(HEBREW.test(reason.labelEn), `${reason.code} labelEn`).toBe(false);
    }
  });

  it('keeps codes groupable and storable', () => {
    // Analytics group on this and the jobs table stores it in varchar(64).
    for (const reason of CANCELLATION_REASONS) {
      expect(reason.code).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(reason.code.length).toBeLessThanOrEqual(64);
    }
  });

  it('separates who is at fault from the same-sounding customer reasons', () => {
    // "Found another mover" and "price too high" both lose the job, but only
    // one of them is an answer about the number. They must stay distinct codes.
    expect(CancellationReason.CustomerFoundAnotherMover).not.toBe(CancellationReason.PriceTooHigh);
    expect(CancellationReason.NoDriverFound).not.toBe(CancellationReason.DriverCancelled);
  });
});

describe('a cancellation record', () => {
  it('records the code and leaves the prose to reasonText', () => {
    const parsed = CancellationSchema.parse(
      cancellation({
        reasonCode: CancellationReason.AddressUnreachable,
        reasonText: 'הרחוב נחסם בגלל עבודות',
      }),
    );
    expect(parsed.reasonCode).toBe(CancellationReason.AddressUnreachable);
    expect(parsed.reasonText).toBe('הרחוב נחסם בגלל עבודות');
  });

  it('defaults the prose to absent, because the code alone is enough to report on', () => {
    expect(CancellationSchema.parse(cancellation()).reasonText).toBeNull();
  });

  it('refuses a reason code outside the vocabulary', () => {
    expect(CancellationSchema.safeParse(cancellation({ reasonCode: 'other' })).success).toBe(false);
  });

  it('accepts every reason regardless of who cancelled', () => {
    // Ops write codes on a customer's behalf and vice versa; the vocabulary is
    // shared so both land in the same bucket in the console.
    for (const actor of ['customer', 'driver', 'ops', 'system'] as const) {
      for (const reason of CANCELLATION_REASONS) {
        const parsed = CancellationSchema.safeParse(
          cancellation({ cancelledBy: actor, reasonCode: reason.code }),
        );
        expect(parsed.success, `${actor}/${reason.code}`).toBe(true);
      }
    }
  });
});
