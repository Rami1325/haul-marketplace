import {
  ParkingSituation,
  elevatorTakesFurniture,
  type AccessDetails,
  type ManifestTotals,
} from '@haul/types';
import type { RateCard } from './rate-card.js';

/**
 * ---------------------------------------------------------------------------
 * Estimated working minutes
 * ---------------------------------------------------------------------------
 * The single most valuable model in the company, and the reason a locked price
 * is possible at all.
 *
 * A taxi ride is priced by distance because distance is the whole job. A move
 * is priced by *time on site*, and time on site is unknown at the moment of
 * booking. Everything the booking flow collects — the manifest, the floor, the
 * lift, the parking — exists to make this function's answer good enough that
 * the price can be held.
 *
 * It is deliberately a transparent formula rather than a fitted model. Two
 * reasons: there is no data yet, and a formula can be *explained* to a driver
 * who thinks a job was underquoted. Replace it with a regression once a couple
 * of thousand jobs have logged their actual durations — the plan is explicit
 * that this is where the moat comes from — but keep the breakdown, because the
 * explanation is worth as much as the number.
 *
 * Every input and every output here is logged on the quote from job #1. That
 * dataset is the thing nobody else can copy by looking at the app.
 * ---------------------------------------------------------------------------
 */

export interface StopWorkInput {
  access: AccessDetails;
  /** Cubic metres actually handled at this stop. */
  volumeM3: number;
  /** Of that volume, how much goes over the balcony by crane rather than the stairs. */
  craneVolumeM3?: number;
}

export interface WorkingMinutesInput {
  totals: Pick<ManifestTotals, 'baseHandlingMinutes' | 'totalVolumeM3' | 'itemCount'>;
  stops: readonly StopWorkInput[];
  /** Total people working, driver included. The catalog is calibrated to two. */
  crewSize: number;
}

export interface WorkingMinutesBreakdown {
  /** Arrival, walkthrough, proof photos, paperwork. */
  fixedOverhead: number;
  /** Parking, finding the entrance, the lift, the door — per stop. */
  stopOverhead: number;
  /** Carrying the items themselves, load and unload, after batching. */
  handling: number;
  /** Batching efficiency applied to handling. 1.0 = no benefit. */
  bulkFactor: number;
  stairs: number;
  elevator: number;
  longCarry: number;
  difficultParking: number;
  crane: number;
  /** Physical work before crew scaling. */
  physicalWork: number;
  /** Multiplier applied to physical work for crew size. */
  crewFactor: number;
  /** Everything, before the deliberate buffer. */
  beforeBuffer: number;
  bufferMinutes: number;
  /** What goes on the quote. Integer minutes. */
  total: number;
}

/**
 * Crew scaling is sublinear on purpose.
 *
 * Three movers do not finish a two-mover job in two-thirds of the time — on an
 * Israeli staircase they queue behind each other. `(2 / crew) ** 0.8` gives
 * roughly 0.74 for three and 0.57 for four, which matches how moving crews
 * actually behave. A linear model would systematically underquote large crews,
 * and under a locked price that underquote comes out of the driver.
 */
export function crewFactorFor(crewSize: number, exponent: number): number {
  const safeCrew = Math.max(1, crewSize);
  return Math.pow(2 / safeCrew, exponent);
}

/**
 * Batching efficiency. One item alone gets no benefit; a whole flat gets a lot.
 *
 * The catalog times each item as though handled in isolation. A crew moving 55
 * boxes does not spend 55 × the single-box time — they carry several at once
 * and chain-pass. Modelled as exponential decay toward a floor rather than a
 * step, because the effect is gradual and a cliff would make two nearly
 * identical manifests price very differently.
 */
export function bulkFactorFor(itemCount: number, floor: number, scale: number): number {
  if (itemCount <= 1) return 1;
  return floor + (1 - floor) * Math.exp(-(itemCount - 1) / scale);
}

