import {
  CraneNeed,
  ElevatorKind,
  ParkingSituation,
  StopKind,
  bps,
  percent,
  shekels,
  type AccessDetails,
  type CatalogItem,
  type Manifest,
} from '@haul/types';
import { RateCardSchema, type RateCard } from '../rate-card.js';

/**
 * Test fixtures.
 *
 * Values here are plausible-but-invented, and deliberately separate from the
 * real Tel Aviv rate card: tests must fail when the *engine* changes, not every
 * time an operator retunes a price.
 */

export const TEST_RATE_CARD: RateCard = RateCardSchema.parse({
  cityId: 'test-city',
  version: 'test-1',
  effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  currency: 'ILS',
  vatRate: percent(18),

  baseFareByVehicle: {
    pickup: shekels(180),
    small_van: shekels(220),
    van: shekels(280),
    box_truck_4t: shekels(420),
    box_truck_8t: shekels(650),
    crane_truck: shekels(700),
  },
  perKm: shekels(4.5),
  includedKm: 5,
  laborPerMoverHour: shekels(90),

  perStairFlight: shekels(35),
  longCarryPer10m: shekels(12),
  freeCarryMeters: 20,
  hardParkingFee: shekels(40),

  craneBase: shekels(450),
  cranePerFloor: shekels(40),

  heavyItemSurcharges: {
    piano_upright: shekels(600),
    safe: shekels(400),
    treadmill: shekels(150),
  },

  timeFactorBps: {
    workday: bps(10_000),
    short_day: bps(11_500),
    holiday_eve: bps(12_000),
    shabbat: bps(10_000),
    holiday: bps(10_000),
    chol_hamoed: bps(12_500),
    evening: bps(11_000),
  },
  eveningFromHour: 18,
  maxDemandFactorBps: bps(13_000),

  minimumFare: shekels(250),
  roundGrossToAgorot: 500,
  driverShareBps: bps(8_000),

  includedCoverValue: shekels(2_000),
  protectionTiers: [
    {
      id: 'standard',
      nameHe: 'כיסוי מורחב',
      nameEn: 'Extended cover',
      coverValue: shekels(20_000),
      price: shekels(49),
    },
  ],

  cancellationFee: shekels(80),
  cancellationDriverShareBps: bps(7_000),

  freeWaitingMinutes: 15,
  waitingPerMinute: shekels(2),
  perExtraStop: shekels(70),

  workingMinutes: {
    fixedOverheadMinutes: 15,
    perStopOverheadMinutes: 8,
    unloadFactor: 0.85,
    crewScalingExponent: 0.8,
    stairMinutesPerFlightPerM3: 2.4,
    elevatorMinutesPerM3: 1.1,
    carryMinutesPer10mPerM3: 1.6,
    hardParkingMinutes: 10,
    noParkingMinutes: 25,
    craneSetupMinutes: 30,
    craneMinutesPerM3: 3,
    bufferBps: bps(1_200),
  },

  humanReviewThreshold: shekels(2_500),
  quoteValidityMinutes: 30,
});

function item(overrides: Partial<CatalogItem> & Pick<CatalogItem, 'id'>): CatalogItem {
  return {
    category: 'furniture',
    nameHe: 'פריט',
    nameEn: 'item',
    aliases: [],
    volumeM3: 0.5,
    weightKg: 20,
    handlingMinutes: 4,
    requiresTwoPeople: false,
    craneCandidate: false,
    fragile: false,
    heavyItemSurchargeKey: null,
    icon: 'box',
    isCommon: false,
    ...overrides,
  };
}

export const TEST_CATALOG: ReadonlyMap<string, CatalogItem> = new Map(
  [
    item({ id: 'box_medium', nameHe: 'ארגז', nameEn: 'Box', category: 'boxes', volumeM3: 0.1, weightKg: 12, handlingMinutes: 1.5 }),
    item({ id: 'sofa_3_seat', nameHe: 'ספה תלת מושבית', nameEn: '3-seat sofa', volumeM3: 1.8, weightKg: 75, handlingMinutes: 12, requiresTwoPeople: true, craneCandidate: true }),
    item({ id: 'mattress_double', nameHe: 'מזרן זוגי', nameEn: 'Double mattress', volumeM3: 0.45, weightKg: 30, handlingMinutes: 6, requiresTwoPeople: true }),
    item({ id: 'fridge_large', nameHe: 'מקרר גדול', nameEn: 'Large fridge', category: 'appliance', volumeM3: 1.2, weightKg: 110, handlingMinutes: 15, requiresTwoPeople: true, craneCandidate: true }),
    item({ id: 'wardrobe_3_door', nameHe: 'ארון 3 דלתות', nameEn: '3-door wardrobe', volumeM3: 2.2, weightKg: 120, handlingMinutes: 25, requiresTwoPeople: true, craneCandidate: true }),
    item({ id: 'piano_upright', nameHe: 'פסנתר', nameEn: 'Upright piano', category: 'special', volumeM3: 1.1, weightKg: 250, handlingMinutes: 45, requiresTwoPeople: true, craneCandidate: true, heavyItemSurchargeKey: 'piano_upright' }),
    item({ id: 'dining_chair', nameHe: 'כיסא', nameEn: 'Dining chair', volumeM3: 0.15, weightKg: 6, handlingMinutes: 1 }),
  ].map((i) => [i.id, i]),
);

export function access(overrides: Partial<AccessDetails> = {}): AccessDetails {
  return {
    floor: 0,
    elevator: ElevatorKind.None,
    stairFlights: 0,
    carryDistanceMeters: 0,
    parking: ParkingSituation.StreetEasy,
    narrowStairwell: false,
    crane: CraneNeed.Unknown,
    permitRequired: false,
    notes: null,
    ...overrides,
  };
}

export function manifest(lines: Array<[string, number]>): Manifest {
  return {
    lines: lines.map(([catalogItemId, quantity]) => ({
      catalogItemId,
      quantity,
      customLabel: null,
      stopIndex: 0,
      addedDuringJob: false,
      loadedAt: null,
      unloadedAt: null,
    })),
    presetId: null,
    source: 'picker',
  };
}

/** A typical small move: a few boxes, a sofa, a mattress. */
export const SMALL_MOVE = manifest([
  ['box_medium', 12],
  ['sofa_3_seat', 1],
  ['mattress_double', 1],
  ['dining_chair', 4],
]);

export const STOPS_GROUND_FLOOR = [
  { kind: StopKind.Pickup, access: access() },
  { kind: StopKind.Dropoff, access: access() },
] as const;

export const WORKDAY_SCHEDULE = {
  at: new Date('2026-08-09T09:00:00Z'),
  dayKind: 'workday' as const,
  isCholHaMoed: false,
  localHour: 10,
};
