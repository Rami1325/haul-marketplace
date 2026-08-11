import type {
  Agorot,
  Bps,
  CraneNeed,
  DayKind,
  ElevatorKind,
  Manifest,
  ParkingSituation,
  StopKind,
  VehicleClassId,
} from '@haul/types';
import type { CraneRules } from './crane.js';
import type { PromoInput, QuoteInput } from './engine.js';
import { QuoteInputSchema } from './input-schema.js';

/**
 * ---------------------------------------------------------------------------
 * The pricing input, as it is stored
 * ---------------------------------------------------------------------------
 * A quote row keeps the exact input it was priced from (`quotes.pricing_input`,
 * jsonb). That record is what makes a price explainable months later, and what
 * lets a re-price at booking time *prove* it priced the same job rather than
 * assert it.
 *
 * jsonb is where a `Date` quietly becomes a string. Write a `QuoteInput`
 * straight into the column and read it back and `schedule.at` is a string that
 * still typechecks as a `Date` everywhere downstream, until something calls
 * `.getTime()` on it. So the conversion is made explicit and total here: every
 * `Date` becomes an ISO string on the way in, and `parseCanonicalQuoteInput`
 * turns it back on the way out. `canonical-input.test.ts` round-trips through
 * `JSON.parse(JSON.stringify(...))` and requires the replay to reproduce both
 * the input hash and the locked total exactly — the guard that a silent
 * string-for-Date substitution cannot survive.
 *
 * Keys are emitted in sorted order at every level, which makes the stored JSON
 * byte-stable: two identical inputs produce identical text, so a re-price can
 * be compared by string equality and a diff between two quotes shows what
 * actually changed rather than what got serialised in a different order.
 *
 * This form carries more than the hash does. `inputHash` covers the fields that
 * move the price — it deliberately omits `schedule.at`, because a job at 09:00
 * and one at 09:30 on the same kind of day price identically — whereas a replay
 * needs the whole input back.
 * ---------------------------------------------------------------------------
 */

/** `AccessDetails` with no `Date` fields to convert; the keys are only reordered. */
interface CanonicalAccess {
  carryDistanceMeters: number;
  crane: CraneNeed;
  elevator: ElevatorKind;
  floor: number;
  narrowStairwell: boolean;
  notes: string | null;
  parking: ParkingSituation;
  permitRequired: boolean;
  stairFlights: number;
}

/**
 * `loadedAt` and `unloadedAt` are null at quote time and set during the job,
 * but they are part of the manifest and therefore part of the hash — so they
 * are converted rather than dropped.
 */
interface CanonicalManifestLine {
  addedDuringJob: boolean;
  catalogItemId: string;
  customLabel: string | null;
  /** ISO 8601 instant, or null. */
  loadedAt: string | null;
  quantity: number;
  stopIndex: number;
  /** ISO 8601 instant, or null. */
  unloadedAt: string | null;
}

interface CanonicalManifest {
  lines: CanonicalManifestLine[];
  presetId: string | null;
  source: Manifest['source'];
}

interface CanonicalStop {
  access: CanonicalAccess;
  kind: StopKind;
  loadShare?: number;
}

interface CanonicalSchedule {
  /** ISO 8601 instant. The only `Date` on a pricing input. */
  at: string;
  dayKind: DayKind;
  isCholHaMoed: boolean;
  localHour: number;
  month: number;
}

interface CanonicalPromo {
  amountOff?: Agorot;
  code: string;
  percentOffBps?: Bps;
}

/**
 * A `QuoteInput` that survives a jsonb column unchanged: no `Date`s, no
 * `undefined`, keys sorted. Absent optional fields stay absent rather than
 * becoming `null` — a `null` is a value the hash would see, and a quote that
 * hashed differently after a round trip would be a quote that cannot be proven
 * to be the same job.
 */
export interface CanonicalQuoteInput {
  cityId: string;
  craneRules?: CraneRules;
  crewSize: number;
  demandFactorBps?: Bps;
  manifest: CanonicalManifest;
  promo?: CanonicalPromo;
  protectionTierId?: string;
  routedDistanceMeters: number;
  schedule: CanonicalSchedule;
  stops: CanonicalStop[];
  vehicleClassId: VehicleClassId;
}

/**
 * Flatten a pricing input into the form that gets persisted.
 *
 * Written key by key in sorted order rather than spread-and-sorted, because the
 * ordering is the point: a generic deep sort would keep working while silently
 * carrying a `Date` through, which is the one failure this function exists to
 * make impossible.
 */
export function canonicalQuoteInput(input: QuoteInput): CanonicalQuoteInput {
  return {
    cityId: input.cityId,
    ...(input.craneRules !== undefined
      ? {
          craneRules: {
            craneFromFloor: input.craneRules.craneFromFloor,
            neverBelowFloor: input.craneRules.neverBelowFloor,
          },
        }
      : {}),
    crewSize: input.crewSize,
    ...(input.demandFactorBps !== undefined ? { demandFactorBps: input.demandFactorBps } : {}),
    manifest: {
      lines: input.manifest.lines.map((line) => ({
        addedDuringJob: line.addedDuringJob,
        catalogItemId: line.catalogItemId,
        customLabel: line.customLabel,
        loadedAt: isoOrNull(line.loadedAt),
        quantity: line.quantity,
        stopIndex: line.stopIndex,
        unloadedAt: isoOrNull(line.unloadedAt),
      })),
      presetId: input.manifest.presetId,
      source: input.manifest.source,
    },
    ...(input.promo !== undefined ? { promo: canonicalPromo(input.promo) } : {}),
    ...(input.protectionTierId !== undefined ? { protectionTierId: input.protectionTierId } : {}),
    routedDistanceMeters: input.routedDistanceMeters,
    schedule: {
      at: input.schedule.at.toISOString(),
      dayKind: input.schedule.dayKind,
      isCholHaMoed: input.schedule.isCholHaMoed,
      localHour: input.schedule.localHour,
      month: input.schedule.month,
    },
    stops: input.stops.map((stop) => ({
      access: {
        carryDistanceMeters: stop.access.carryDistanceMeters,
        crane: stop.access.crane,
        elevator: stop.access.elevator,
        floor: stop.access.floor,
        narrowStairwell: stop.access.narrowStairwell,
        notes: stop.access.notes,
        parking: stop.access.parking,
        permitRequired: stop.access.permitRequired,
        stairFlights: stop.access.stairFlights,
      },
      kind: stop.kind,
      ...(stop.loadShare !== undefined ? { loadShare: stop.loadShare } : {}),
    })),
    vehicleClassId: input.vehicleClassId,
  };
}

/**
 * Read a stored pricing input back into the shape the engine takes.
 *
 * Deliberately the same schema a server action parses a live request body
 * against. Two grammars would mean a replay could accept an input the live
 * endpoint would have rejected — and then "we re-priced the identical job"
 * would be a claim about a job that could never have been booked.
 */
export function parseCanonicalQuoteInput(value: unknown): QuoteInput {
  return QuoteInputSchema.parse(value);
}

function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function canonicalPromo(promo: PromoInput): CanonicalPromo {
  return {
    ...(promo.amountOff !== undefined ? { amountOff: promo.amountOff } : {}),
    code: promo.code,
    ...(promo.percentOffBps !== undefined ? { percentOffBps: promo.percentOffBps } : {}),
  };
}
