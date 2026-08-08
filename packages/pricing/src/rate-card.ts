import { z } from 'zod';
import { AgorotSchema, BpsSchema, NonNegativeAgorotSchema } from '@haul/types';

/**
 * ---------------------------------------------------------------------------
 * Rate card
 * ---------------------------------------------------------------------------
 * Every number the pricing engine uses lives here, per city, and is editable
 * from the ops console without a deploy. The engine contains the *shape* of the
 * formula; the rate card contains the *values*. Those two things change on
 * completely different schedules, and mixing them is how a pricing change turns
 * into a release.
 *
 * Every card is versioned. A quote records which version produced it, so any
 * price can be explained months later — which is the difference between a
 * locked price and a claim about one.
 * ---------------------------------------------------------------------------
 */

export const WorkingMinutesConfigSchema = z.object({
  /**
   * Job-level overhead: arriving, briefing, walkthrough, proof photos, paperwork.
   * Independent of how much there is to move.
   */
  fixedOverheadMinutes: z.number().min(0).max(120).default(15),
  /** Per stop: parking, finding the entrance, the lift, the door. */
  perStopOverheadMinutes: z.number().min(0).max(120).default(8),

  /**
   * Unloading as a share of loading time. Slightly faster — no wrapping, and
   * the truck is packed in a known order — but not dramatically so.
   */
  unloadFactor: z.number().min(0).max(2).default(0.85),

  /**
   * Crew scaling exponent. Two movers is the baseline the catalog is calibrated
   * against. Adding a third does not halve the time — people get in each other's
   * way on a staircase — so the scaling is sublinear: (2/crew) ** exponent.
   */
  crewScalingExponent: z.number().min(0).max(1).default(0.8),

  /** Minutes added per flight of stairs, per cubic metre carried up or down it. */
  stairMinutesPerFlightPerM3: z.number().min(0).max(60).default(2.4),

  /**
   * A lift that takes furniture removes the stair penalty but adds its own
   * cycle time — waiting, loading, one trip per few items.
   */
  elevatorMinutesPerM3: z.number().min(0).max(60).default(1.1),

  /** Minutes per 10m of carry beyond the truck, per cubic metre. */
  carryMinutesPer10mPerM3: z.number().min(0).max(60).default(1.6),

  /** Added when parking is contested — the Tel Aviv default. */
  hardParkingMinutes: z.number().min(0).max(120).default(10),
  /** Added when there is nowhere legal to stop at all. */
  noParkingMinutes: z.number().min(0).max(180).default(25),

  /** Crane setup and teardown. Replaces stair-carrying for the items it lifts. */
  craneSetupMinutes: z.number().min(0).max(180).default(30),
  /** Per cubic metre actually hoisted. */
  craneMinutesPerM3: z.number().min(0).max(60).default(3),

  /**
   * Deliberate padding on the final estimate.
   *
   * The price is locked, which means every minute of underestimate is a minute
   * the driver works for free — and a driver who feels ambushed leaves. The
   * plan is explicit that a generous buffer is what makes the lock affordable
   * until there is enough real duration data to replace the formula.
   */
  bufferBps: BpsSchema,
});
export type WorkingMinutesConfig = z.infer<typeof WorkingMinutesConfigSchema>;

