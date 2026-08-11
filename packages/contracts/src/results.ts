import type { ServiceAreaCheck } from '@haul/config';
import type { PaymentErrorCode } from '@haul/payments';
import type { Agorot, JobState, TransitionErrorCode } from '@haul/types';
import type { DraftProblem } from './to-quote-input.js';
import type { JobSummary, QuoteView } from './views.js';

/**
 * ---------------------------------------------------------------------------
 * Result unions — every way each call can end
 * ---------------------------------------------------------------------------
 * Discriminated on `outcome`, so a caller switches and the compiler tells them
 * which branch they forgot. The alternative — success plus thrown errors — puts
 * the interesting cases in a catch block, and the interesting cases here are
 * not exceptional. A quote lapsing while the customer reads it is a Tuesday. So
 * is a crane we cannot decide about without asking.
 *
 * Money appears on results and never on requests. A response is the server
 * telling the customer what the price is, which is the whole point; a request
 * carrying one is the customer telling the server, which is the whole problem.
 *
 * Error codes are borrowed rather than reinvented: `PaymentErrorCode` from
 * `@haul/payments` and `TransitionErrorCode` from `@haul/types`. A second
 * dialect for the same failure is a translation table somebody has to maintain
 * and will eventually get wrong in the branch nobody tested.
 * ---------------------------------------------------------------------------
 */

/**
 * A crane the engine thinks is needed and could not decide alone.
 *
 * Shown, never silently applied — a surprise crane line is exactly the bill
 * shock the product exists to avoid — which is why the reason travels in both
 * languages rather than as a code the client has to have copy for.
 */
export interface CraneConfirmation {
  /** Position in the draft's `stops` array. */
  readonly stopIndex: number;
  readonly volumeM3: number;
  readonly reasonHe: string;
  readonly reasonEn: string;
}

// --- create quote -----------------------------------------------------------

export const CreateQuoteOutcome = {
  Ok: 'ok',
  /** The draft cannot be priced yet. `problems` says what is missing. */
  DraftIncomplete: 'draft_incomplete',
  /** The client priced items this server's catalog does not have. */
  StaleCatalog: 'stale_catalog',
  /** A crane materially changes the price and the customer has to answer first. */
  CraneConfirmationNeeded: 'crane_confirmation_needed',
  /** Above the rate card's threshold. A human signs off before it is honoured. */
  NeedsHumanReview: 'needs_human_review',
} as const;
export type CreateQuoteOutcome = (typeof CreateQuoteOutcome)[keyof typeof CreateQuoteOutcome];

export type CreateQuoteResult =
  | {
      readonly outcome: typeof CreateQuoteOutcome.Ok;
      readonly quote: QuoteView;
      /**
       * Where the pickup sits relative to the city's service area, with the
       * sentence to show for it. NOT a refusal — `serviceAreaFor` is explicitly
       * not a gate, and at launch a hard block on a soft edge throws away the
       * jobs a dispatcher would happily take by hand.
       */
      readonly serviceArea: ServiceAreaCheck | null;
      /**
       * Whether the client's `previewHash` matched the server's price. Null
       * when the client sent none. Telemetry: a false here is a client running
       * pricing code that no longer agrees with ours, and the customer has
       * already been shown the wrong number by the time we find out.
       */
      readonly previewMatched: boolean | null;
    }
  | {
      readonly outcome: typeof CreateQuoteOutcome.DraftIncomplete;
      readonly problems: readonly DraftProblem[];
    }
  | {
      readonly outcome: typeof CreateQuoteOutcome.StaleCatalog;
      /**
       * The engine skips item ids it does not know rather than refusing — a
       * stale client must never be able to stop the server quoting. But the
       * customer's preview included those items and the server's price does
       * not, so the honest answer is "refresh and ask again", not a cheaper
       * number nobody explained.
       */
      readonly unknownItemIds: readonly string[];
    }
  | {
      readonly outcome: typeof CreateQuoteOutcome.CraneConfirmationNeeded;
      /** The price with the crane in it. The customer decides against a number. */
      readonly quote: QuoteView;
      readonly cranes: readonly CraneConfirmation[];
    }
  | {
      readonly outcome: typeof CreateQuoteOutcome.NeedsHumanReview;
      /** Real and held, but not yet bookable. */
      readonly quote: QuoteView;
    };

