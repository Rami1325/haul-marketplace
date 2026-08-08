import {
  DayKind,
  ParkingSituation,
  PriceLineKind,
  StopKind,
  addVat,
  agorot,
  applyBps,
  bps,
  elevatorTakesFurniture,
  extractVat,
  summariseManifest,
  type AccessDetails,
  type Agorot,
  type Bps,
  type CatalogItem,
  type Manifest,
  type PriceBreakdown,
  type PriceLine,
  type VehicleClassId,
} from '@haul/types';
import { assessCraneNeed, craneIsPriced, DEFAULT_CRANE_RULES, type CraneAssessment, type CraneRules } from './crane.js';
import { stableHash } from './hash.js';
import type { RateCard } from './rate-card.js';
import { estimateWorkingMinutes, type StopWorkInput, type WorkingMinutesBreakdown } from './working-minutes.js';

/**
 * ---------------------------------------------------------------------------
 * The pricing engine
 * ---------------------------------------------------------------------------
 * Pure. No clock, no network, no database. The client runs it for an instant
 * preview and the server runs the identical code as the only authority, so the
 * two cannot drift — which matters because a preview that disagrees with the
 * booked price is bill shock with extra steps.
 *
 * Order of operations, and why:
 *
 *   1. Variable work    base + distance + labour + access
 *   2. × time factor    evening, Friday, chol hamoed — labour costs more then
 *   3. × demand factor  soft-capped, never shown, never called "surge"
 *   4. + fixed items    crane call-out, heavy-item surcharges, extra stops
 *   5. + protection     optional cover tier
 *   6. − promo          a marketing cost, never taken out of the driver's share
 *   7. floor            no job prices below the call-out minimum
 *   8. + VAT            Israeli consumer prices are quoted inclusive
 *   9. round            to a clean figure, absorbed by an explicit line
 *
 * Multipliers deliberately do NOT touch step 4. A crane is a third party's
 * call-out fee and a piano surcharge is a fixed cost; scaling them by evening
 * demand would inflate the number without any underlying cost to justify it.
 * ---------------------------------------------------------------------------
 */

export const ENGINE_VERSION = '1.0.0';

export interface QuoteStopInput {
  kind: StopKind;
  access: AccessDetails;
  /**
   * Share of the load handled here, 0–1. Defaults to the whole load at the
   * pickup and an even split across dropoffs.
   */
  loadShare?: number;
}

export interface ScheduleInput {
  /** When the job is expected to start. */
  at: Date;
  /** From `@haul/calendar`. Passed in so the engine stays dependency-free. */
  dayKind: DayKind;
  isCholHaMoed: boolean;
  /** Jerusalem local hour, for the evening factor. */
  localHour: number;
  /** Calendar month 1–12, for the seasonal factor. */
  month: number;
}

export interface PromoInput {
  code: string;
  /** VAT-inclusive amount off. */
  amountOff?: Agorot;
  percentOffBps?: Bps;
}

export interface QuoteInput {
  cityId: string;
  manifest: Manifest;
  stops: readonly QuoteStopInput[];
  routedDistanceMeters: number;
  vehicleClassId: VehicleClassId;
  crewSize: number;
  schedule: ScheduleInput;
  /** Live supply/demand ratio, capped by the rate card. Never surfaced. */
  demandFactorBps?: Bps;
  promo?: PromoInput;
  protectionTierId?: string;
  craneRules?: CraneRules;
}

