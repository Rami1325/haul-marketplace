import { ID_PREFIX, QuoteSchema, newId, type Quote } from '@haul/types';
import type { QuoteInput, QuoteResult } from './engine.js';
import type { RateCard } from './rate-card.js';

/**
 * ---------------------------------------------------------------------------
 * QuoteResult → Quote
 * ---------------------------------------------------------------------------
 * `computeQuote` answers "what does this job cost". A `Quote` is the record of
 * a specific promise made to a specific customer at a specific moment: it has
 * an id, a start, and an expiry. Those three things are not pricing, which is
 * why the engine does not invent them and why this conversion is a separate
 * function rather than a field on the result.
 *
 * The clock is a parameter. Everything in this package is pure so that the
 * client preview and the server authority cannot disagree, and a lock that
 * started whenever the code happened to run would put a countdown on the
 * customer's screen that the server never agreed to. The server's clock is the
 * only one that counts, so the caller passes it in.
 *
 * Not everything on a `QuoteResult` belongs on a `Quote`. `promoAmountGross`
 * goes to the ledger, the crane assessments and `needsCraneConfirmation` go to
 * the booking flow, `unknownItemIds` goes to a log. The `Quote` is the part the
 * customer is held to.
 * ---------------------------------------------------------------------------
 */

export interface QuoteIssuance {
  /**
   * When the lock starts. `expiresAt` is derived from it and the rate card's
   * validity window, so this is also the instant the countdown counts from.
   */
  issuedAt: Date;
  /**
   * Overrides the generated id. Supply one when the id was minted earlier in
   * the request — an idempotency key, or a re-price that must land on a row
   * that already exists.
   */
  id?: string;
  /**
   * Ops sign-off. Stays null on a quote over the rate card's review threshold
   * until a human has actually looked: `needsHumanReview` is a question, and
   * filling this in here would be answering it on their behalf.
   */
  reviewedBy?: string | null;
}

/**
 * Build the persisted, customer-facing quote from a priced result.
 *
 * Parsed through `QuoteSchema` on the way out rather than cast. The bounds it
 * enforces are the same ones the database column enforces, and failing here —
 * where the input that produced the number is still in hand — is worth far more
 * than failing at the insert.
 */
export function toQuote(
  input: QuoteInput,
  result: QuoteResult,
  card: RateCard,
  issuance: QuoteIssuance,
): Quote {
  const { issuedAt } = issuance;
  const expiresAt = new Date(issuedAt.getTime() + card.quoteValidityMinutes * 60_000);

  return QuoteSchema.parse({
    id: issuance.id ?? newId(ID_PREFIX.quote, issuedAt.getTime()),
    cityId: input.cityId,

    breakdown: result.breakdown,
    lockedTotal: result.lockedTotal,
    driverPayout: result.driverPayout,

    issuedAt,
    expiresAt,

    estimatedWorkingMinutes: result.estimatedWorkingMinutes,
    recommendedVehicleClass: result.recommendedVehicleClass,
    crewSize: input.crewSize,
    routedDistanceMeters: input.routedDistanceMeters,

    // Provenance travels with the price. These three plus the stored canonical
    // input are what turn "why was I charged this" into a lookup.
    engineVersion: result.engineVersion,
    rateCardVersion: result.rateCardVersion,
    inputHash: result.inputHash,

    reviewedBy: issuance.reviewedBy ?? null,
    // `satisfies` rather than a cast: when `QuoteSchema` gains a field, this
    // stops compiling instead of quietly persisting a stub.
  } satisfies Quote);
}