// --- book -------------------------------------------------------------------

export const BookJobOutcome = {
  Ok: 'ok',
  /** The draft changed after the quote was issued and no longer prices. */
  DraftIncomplete: 'draft_incomplete',
  /** The lock ran out. Re-quote; do not book at the old number. */
  QuoteExpired: 'quote_expired',
  /**
   * The server re-priced the stored draft and got a different total.
   *
   * The customer must see and accept the new number before anything is held.
   * Silently booking either price is the failure the lock exists to prevent:
   * the old one is a promise the business did not make, the new one is a
   * promise the customer did not read.
   */
  PriceChanged: 'price_changed',
  /** Still unanswered at booking. Cannot hold a price that depends on it. */
  CraneConfirmationNeeded: 'crane_confirmation_needed',
  /** The hold could not be placed. */
  PaymentFailed: 'payment_failed',
} as const;
export type BookJobOutcome = (typeof BookJobOutcome)[keyof typeof BookJobOutcome];

export type BookJobResult =
  | { readonly outcome: typeof BookJobOutcome.Ok; readonly job: JobSummary }
  | {
      readonly outcome: typeof BookJobOutcome.DraftIncomplete;
      readonly problems: readonly DraftProblem[];
    }
  | { readonly outcome: typeof BookJobOutcome.QuoteExpired; readonly expiredAt: Date }
  | {
      readonly outcome: typeof BookJobOutcome.PriceChanged;
      /** The new quote, already issued and locked. Accept it or walk away. */
      readonly quote: QuoteView;
    }
  | {
      readonly outcome: typeof BookJobOutcome.CraneConfirmationNeeded;
      readonly quote: QuoteView;
      readonly cranes: readonly CraneConfirmation[];
    }
  | {
      readonly outcome: typeof BookJobOutcome.PaymentFailed;
      readonly code: PaymentErrorCode;
      /**
       * Whether retrying the identical request could plausibly work, from
       * `isRetryable` in `@haul/payments`. Carried rather than re-derived, so
       * the app does not need the payments package to know whether to offer a
       * retry button or a different card.
       */
      readonly retryable: boolean;
      /** English. The customer-facing sentence is chosen from `code`. */
      readonly message: string;
    };

// --- cancel -----------------------------------------------------------------

export const CancelJobOutcome = {
  Ok: 'ok',
  /** Already cancelled. Idempotent replay lands here, not on an error. */
  AlreadyCancelled: 'already_cancelled',
  /** The state machine refused: wrong state, wrong actor, or a guard failed. */
  NotCancellable: 'not_cancellable',
  /** This caller may not file this reason code. */
  ReasonNotPermitted: 'reason_not_permitted',
} as const;
export type CancelJobOutcome = (typeof CancelJobOutcome)[keyof typeof CancelJobOutcome];

/**
 * There is deliberately no `payment_failed` here.
 *
 * Releasing or partially capturing the hold can fail, and when it does the job
 * is still cancelled — the money is an ops task on our side, not a decision the
 * customer can make. Offering them a retry that changes nothing about their job
 * would be inventing an action out of an internal failure.
 */
export type CancelJobResult =
  | {
      readonly outcome: typeof CancelJobOutcome.Ok;
      readonly job: JobSummary;
      /**
       * What is being captured for the cancellation, zero when it is free.
       *
       * Always present rather than optional: "free" is a number the customer
       * should read, not a field they have to notice is missing.
       */
      readonly cancellationFee: Agorot;
    }
  | { readonly outcome: typeof CancelJobOutcome.AlreadyCancelled; readonly job: JobSummary }
  | {
      readonly outcome: typeof CancelJobOutcome.NotCancellable;
      readonly state: JobState;
      readonly code: TransitionErrorCode;
      /** English, straight from the guard that refused. */
      readonly reason: string;
    }
  | {
      readonly outcome: typeof CancelJobOutcome.ReasonNotPermitted;
      /** The code that was filed. See `CUSTOMER_CANCELLATION_REASONS`. */
      readonly reasonCode: string;
    };
