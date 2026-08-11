import { z } from 'zod';
import { AgorotSchema, BpsSchema, NonNegativeAgorotSchema } from './money.js';
import { VehicleClassIdSchema } from './vehicle.js';

/**
 * ---------------------------------------------------------------------------
 * Quote — the signature object
 * ---------------------------------------------------------------------------
 * Design it once, reuse it everywhere: booking confirmation, driver offer,
 * receipt, B2B invoice. When one component carries the product's core promise,
 * it is the most crafted thing in the codebase.
 *
 * A Quote is immutable once issued. Changing a price means issuing a new quote
 * or attaching an Adjustment — never mutating this record. That immutability is
 * what makes "the number you saw is the number you pay" auditable rather than
 * aspirational.
 * ---------------------------------------------------------------------------
 */

export const PriceLineKind = {
  Base: 'base',
  Distance: 'distance',
  Labor: 'labor',
  Access: 'access',
  Crane: 'crane',
  HeavyItem: 'heavy_item',
  TimeFactor: 'time_factor',
  DemandFactor: 'demand_factor',
  Protection: 'protection',
  Promo: 'promo',
  Adjustment: 'adjustment',
  /**
   * Absorbs the difference when the gross total is rounded to a clean figure.
   *
   * A locked price of ₪247.83 reads as machine output; ₪250 reads as a price.
   * The rounding has to live on the net side as a real line, or the breakdown
   * stops summing to the total — and a receipt that does not add up is exactly
   * the failure this product exists to prevent.
   */
  Rounding: 'rounding',
} as const;
export type PriceLineKind = (typeof PriceLineKind)[keyof typeof PriceLineKind];
export const PriceLineKindSchema = z.enum([
  PriceLineKind.Base,
  PriceLineKind.Distance,
  PriceLineKind.Labor,
  PriceLineKind.Access,
  PriceLineKind.Crane,
  PriceLineKind.HeavyItem,
  PriceLineKind.TimeFactor,
  PriceLineKind.DemandFactor,
  PriceLineKind.Protection,
  PriceLineKind.Promo,
  PriceLineKind.Adjustment,
  PriceLineKind.Rounding,
]);

export const PriceLineSchema = z.object({
  kind: PriceLineKindSchema,
  /** Stable machine key, e.g. `access.stairs`. Analytics group by this. */
  key: z.string().min(1).max(64),

  labelHe: z.string().min(1).max(160),
  labelEn: z.string().min(1).max(160),
  /** "2 קומות, ללא מעלית" — the human reason this line exists. */
  detailHe: z.string().max(200).nullable().default(null),
  detailEn: z.string().max(200).nullable().default(null),

  /** Net of VAT. Negative for promos. */
  amount: AgorotSchema,

  /**
   * False for lines folded silently into the total. The demand factor is never
   * shown as a line and never called "surge" — bake it in or inherit somebody
   * else's PR problem.
   */
  isVisible: z.boolean().default(true),
});
export type PriceLine = z.infer<typeof PriceLineSchema>;

export const PriceBreakdownSchema = z.object({
  lines: z.array(PriceLineSchema).min(1).max(60),
  /** Sum of all line amounts, excluding VAT. */
  netSubtotal: AgorotSchema,
  vatRate: BpsSchema,
  vat: AgorotSchema,
  /** netSubtotal + vat. This is the locked number the customer sees. */
  grossTotal: NonNegativeAgorotSchema,
});
export type PriceBreakdown = z.infer<typeof PriceBreakdownSchema>;

/**
 * The only four things that may change a locked price. This list is shown
 * *before* booking, beside the number — not buried in terms. Adding a fifth
 * member to this enum is a product decision, not an engineering one.
 */
export const AdjustmentReason = {
  /** You add a stop. */
  AddedStop: 'added_stop',
  /** Items arrive that weren't on your list. */
  UnlistedItems: 'unlisted_items',
  /** We wait more than the included grace period. */
  ExcessWaiting: 'excess_waiting',
  /** You reschedule inside the cutoff window. */
  LateReschedule: 'late_reschedule',
} as const;
export type AdjustmentReason = (typeof AdjustmentReason)[keyof typeof AdjustmentReason];
export const AdjustmentReasonSchema = z.enum([
  AdjustmentReason.AddedStop,
  AdjustmentReason.UnlistedItems,
  AdjustmentReason.ExcessWaiting,
  AdjustmentReason.LateReschedule,
]);

export const ADJUSTMENT_REASONS: readonly AdjustmentReason[] = [
  AdjustmentReason.AddedStop,
  AdjustmentReason.UnlistedItems,
  AdjustmentReason.ExcessWaiting,
  AdjustmentReason.LateReschedule,
];

