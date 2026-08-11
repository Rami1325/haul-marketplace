import { CancellationReason, CancellationReasonSchema } from '@haul/types';
import { z } from 'zod';

/**
 * ---------------------------------------------------------------------------
 * Request bodies — what a client is allowed to say
 * ---------------------------------------------------------------------------
 * THE PRICE AUTHORITY RULE: **no request body in this file may carry a price,
 * a total, an amount, a fee or a breakdown.** Not "the server ignores it" — it
 * must not be expressible. The server reads the draft it stored, re-prices it
 * with the same pure engine the client previewed with, and that number is the
 * only number. A field a client could set is a field somebody will eventually
 * trust "just for the refund path", and at that point the locked price is a
 * marketing claim rather than a product.
 *
 * `requests.test.ts` walks the shape of every schema here, nested, and fails on
 * any key that reads like money. That test is the enforcement; this paragraph
 * is only the reason.
 *
 * What a client may send instead is a hash of what it previewed. If the
 * server's re-price disagrees, that is a real defect — a stale catalog, a rate
 * card that moved mid-session, a client running old pricing code — and the
 * hash is what turns it from an argument with a customer into a number on a
 * dashboard.
 * ---------------------------------------------------------------------------
 */

/**
 * Ask the server to price the stored draft.
 *
 * There is no idempotency key here and there is one on `BookJobRequestSchema`,
 * which is the difference between the two endpoints stated in the schema: this
 * one moves no money and a repeat costs a row, while that one places a hold on
 * a card.
 */
export const CreateQuoteRequestSchema = z.object({
  /** The draft to price. Everything else the server needs is on it. */
  draftId: z.string().min(1).max(64),
  /**
   * `inputHash` of the quote the client previewed, for drift telemetry only.
   *
   * Never an input to the price and never a reason to refuse one: a client that
   * lies here gets the server's number anyway. Null from a surface that does
   * not run the preview engine at all.
   */
  previewHash: z.string().max(128).nullable().default(null),
});
export type CreateQuoteRequest = z.infer<typeof CreateQuoteRequestSchema>;

/**
 * Accept a locked price and book the job.
 *
 * Carries the quote AND the draft it was priced from, so the server can check
 * the client is talking about the pair it thinks it is. The server re-prices
 * from the stored draft regardless; sending both is what lets a disagreement be
 * reported as a disagreement instead of silently resolved in the server's
 * favour a second after the customer read a different number.
 */
export const BookJobRequestSchema = z.object({
  quoteId: z.string().min(1).max(64),
  draftId: z.string().min(1).max(64),
  /**
   * Provider-side card token. Never a PAN — raw card data never reaches us,
   * which is what keeps HAUL out of PCI scope beyond SAQ-A.
   */
  paymentMethodToken: z.string().min(1).max(255),
  /**
   * Required, not optional. This request places a hold on a card, webhooks
   * arrive more than once and networks fail mid-call; a booking endpoint that
   * double-authorises under retry is worse than one that fails closed.
   */
  idempotencyKey: z.string().min(8).max(128),
  /** As on `CreateQuoteRequestSchema`: telemetry, never an input. */
  previewHash: z.string().max(128).nullable().default(null),
});
export type BookJobRequest = z.infer<typeof BookJobRequestSchema>;

/**
 * The reasons a customer may pick for themselves.
 *
 * The full vocabulary is open to the endpoint because ops and the driver app
 * post to it too, but a customer must never be able to file their own
 * cancellation as `no_driver_found` or `payment_failed`. Those buckets are how
 * we find out that dispatch is failing; a customer-writable code in them is a
 * report that quietly stops meaning anything.
 *
 * `duplicate_booking` is in here because the customer is the only one who knows
 * they booked the same move twice, and it is the one code that says no demand
 * was actually lost.
 */
export const CUSTOMER_CANCELLATION_REASONS: readonly CancellationReason[] = [
  CancellationReason.CustomerChangedPlans,
  CancellationReason.CustomerFoundAnotherMover,
  CancellationReason.PriceTooHigh,
  CancellationReason.DateChanged,
  CancellationReason.DuplicateBooking,
];

/** Whether a customer-authenticated request may file this reason. */
export function isCustomerSelectableReason(reason: CancellationReason): boolean {
  return CUSTOMER_CANCELLATION_REASONS.includes(reason);
}

/**
 * Cancel a job.
 *
 * There is deliberately no acknowledgement-of-fee field. Whether a fee applies
 * depends on whether a driver has committed, which is server state that can
 * change between the customer reading the sheet and tapping the button — so a
 * client-side "I accept the fee" flag would be an answer to a question that may
 * no longer be the one being asked. The fee, if any, comes back on the result.
 */
export const CancelJobRequestSchema = z.object({
  jobId: z.string().min(1).max(64),
  /**
   * The closed vocabulary from `@haul/types`, not free text — this is the
   * column ops reads a percentage off. Authorisation decides which codes this
   * particular caller may file; see `CUSTOMER_CANCELLATION_REASONS`.
   */
  reasonCode: CancellationReasonSchema,
  /** The specifics behind the code. Read by a human, never grouped on. */
  reasonText: z.string().max(500).nullable().default(null),
  /** A cancellation releases or captures a hold, so the same rule applies. */
  idempotencyKey: z.string().min(8).max(128),
});
export type CancelJobRequest = z.infer<typeof CancelJobRequestSchema>;