export interface QuoteResult {
  breakdown: PriceBreakdown;
  lockedTotal: Agorot;
  /**
   * Guaranteed to the driver, computed on the fare *before* any discount.
   * Feeds `captureJobPostings` alongside `promoAmountGross`.
   */
  driverPayout: Agorot;
  /** VAT-inclusive discount given. Booked as marketing expense, not taken from the driver. */
  promoAmountGross: Agorot;
  workingMinutes: WorkingMinutesBreakdown;
  craneAssessments: readonly { stopIndex: number; assessment: CraneAssessment }[];
  /** True when a crane materially changes the price and we had to guess. */
  needsCraneConfirmation: boolean;
  /** Above the rate card's threshold — a human should look before it is honoured. */
  needsHumanReview: boolean;
  recommendedVehicleClass: VehicleClassId;
  estimatedWorkingMinutes: number;
  engineVersion: string;
  rateCardVersion: string;
  inputHash: string;
  /** Item ids the client sent that the catalog does not know about. */
  unknownItemIds: readonly string[];
}

interface LineDraft {
  kind: PriceLineKind;
  key: string;
  labelHe: string;
  labelEn: string;
  detailHe?: string | null;
  detailEn?: string | null;
  amount: number;
  isVisible?: boolean;
  /** Whether time and demand multipliers apply to this line. */
  scalable: boolean;
}