export const AdjustmentStatus = {
  /** Driver or ops raised it. Customer has not seen it yet. */
  Proposed: 'proposed',
  /** Customer approved. A separate authorization is taken. */
  Approved: 'approved',
  /** Customer declined. The job proceeds on the original terms or ops steps in. */
  Rejected: 'rejected',
  /** Captured alongside the job total. */
  Applied: 'applied',
} as const;
export type AdjustmentStatus = (typeof AdjustmentStatus)[keyof typeof AdjustmentStatus];
export const AdjustmentStatusSchema = z.enum([
  AdjustmentStatus.Proposed,
  AdjustmentStatus.Approved,
  AdjustmentStatus.Rejected,
  AdjustmentStatus.Applied,
]);

export const AdjustmentSchema = z.object({
  id: z.string().min(1).max(64),
  jobId: z.string().min(1).max(64),
  reason: AdjustmentReasonSchema,
  status: AdjustmentStatusSchema.default(AdjustmentStatus.Proposed),

  lines: z.array(PriceLineSchema).min(1).max(20),
  /** Gross delta including VAT — what the customer is being asked to approve. */
  deltaGross: AgorotSchema,

  /** Evidence. A photo of the three extra boxes ends the argument before it starts. */
  photoUrls: z.array(z.string().max(500)).max(10).default([]),
  noteHe: z.string().max(500).nullable().default(null),

  proposedBy: z.enum(['driver', 'ops', 'system']),
  proposedAt: z.coerce.date(),
  respondedAt: z.coerce.date().nullable().default(null),

  /** The separate authorization taken for this delta. Never a top-up of the original. */
  paymentAuthorizationId: z.string().max(120).nullable().default(null),
});
export type Adjustment = z.infer<typeof AdjustmentSchema>;

export const QuoteSchema = z.object({
  id: z.string().min(1).max(64),
  cityId: z.string().min(1).max(64),

  breakdown: PriceBreakdownSchema,

  /** Convenience mirror of breakdown.grossTotal. The locked number. */
  lockedTotal: NonNegativeAgorotSchema,

  /** Guaranteed ₪ figure shown to the driver. Never expressed as a percentage. */
  driverPayout: NonNegativeAgorotSchema,

  /** How long we will hold this price. A lock is not a promise to hold forever. */
  issuedAt: z.coerce.date(),
  expiresAt: z.coerce.date(),

  // --- the inputs, retained so any price can be explained later --------------

  estimatedWorkingMinutes: z.number().int().min(0).max(2880),
  recommendedVehicleClass: VehicleClassIdSchema,
  crewSize: z.number().int().min(1).max(6),
  routedDistanceMeters: z.number().int().min(0),

  /**
   * Version of the pricing engine and of the rate card that produced this. When
   * a customer asks in three months why they were charged what they were, this
   * plus the input hash is the answer.
   */
  engineVersion: z.string().min(1).max(32),
  rateCardVersion: z.string().min(1).max(32),
  /** Stable hash of the full pricing input. Identical inputs must reproduce this. */
  inputHash: z.string().min(1).max(128),

  /** Set when the estimate exceeded the human-review threshold and ops signed off. */
  reviewedBy: z.string().max(64).nullable().default(null),
});
export type Quote = z.infer<typeof QuoteSchema>;

export function isQuoteExpired(quote: Pick<Quote, 'expiresAt'>, now: Date = new Date()): boolean {
  return now > quote.expiresAt;
}

/**
 * Seconds left on the lock, clamped at zero and rounded up.
 *
 * The Price Lock screen counts down on this, so a lapsed quote has to read 0:00
 * rather than a negative number ticking under the total — and a countdown that
 * still has 400ms on it has to read 1, not 0. Identical arithmetic to the
 * driver-side offer countdown: two timers on the same event that disagree by a
 * second are two timers that get bug reports.
 */
export function quoteSecondsRemaining(
  quote: Pick<Quote, 'expiresAt'>,
  now: Date = new Date(),
): number {
  return Math.max(0, Math.ceil((quote.expiresAt.getTime() - now.getTime()) / 1000));
}

/**
 * The breakdown must always add up. A receipt whose lines don't sum to the total
 * is the exact failure mode this product exists to prevent, so it is checked in
 * the type layer rather than trusted.
 */
export function verifyBreakdown(breakdown: PriceBreakdown): { ok: boolean; reason?: string } {
  const lineSum = breakdown.lines.reduce((acc, l) => acc + l.amount, 0);
  if (lineSum !== breakdown.netSubtotal) {
    return {
      ok: false,
      reason: `lines sum to ${lineSum} but netSubtotal is ${breakdown.netSubtotal}`,
    };
  }
  if (breakdown.netSubtotal + breakdown.vat !== breakdown.grossTotal) {
    return {
      ok: false,
      reason: `net ${breakdown.netSubtotal} + vat ${breakdown.vat} !== gross ${breakdown.grossTotal}`,
    };
  }
  return { ok: true };
}