export function estimateWorkingMinutes(
  input: WorkingMinutesInput,
  card: RateCard,
): WorkingMinutesBreakdown {
  const config = card.workingMinutes;

  const bulkFactor = bulkFactorFor(
    input.totals.itemCount,
    config.bulkEfficiencyFloor,
    config.bulkEfficiencyScale,
  );

  // Carrying everything out, then carrying it all back in again.
  const handling = input.totals.baseHandlingMinutes * (1 + config.unloadFactor) * bulkFactor;

  let stairs = 0;
  let elevator = 0;
  let longCarry = 0;
  let difficultParking = 0;
  let crane = 0;
  let craneUsedAnywhere = false;

  for (const stop of input.stops) {
    const craneVolume = Math.min(stop.craneVolumeM3 ?? 0, stop.volumeM3);
    const carriedVolume = Math.max(0, stop.volumeM3 - craneVolume);

    if (craneVolume > 0) {
      craneUsedAnywhere = true;
      crane += craneVolume * config.craneMinutesPerM3;
    }

    if (elevatorTakesFurniture(stop.access.elevator)) {
      // A lift removes the stairs but is not free: it has a cycle time, and on
      // a busy building you wait for it.
      elevator += stop.volumeM3 * config.elevatorMinutesPerM3;
    } else {
      // Only the volume that does NOT go by crane has to walk.
      stairs += stop.access.stairFlights * carriedVolume * config.stairMinutesPerFlightPerM3;
    }

    const billableCarry = Math.max(0, stop.access.carryDistanceMeters - card.freeCarryMeters);
    longCarry += (billableCarry / 10) * stop.volumeM3 * config.carryMinutesPer10mPerM3;

    if (stop.access.parking === ParkingSituation.StreetHard) {
      difficultParking += config.hardParkingMinutes;
    } else if (stop.access.parking === ParkingSituation.None) {
      difficultParking += config.noParkingMinutes;
    }
  }

  if (craneUsedAnywhere) {
    crane += config.craneSetupMinutes;
  }

  const fixedOverhead = config.fixedOverheadMinutes;
  const stopOverhead = input.stops.length * config.perStopOverheadMinutes;

  // Crew size speeds up the physical work. It does not speed up the paperwork,
  // the parking, or the crane setup — those are wall-clock regardless.
  const physicalWork = handling + stairs + elevator + longCarry;
  const crewFactor = crewFactorFor(input.crewSize, config.crewScalingExponent);
  const scaledPhysicalWork = physicalWork * crewFactor;

  const beforeBuffer =
    fixedOverhead + stopOverhead + difficultParking + crane + scaledPhysicalWork;

  const bufferMinutes = (beforeBuffer * config.bufferBps) / 10_000;

  return {
    fixedOverhead,
    stopOverhead,
    handling: round1(handling),
    bulkFactor: Math.round(bulkFactor * 1000) / 1000,
    stairs: round1(stairs),
    elevator: round1(elevator),
    longCarry: round1(longCarry),
    difficultParking,
    crane: round1(crane),
    physicalWork: round1(physicalWork),
    crewFactor: Math.round(crewFactor * 1000) / 1000,
    beforeBuffer: round1(beforeBuffer),
    bufferMinutes: round1(bufferMinutes),
    total: Math.ceil(beforeBuffer + bufferMinutes),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Smallest crew that can do the job in a sane working day, respecting items
 * that physically need two people.
 *
 * Biased toward adding a mover rather than stretching the day: a crew that runs
 * past dark on a Friday is a crew that cannot finish before Shabbat, and under
 * a locked price the overrun is the driver's problem, not the customer's.
 */
export function recommendCrewSize(
  input: Omit<WorkingMinutesInput, 'crewSize'>,
  card: RateCard,
  options: { requiresTwoPeople?: boolean; targetMinutes?: number; maxCrew?: number } = {},
): number {
  const { requiresTwoPeople = false, targetMinutes = 240, maxCrew = 4 } = options;
  const floor = requiresTwoPeople ? 2 : 1;

  for (let crew = floor; crew < maxCrew; crew++) {
    const estimate = estimateWorkingMinutes({ ...input, crewSize: crew }, card);
    if (estimate.total <= targetMinutes) return crew;
  }
  return maxCrew;
}