export function computeQuote(
  input: QuoteInput,
  card: RateCard,
  catalog: ReadonlyMap<string, CatalogItem>,
): QuoteResult {
  const totals = summariseManifest(input.manifest, catalog);
  const craneRules = input.craneRules ?? DEFAULT_CRANE_RULES;

  // --- crane, per stop ------------------------------------------------------
  const craneAssessments = input.stops.map((stop, stopIndex) => ({
    stopIndex,
    assessment: assessCraneNeed(stop.access, totals, craneRules),
  }));
  const pricedCranes = craneAssessments.filter((c) => craneIsPriced(c.assessment));
  const needsCraneConfirmation = craneAssessments.some(
    (c) => craneIsPriced(c.assessment) && c.assessment.needsCustomerConfirmation,
  );

  // --- effort ---------------------------------------------------------------
  const shares = loadShares(input.stops);
  const workStops: StopWorkInput[] = input.stops.map((stop, index) => {
    const craneHere = pricedCranes.find((c) => c.stopIndex === index);
    return {
      access: stop.access,
      volumeM3: totals.totalVolumeM3 * (shares[index] ?? 0),
      craneVolumeM3: craneHere ? craneHere.assessment.volumeM3 : 0,
    };
  });

  const workingMinutes = estimateWorkingMinutes(
    { totals, stops: workStops, crewSize: input.crewSize },
    card,
  );

  // --- lines ----------------------------------------------------------------
  const drafts: LineDraft[] = [];

  const baseFare = card.baseFareByVehicle[input.vehicleClassId] ?? 0;
  drafts.push({
    kind: PriceLineKind.Base,
    key: 'base',
    labelHe: 'נסיעה בסיסית',
    labelEn: 'Base fare',
    detailHe: vehicleLabelHe(input.vehicleClassId, input.crewSize),
    detailEn: `${input.vehicleClassId.replace(/_/g, ' ')} · ${input.crewSize} movers`,
    amount: baseFare,
    scalable: true,
  });

  const km = input.routedDistanceMeters / 1000;
  const billableKm = Math.max(0, km - card.includedKm);
  if (billableKm > 0) {
    drafts.push({
      kind: PriceLineKind.Distance,
      key: 'distance',
      labelHe: 'מרחק',
      labelEn: 'Distance',
      detailHe: `${km.toFixed(1)} ק״מ`,
      detailEn: `${km.toFixed(1)} km`,
      amount: Math.round(billableKm * card.perKm),
      scalable: true,
    });
  }

  const laborAmount = Math.round(
    (workingMinutes.total / 60) * input.crewSize * card.laborPerMoverHour,
  );
  drafts.push({
    kind: PriceLineKind.Labor,
    key: 'labor',
    labelHe: 'זמן עבודה',
    labelEn: 'Working time',
    detailHe: `${formatDurationHe(workingMinutes.total)} משוער · ${input.crewSize} מובילים`,
    detailEn: `${formatDurationEn(workingMinutes.total)} est. · ${input.crewSize} movers`,
    amount: laborAmount,
    scalable: true,
  });

  // --- access ---------------------------------------------------------------
  let stairFlights = 0;
  let longCarryUnits = 0;
  let hardParkingStops = 0;

  input.stops.forEach((stop, index) => {
    const hasCrane = pricedCranes.some((c) => c.stopIndex === index);
    // A crane removes the stair carry it was booked to avoid. Charging both is
    // the kind of double-billing that ends up in a one-star review.
    if (!elevatorTakesFurniture(stop.access.elevator) && !hasCrane) {
      stairFlights += stop.access.stairFlights;
    }
    const billableCarry = Math.max(0, stop.access.carryDistanceMeters - card.freeCarryMeters);
    longCarryUnits += billableCarry / 10;
    if (
      stop.access.parking === ParkingSituation.StreetHard ||
      stop.access.parking === ParkingSituation.None
    ) {
      hardParkingStops += 1;
    }
  });

  if (stairFlights > 0) {
    drafts.push({
      kind: PriceLineKind.Access,
      key: 'access.stairs',
      labelHe: 'מדרגות',
      labelEn: 'Stairs',
      detailHe: `${stairFlights} קומות ללא מעלית`,
      detailEn: `${stairFlights} flights, no suitable lift`,
      amount: stairFlights * card.perStairFlight,
      scalable: true,
    });
  }

  if (longCarryUnits > 0) {
    drafts.push({
      kind: PriceLineKind.Access,
      key: 'access.carry',
      labelHe: 'מרחק סחיבה',
      labelEn: 'Long carry',
      detailHe: `מעבר ל-${card.freeCarryMeters} מ׳ מהמשאית`,
      detailEn: `Beyond ${card.freeCarryMeters}m from the truck`,
      amount: Math.round(longCarryUnits * card.longCarryPer10m),
      scalable: true,
    });
  }

  if (hardParkingStops > 0 && card.hardParkingFee > 0) {
    drafts.push({
      kind: PriceLineKind.Access,
      key: 'access.parking',
      labelHe: 'חניה מורכבת',
      labelEn: 'Difficult parking',
      detailHe: hardParkingStops > 1 ? `${hardParkingStops} כתובות` : null,
      detailEn: hardParkingStops > 1 ? `${hardParkingStops} addresses` : null,
      amount: hardParkingStops * card.hardParkingFee,
      scalable: true,
    });
  }

  // --- fixed: crane, heavy items, extra stops -------------------------------
  for (const { stopIndex, assessment } of pricedCranes) {
    const stop = input.stops[stopIndex];
    const crane = priceCrane(
      Math.max(0, stop?.access.floor ?? 0),
      assessment.volumeM3,
      card,
    );
    drafts.push({
      kind: PriceLineKind.Crane,
      key: `crane.${stopIndex}`,
      labelHe: 'מנוף',
      labelEn: 'Furniture crane',
      detailHe: `${assessment.reasonHe} · ${formatHours(crane.hours)}`,
      detailEn: `${assessment.reasonEn} · ${formatHours(crane.hours)}`,
      amount: crane.amount,
      scalable: false,
    });
  }

  const heavyCounts = new Map<string, number>();
  for (const key of totals.heavyItemKeys) {
    heavyCounts.set(key, (heavyCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of [...heavyCounts].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const unit = card.heavyItemSurcharges[key];
    if (!unit) continue;
    drafts.push({
      kind: PriceLineKind.HeavyItem,
      key: `heavy.${key}`,
      labelHe: heavyItemLabelHe(key),
      labelEn: key.replace(/_/g, ' '),
      detailHe: count > 1 ? `${count} פריטים` : null,
      detailEn: count > 1 ? `${count} items` : null,
      amount: unit * count,
      scalable: false,
    });
  }

  const dropoffCount = input.stops.filter((s) => s.kind === StopKind.Dropoff).length;
  const extraStops = Math.max(0, dropoffCount - 1);
  if (extraStops > 0 && card.perExtraStop > 0) {
    drafts.push({
      kind: PriceLineKind.Access,
      key: 'extra_stops',
      labelHe: 'עצירות נוספות',
      labelEn: 'Extra stops',
      detailHe: `${extraStops} עצירות`,
      detailEn: `${extraStops} stops`,
      amount: extraStops * card.perExtraStop,
      scalable: false,
    });
  }

  // --- multipliers ----------------------------------------------------------
  const timeFactor = resolveTimeFactor(input.schedule, card);
  const seasonalFactor = resolveSeasonalFactor(input.schedule, card);
  const demandFactor = clampDemandFactor(input.demandFactorBps, card.maxDemandFactorBps);
  const combinedFactor = bps(
    Math.round((timeFactor * seasonalFactor * demandFactor) / 100_000_000),
  );

  const scalableTotal = drafts
    .filter((d) => d.scalable)
    .reduce((acc, d) => acc + d.amount, 0);
  const uplift = applyBps(agorot(scalableTotal), combinedFactor) - scalableTotal;

  const lines: PriceLine[] = drafts.map((d) => toLine(d));

  if (uplift !== 0) {
    // One line, not two. The customer sees "evening / high demand" as a single
    // honest surcharge; splitting it out invites the word "surge".
    lines.push(
      toLine({
        kind: timeFactor !== 10_000 ? PriceLineKind.TimeFactor : PriceLineKind.DemandFactor,
        key: 'factor',
        labelHe: timeFactorLabelHe(input.schedule),
        labelEn: timeFactorLabelEn(input.schedule),
        amount: uplift,
        scalable: false,
      }),
    );
  }

  // --- protection -----------------------------------------------------------
  if (input.protectionTierId) {
    const tier = card.protectionTiers.find((t) => t.id === input.protectionTierId);
    if (tier) {
      lines.push(
        toLine({
          kind: PriceLineKind.Protection,
          key: `protection.${tier.id}`,
          labelHe: tier.nameHe,
          labelEn: tier.nameEn,
          amount: tier.price,
          scalable: false,
        }),
      );
    }
  }

  // --- promo ----------------------------------------------------------------
  const beforePromo = lines.reduce((acc, l) => acc + l.amount, 0);
  const promoNet = resolvePromo(input.promo, agorot(beforePromo), card.vatRate);
  if (promoNet > 0) {
    lines.push(
      toLine({
        kind: PriceLineKind.Promo,
        key: `promo.${input.promo?.code ?? 'discount'}`,
        labelHe: 'הנחה',
        labelEn: 'Discount',
        detailHe: input.promo?.code ?? null,
        detailEn: input.promo?.code ?? null,
        amount: -promoNet,
        scalable: false,
      }),
    );
  }

  // --- floor, VAT, rounding -------------------------------------------------
  let netSubtotal = lines.reduce((acc, l) => acc + l.amount, 0);

  const minimumNet = extractVat(card.minimumFare, card.vatRate).net;
  if (netSubtotal < minimumNet) {
    lines.push(
      toLine({
        kind: PriceLineKind.Base,
        key: 'minimum_fare',
        labelHe: 'השלמה למינימום',
        labelEn: 'Minimum fare adjustment',
        amount: minimumNet - netSubtotal,
        scalable: false,
      }),
    );
    netSubtotal = minimumNet;
  }

  const rawGross = addVat(agorot(netSubtotal), card.vatRate).gross;
  const roundedGross = roundToIncrement(rawGross, card.roundGrossToAgorot);

  // Rounding lands on the net side as a real line, so the breakdown still sums
  // to the total. A receipt whose lines do not add up is precisely the failure
  // this product exists to prevent.
  const finalSplit = extractVat(roundedGross, card.vatRate);
  const roundingDelta = finalSplit.net - netSubtotal;
  if (roundingDelta !== 0) {
    lines.push(
      toLine({
        kind: PriceLineKind.Rounding,
        key: 'rounding',
        labelHe: 'עיגול',
        labelEn: 'Rounding',
        amount: roundingDelta,
        scalable: false,
        isVisible: false,
      }),
    );
  }

  const breakdown: PriceBreakdown = {
    lines,
    netSubtotal: finalSplit.net,
    vatRate: card.vatRate,
    vat: finalSplit.vat,
    grossTotal: finalSplit.gross,
  };

  // The driver is paid on the *undiscounted* fare.
  //
  // A promo is a marketing cost and it comes out of HAUL's take, never out of
  // the driver's share — a driver should not be funding an acquisition
  // campaign they had no say in, and a job that pays less because the customer
  // had a code is exactly the kind of thing that loses supply. The ledger books
  // the difference as PromoExpense, which is why `promoAmountGross` is returned
  // rather than left implicit.
  const promoAmountGross = promoNet > 0 ? addVat(agorot(promoNet), card.vatRate).gross : 0;
  const payoutBase = agorot(finalSplit.gross + promoAmountGross);
  const driverPayout = applyBps(payoutBase, card.driverShareBps);

  return {
    breakdown,
    lockedTotal: finalSplit.gross,
    driverPayout,
    promoAmountGross: agorot(promoAmountGross),
    workingMinutes,
    craneAssessments,
    needsCraneConfirmation,
    needsHumanReview: finalSplit.gross >= card.humanReviewThreshold,
    recommendedVehicleClass: input.vehicleClassId,
    estimatedWorkingMinutes: workingMinutes.total,
    engineVersion: ENGINE_VERSION,
    rateCardVersion: card.version,
    inputHash: stableHash({
      cityId: input.cityId,
      manifest: input.manifest,
      stops: input.stops,
      routedDistanceMeters: input.routedDistanceMeters,
      vehicleClassId: input.vehicleClassId,
      crewSize: input.crewSize,
      dayKind: input.schedule.dayKind,
      isCholHaMoed: input.schedule.isCholHaMoed,
      localHour: input.schedule.localHour,
      month: input.schedule.month,
      demandFactorBps: input.demandFactorBps ?? 10_000,
      promo: input.promo ?? null,
      protectionTierId: input.protectionTierId ?? null,
      engineVersion: ENGINE_VERSION,
      rateCardVersion: card.version,
    }),
    unknownItemIds: totals.unknownItemIds,
  };
}

// --- helpers ----------------------------------------------------------------

function toLine(draft: LineDraft): PriceLine {
  return {
    kind: draft.kind,
    key: draft.key,
    labelHe: draft.labelHe,
    labelEn: draft.labelEn,
    detailHe: draft.detailHe ?? null,
    detailEn: draft.detailEn ?? null,
    amount: agorot(Math.round(draft.amount)),
    isVisible: draft.isVisible ?? true,
  };
}

/** Whole load at the pickup, split evenly across dropoffs unless told otherwise. */
function loadShares(stops: readonly QuoteStopInput[]): number[] {
  const dropoffCount = stops.filter((s) => s.kind === StopKind.Dropoff).length || 1;
  return stops.map((stop) => {
    if (stop.loadShare !== undefined) return stop.loadShare;
    return stop.kind === StopKind.Pickup ? 1 : 1 / dropoffCount;
  });
}

export function resolveTimeFactor(schedule: ScheduleInput, card: RateCard): number {
  // Chol HaMoed first: the country is off work for a week and a lot of people
  // move house, so it outranks whatever weekday it happens to land on.
  if (schedule.isCholHaMoed && card.timeFactorBps['chol_hamoed'] !== undefined) {
    return card.timeFactorBps['chol_hamoed'];
  }
  if (schedule.localHour >= card.eveningFromHour && card.timeFactorBps['evening'] !== undefined) {
    return card.timeFactorBps['evening'];
  }
  return card.timeFactorBps[schedule.dayKind] ?? 10_000;
}

export function resolveSeasonalFactor(schedule: ScheduleInput, card: RateCard): number {
  return card.seasonalFactorBps[String(schedule.month)] ?? 10_000;
}

/**
 * Crane cost for one stop: floor band → call-out covering the first hour, then
 * prorated hours beyond it. Matches how Israeli crane operators actually bill.
 */
export function priceCrane(
  floor: number,
  volumeM3: number,
  card: RateCard,
): { amount: number; hours: number; bandMaxFloor: number } {
  const bands = [...card.craneBands].sort((a, b) => a.maxFloor - b.maxFloor);
  const band = bands.find((b) => floor <= b.maxFloor) ?? bands[bands.length - 1]!;

  const rawHours = volumeM3 / card.craneVolumePerHourM3;
  const hours = Math.max(band.minimumHours, rawHours);
  // The call-out covers the first hour; everything after it is prorated rather
  // than rounded up, which is what operators quote.
  const amount = band.callOut + Math.max(0, hours - 1) * band.perHour;

  return { amount: Math.round(amount), hours: Math.round(hours * 10) / 10, bandMaxFloor: band.maxFloor };
}

function formatHours(hours: number): string {
  return hours === 1 ? 'שעה' : `${hours} שע׳`;
}

function clampDemandFactor(requested: Bps | undefined, cap: Bps): number {
  if (requested === undefined) return 10_000;
  return Math.max(10_000, Math.min(requested, cap));
}

function resolvePromo(promo: PromoInput | undefined, subtotalNet: Agorot, vatRate: Bps): number {
  if (!promo) return 0;
  if (promo.amountOff !== undefined) {
    // Promos are advertised gross ("₪50 off"), so convert to the net side.
    return Math.min(extractVat(promo.amountOff, vatRate).net, subtotalNet);
  }
  if (promo.percentOffBps !== undefined) {
    return Math.min(applyBps(subtotalNet, promo.percentOffBps), subtotalNet);
  }
  return 0;
}

function roundToIncrement(amount: Agorot, increment: number): Agorot {
  if (increment <= 1) return amount;
  return agorot(Math.round(amount / increment) * increment);
}

function formatDurationHe(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} דק׳`;
  if (m === 0) return `${h} שע׳`;
  return `${h} שע׳ ${m} דק׳`;
}

function formatDurationEn(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function vehicleLabelHe(vehicleClassId: VehicleClassId, crewSize: number): string {
  const names: Record<string, string> = {
    pickup: 'טנדר',
    small_van: 'מסחרית קטנה',
    van: 'מסחרית',
    box_truck_4t: 'משאית 4 טון',
    box_truck_8t: 'משאית 8 טון',
    crane_truck: 'משאית עם מנוף',
  };
  return `${names[vehicleClassId] ?? vehicleClassId} · ${crewSize} מובילים`;
}

function heavyItemLabelHe(key: string): string {
  const names: Record<string, string> = {
    piano_upright: 'פסנתר',
    piano_grand: 'פסנתר כנף',
    safe: 'כספת',
    treadmill: 'הליכון',
    gym_machine: 'מכונת כושר',
    aquarium: 'אקווריום',
    pool_table: 'שולחן ביליארד',
  };
  return names[key] ?? 'פריט כבד';
}

function timeFactorLabelHe(schedule: ScheduleInput): string {
  if (schedule.isCholHaMoed) return 'תוספת חול המועד';
  if (schedule.dayKind === DayKind.ShortDay) return 'תוספת יום שישי';
  if (schedule.dayKind === DayKind.HolidayEve) return 'תוספת ערב חג';
  return 'תוספת שעות ביקוש';
}

function timeFactorLabelEn(schedule: ScheduleInput): string {
  if (schedule.isCholHaMoed) return 'Chol HaMoed surcharge';
  if (schedule.dayKind === DayKind.ShortDay) return 'Friday surcharge';
  if (schedule.dayKind === DayKind.HolidayEve) return 'Festival eve surcharge';
  return 'Peak hours';
}
