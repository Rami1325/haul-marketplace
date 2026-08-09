import { z } from 'zod';
import { NonNegativeAgorotSchema, ZERO } from './money.js';
import { CraneNeedSchema, ElevatorKindSchema, ParkingSituationSchema } from './access.js';
import { VehicleClassIdSchema } from './vehicle.js';

/**
 * ---------------------------------------------------------------------------
 * Offers — no blind accepts
 * ---------------------------------------------------------------------------
 * The number one driver complaint everywhere in this category is "the job was
 * nothing like the description". We fix it by never hiding the description.
 *
 * Everything on this object is rendered on the offer card *before* the driver
 * taps accept: guaranteed payout in shekels, distance, the full manifest,
 * floors, elevator, parking, whether a crane is involved, and how many minutes
 * of actual work this is likely to be.
 *
 * If a field cannot be shown on the card, it should not be in the pricing model
 * either — the driver and the price must be looking at the same job.
 * ---------------------------------------------------------------------------
 */

export const OfferStatus = {
  Pending: 'pending',
  Accepted: 'accepted',
  Declined: 'declined',
  /** Countdown ran out. */
  Expired: 'expired',
  /** Someone else took the job first. Not the driver's fault; not counted against them. */
  Superseded: 'superseded',
} as const;
export type OfferStatus = (typeof OfferStatus)[keyof typeof OfferStatus];
export const OfferStatusSchema = z.enum([
  OfferStatus.Pending,
  OfferStatus.Accepted,
  OfferStatus.Declined,
  OfferStatus.Expired,
  OfferStatus.Superseded,
]);

/** Per-stop access summary, exactly as it appears on the card. */
export const OfferStopSummarySchema = z.object({
  kind: z.enum(['pickup', 'dropoff']),
  /** Street and city only — the full address unlocks on accept. */
  areaLabel: z.string().max(160),
  floor: z.number().int(),
  elevator: ElevatorKindSchema,
  stairFlights: z.number().int().min(0),
  parking: ParkingSituationSchema,
  carryDistanceMeters: z.number().int().min(0),
  crane: CraneNeedSchema,
});
export type OfferStopSummary = z.infer<typeof OfferStopSummarySchema>;

export const OfferSchema = z.object({
  id: z.string().min(1).max(64),
  jobId: z.string().min(1).max(64),
  driverId: z.string().min(1).max(64),

  /** Which broadcast wave produced this offer. 1 → 2 → 3, widening each time. */
  wave: z.number().int().min(1).max(3),
  status: OfferStatusSchema.default(OfferStatus.Pending),

  /**
   * Guaranteed payout in shekels. Shown as a number, never as a percentage —
   * a driver deciding in twenty-five seconds needs "₪186", not "82% of ₪227".
   */
  payout: NonNegativeAgorotSchema,
  /** Extra offered in wave 3 to clear a job nobody took. Shown separately, as a win. */
  payoutBoost: NonNegativeAgorotSchema.default(ZERO),

  distanceToPickupMeters: z.number().int().min(0),
  etaToPickupSeconds: z.number().int().min(0),
  /** Pickup to final dropoff. */
  jobDistanceMeters: z.number().int().min(0),

  vehicleClassId: VehicleClassIdSchema,
  crewSize: z.number().int().min(1).max(6),

  /** The full manifest, summarised for a twenty-five-second decision. */
  itemCount: z.number().int().min(0),
  totalVolumeM3: z.number().min(0),
  heaviestItemKg: z.number().min(0),
  /** Item names the driver most needs to see — piano, safe, double bed. */
  notableItemsHe: z.array(z.string().max(80)).max(8).default([]),

  /** The honest answer to "how long will I actually be working". */
  estimatedWorkingMinutes: z.number().int().min(0),

  stops: z.array(OfferStopSummarySchema).min(2).max(20),

  scheduledFor: z.coerce.date().nullable().default(null),

  offeredAt: z.coerce.date(),
  /** 25s for on-demand. Scheduled jobs get hour-long windows on the same machinery. */
  expiresAt: z.coerce.date(),
  respondedAt: z.coerce.date().nullable().default(null),
  declineReason: z.string().max(120).nullable().default(null),
});
export type Offer = z.infer<typeof OfferSchema>;

export function offerSecondsRemaining(
  offer: Pick<Offer, 'expiresAt'>,
  now: Date = new Date(),
): number {
  return Math.max(0, Math.ceil((offer.expiresAt.getTime() - now.getTime()) / 1000));
}

export function isOfferLive(
  offer: Pick<Offer, 'status' | 'expiresAt'>,
  now: Date = new Date(),
): boolean {
  return offer.status === OfferStatus.Pending && offer.expiresAt > now;
}

/** Total the driver actually receives for accepting. */
export function offerTotalPayout(offer: Pick<Offer, 'payout' | 'payoutBoost'>): number {
  return offer.payout + offer.payoutBoost;
}