export const RateCardSchema = z.object({
  cityId: z.string().min(1).max(64),
  /** Bumped on every change. Recorded on the quote for auditability. */
  version: z.string().min(1).max(32),
  effectiveFrom: z.coerce.date(),

  currency: z.literal('ILS').default('ILS'),
  /** מע"מ. 1800 bps = 18%. Changed by the Knesset, not by us. */
  vatRate: BpsSchema,

  /** Per vehicle class. Net of VAT, like every figure on this card. */
  baseFareByVehicle: z.record(z.string(), NonNegativeAgorotSchema),

  /** Per routed kilometre. Never straight-line. */
  perKm: NonNegativeAgorotSchema,
  /** Kilometres included in the base fare before per-km starts. */
  includedKm: z.number().min(0).max(100).default(0),

  /** Per mover, per hour. Applied to estimated working minutes. */
  laborPerMoverHour: NonNegativeAgorotSchema,

  // --- access ---------------------------------------------------------------
  perStairFlight: NonNegativeAgorotSchema,
  /** Charged per 10m beyond the free allowance. */
  longCarryPer10m: NonNegativeAgorotSchema,
  freeCarryMeters: z.number().min(0).max(200).default(20),
  hardParkingFee: NonNegativeAgorotSchema,

  // --- crane (מנוף) ---------------------------------------------------------
  /**
   * Call-out. In Israel a crane is usually a separate contractor with a minimum
   * charge, so this is a real floor rather than a token surcharge.
   */
  craneBase: NonNegativeAgorotSchema,
  cranePerFloor: NonNegativeAgorotSchema,

  /** Named surcharges keyed by `heavyItemSurchargeKey` from the catalog. */
  heavyItemSurcharges: z.record(z.string(), NonNegativeAgorotSchema),

  // --- multipliers ----------------------------------------------------------
  /**
   * Keyed by `DayKind`, plus `chol_hamoed` and `evening`. The Israeli week runs
   * Sunday to Thursday, so there is no "weekend" multiplier here by design.
   */
  timeFactorBps: z.record(z.string(), BpsSchema),
  /** Hour (Jerusalem local) after which the evening factor applies. */
  eveningFromHour: z.number().int().min(0).max(23).default(18),

  /**
   * Soft cap on demand pricing. Never surfaced as a line and never called
   * "surge" — bake it into the number or inherit somebody else's PR problem.
   */
  maxDemandFactorBps: BpsSchema,

  // --- floors and shaping ---------------------------------------------------
  /** No job prices below this. Israeli movers all have a call-out minimum. */
  minimumFare: NonNegativeAgorotSchema,
  /**
   * Round the gross to this increment. ₪250 reads as a price; ₪247.83 reads as
   * machine output.
   */
  roundGrossToAgorot: z.number().int().min(1).max(10_000).default(500),

  /** Driver's guaranteed share of the fare. 8000 bps = 80%. */
  driverShareBps: BpsSchema,

  // --- protection -----------------------------------------------------------
  /** Cover included at no cost, in agorot of declared value. */
  includedCoverValue: NonNegativeAgorotSchema,
  protectionTiers: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        nameHe: z.string().max(120),
        nameEn: z.string().max(120),
        coverValue: NonNegativeAgorotSchema,
        price: NonNegativeAgorotSchema,
      }),
    )
    .default([]),

  // --- cancellation ---------------------------------------------------------
  /** Charged when a customer cancels after a driver committed. */
  cancellationFee: NonNegativeAgorotSchema,
  /** Share of that fee passed to the driver who turned down other work. */
  cancellationDriverShareBps: BpsSchema,

  // --- waiting --------------------------------------------------------------
  /** Free waiting at pickup before the meter starts. One of the four adjustments. */
  freeWaitingMinutes: z.number().int().min(0).max(120).default(15),
  waitingPerMinute: NonNegativeAgorotSchema,

  /** Charged per extra stop beyond the first dropoff. */
  perExtraStop: NonNegativeAgorotSchema,

  workingMinutes: WorkingMinutesConfigSchema,

  /**
   * Quotes above this get a human look before the price is honoured. The plan
   * calls for reviewing every large quote for the first thousand jobs — this is
   * where that threshold lives.
   */
  humanReviewThreshold: NonNegativeAgorotSchema,

  /** How long a locked price is held for an on-demand booking. */
  quoteValidityMinutes: z.number().int().min(1).max(10_080).default(30),
});
export type RateCard = z.infer<typeof RateCardSchema>;

/**
 * Sanity checks that should hold for any card an operator saves. Returns
 * problems rather than throwing, so the ops console can show all of them at
 * once instead of one per save.
 */
export function validateRateCard(card: RateCard): string[] {
  const problems: string[] = [];

  if (card.driverShareBps < 5_000 || card.driverShareBps > 9_500) {
    problems.push(
      `driver share of ${card.driverShareBps / 100}% is outside the sane 50–95% band`,
    );
  }
  // Plan §08: below 15% take doesn't cover support and payment costs; above 25%
  // and drivers organise off-platform.
  const takeBps = 10_000 - card.driverShareBps;
  if (takeBps < 1_500 || takeBps > 2_500) {
    problems.push(
      `take rate of ${takeBps / 100}% is outside the 15–25% band the model assumes`,
    );
  }
  if (card.maxDemandFactorBps > 15_000) {
    problems.push('demand factor cap above ×1.5 will read as surge pricing');
  }
  if (card.minimumFare <= 0) problems.push('minimum fare must be positive');
  if (Object.keys(card.baseFareByVehicle).length === 0) {
    problems.push('no base fares defined');
  }
  if (card.workingMinutes.bufferBps < 500) {
    problems.push(
      'buffer below 5% is thin for a locked price — underestimates come out of the driver',
    );
  }
  for (const [kind, factor] of Object.entries(card.timeFactorBps)) {
    if (factor < 5_000 || factor > 20_000) {
      problems.push(`time factor for "${kind}" (×${factor / 10_000}) looks wrong`);
    }
  }

  return problems;
}

export const AgorotFieldSchema = AgorotSchema;
