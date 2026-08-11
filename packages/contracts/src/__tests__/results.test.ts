import { TransitionErrorCode, agorot } from '@haul/types';
import { describe, expect, it } from 'vitest';
import {
  BookJobOutcome,
  CancelJobOutcome,
  CreateQuoteOutcome,
  type BookJobResult,
  type CancelJobResult,
  type CreateQuoteResult,
} from '../results.js';
import { toJobSummary, toQuoteView } from '../views.js';
import { DRIVER, ISSUED_AT, VEHICLE, testJob, testQuote } from './fixtures.js';

/**
 * Result unions exist so a caller switches instead of catching. Two things have
 * to hold for that to be true, and neither is checked by reading the file: the
 * union and its constant list must name the same outcomes, and a switch over
 * the union must be exhaustive. Both are compile-time properties, so the tests
 * below are shaped to fail the typecheck rather than the run — the `never`
 * assignment in each handler is the assertion, and the runtime expectations
 * only prove the handlers were reached.
 */

/** True only when the two unions are the same set, in both directions. */
type SameOutcomes<A extends string, B extends string> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

const createQuoteOutcomesMatch: SameOutcomes<CreateQuoteResult['outcome'], CreateQuoteOutcome> =
  true;
const bookJobOutcomesMatch: SameOutcomes<BookJobResult['outcome'], BookJobOutcome> = true;
const cancelJobOutcomesMatch: SameOutcomes<CancelJobResult['outcome'], CancelJobOutcome> = true;

function describeCreateQuote(result: CreateQuoteResult): string {
  switch (result.outcome) {
    case CreateQuoteOutcome.Ok:
      return `ok:${result.quote.id}`;
    case CreateQuoteOutcome.DraftIncomplete:
      return `incomplete:${result.problems.length}`;
    case CreateQuoteOutcome.StaleCatalog:
      return `stale:${result.unknownItemIds.length}`;
    case CreateQuoteOutcome.CraneConfirmationNeeded:
      return `crane:${result.cranes.length}`;
    case CreateQuoteOutcome.NeedsHumanReview:
      return `review:${result.quote.id}`;
    default: {
      const unhandled: never = result;
      return unhandled;
    }
  }
}

function describeBookJob(result: BookJobResult): string {
  switch (result.outcome) {
    case BookJobOutcome.Ok:
      return `ok:${result.job.reference}`;
    case BookJobOutcome.DraftIncomplete:
      return `incomplete:${result.problems.length}`;
    case BookJobOutcome.QuoteExpired:
      return `expired:${result.expiredAt.toISOString()}`;
    case BookJobOutcome.PriceChanged:
      return `changed:${result.quote.lockedTotal}`;
    case BookJobOutcome.CraneConfirmationNeeded:
      return `crane:${result.cranes.length}`;
    case BookJobOutcome.PaymentFailed:
      return `payment:${result.code}:${result.retryable}`;
    default: {
      const unhandled: never = result;
      return unhandled;
    }
  }
}

function describeCancelJob(result: CancelJobResult): string {
  switch (result.outcome) {
    case CancelJobOutcome.Ok:
      return `ok:${result.cancellationFee}`;
    case CancelJobOutcome.AlreadyCancelled:
      return `already:${result.job.reference}`;
    case CancelJobOutcome.NotCancellable:
      return `no:${result.code}`;
    case CancelJobOutcome.ReasonNotPermitted:
      return `reason:${result.reasonCode}`;
    default: {
      const unhandled: never = result;
      return unhandled;
    }
  }
}

describe('every outcome is named exactly once', () => {
  it('keeps the constants and the union in step', () => {
    expect([createQuoteOutcomesMatch, bookJobOutcomesMatch, cancelJobOutcomesMatch]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('has no duplicate discriminants', () => {
    for (const outcomes of [CreateQuoteOutcome, BookJobOutcome, CancelJobOutcome]) {
      const values = Object.values(outcomes);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

describe('a caller can switch instead of catching', () => {
  const quote = toQuoteView(testQuote(), ISSUED_AT);
  const job = toJobSummary(testJob(), DRIVER, VEHICLE);

  it('handles every way a quote request ends', () => {
    const results: CreateQuoteResult[] = [
      { outcome: CreateQuoteOutcome.Ok, quote, serviceArea: null, previewMatched: true },
      {
        outcome: CreateQuoteOutcome.DraftIncomplete,
        problems: [{ code: 'empty_basket', path: 'basket', message: 'nothing to move' }],
      },
      { outcome: CreateQuoteOutcome.StaleCatalog, unknownItemIds: ['sofa_from_the_future'] },
      {
        outcome: CreateQuoteOutcome.CraneConfirmationNeeded,
        quote,
        cranes: [
          { stopIndex: 0, volumeM3: 2.3, reasonHe: 'מדרגות צרות', reasonEn: 'Narrow stairs' },
        ],
      },
      { outcome: CreateQuoteOutcome.NeedsHumanReview, quote },
    ];
    expect(results.map(describeCreateQuote)).toHaveLength(Object.keys(CreateQuoteOutcome).length);
  });

  it('handles every way a booking ends', () => {
    const results: BookJobResult[] = [
      { outcome: BookJobOutcome.Ok, job },
      { outcome: BookJobOutcome.DraftIncomplete, problems: [] },
      { outcome: BookJobOutcome.QuoteExpired, expiredAt: ISSUED_AT },
      { outcome: BookJobOutcome.PriceChanged, quote },
      { outcome: BookJobOutcome.CraneConfirmationNeeded, quote, cranes: [] },
      {
        outcome: BookJobOutcome.PaymentFailed,
        code: 'declined',
        retryable: false,
        message: 'issuer declined the authorization',
      },
    ];
    expect(results.map(describeBookJob)).toHaveLength(Object.keys(BookJobOutcome).length);
  });

  it('handles every way a cancellation ends', () => {
    const results: CancelJobResult[] = [
      { outcome: CancelJobOutcome.Ok, job, cancellationFee: agorot(0) },
      { outcome: CancelJobOutcome.AlreadyCancelled, job },
      {
        outcome: CancelJobOutcome.NotCancellable,
        state: 'completed',
        code: TransitionErrorCode.AlreadyTerminal,
        reason: 'job is already in terminal state "settled"',
      },
      { outcome: CancelJobOutcome.ReasonNotPermitted, reasonCode: 'no_driver_found' },
    ];
    expect(results.map(describeCancelJob)).toHaveLength(Object.keys(CancelJobOutcome).length);
  });

  it('states a free cancellation as zero rather than as a missing field', () => {
    const free: CancelJobResult = {
      outcome: CancelJobOutcome.Ok,
      job,
      cancellationFee: agorot(0),
    };
    expect(describeCancelJob(free)).toBe('ok:0');
  });
});
