import {
  AccessDetailsSchema,
  BpsSchema,
  DayKindSchema,
  ManifestSchema,
  NonNegativeAgorotSchema,
  StopKindSchema,
  VehicleClassIdSchema,
} from '@haul/types';
import { z } from 'zod';

/**
 * ---------------------------------------------------------------------------
 * The pricing input, as a schema
 * ---------------------------------------------------------------------------
 * `computeQuote` takes a `QuoteInput`, and a TypeScript interface stops existing
 * the instant a request body crosses the network. Every path into the engine
 * that starts outside this process — a server action, a queued re-price, a row
 * read back out of jsonb — needs something to parse against first, or the
 * "server is the only authority" rule is enforced by nothing at all.
 *
 * This is the same shape stated as a schema, and it must stay the *same* shape:
 * a field the type has and the schema does not is a field a client can send
 * that nothing checks. `input-schema.test.ts` asserts assignability in both
 * directions plus key-set equality, so drift fails the typecheck rather than
 * shipping.
 *
 * The bounds here are payload sanity — a body that could only come from a bug
 * or an attacker. Pricing policy is not stated here; it lives on the rate card,
 * which an operator can retune without a deploy.
 * ---------------------------------------------------------------------------
 */

/** One stop the load is handled at. Structural mirror of `QuoteStopInput`. */
export const QuoteStopInputSchema = z.object({
  kind: StopKindSchema,
  access: AccessDetailsSchema,
  /**
   * Share of the load handled here. Bounded to 0–1 because it is a share, not a
   * multiplier: a stop claiming 3× the load would inflate the crane assessment
   * and the working-minutes estimate together.
   */
  loadShare: z.number().min(0).max(1).optional(),
});

/**
 * When the job runs, plus the calendar facts derived from it.
 *
 * The engine takes the derived facts rather than computing them so it stays
 * free of a calendar dependency, which means a caller can hand over a `dayKind`
 * that does not match `at`. This schema can only check they are well-formed —
 * a server action must recompute them from `at` with `@haul/calendar` rather
 * than trust a client that sent a cheaper day.
 */
export const ScheduleInputSchema = z.object({
  at: z.coerce.date(),
  dayKind: DayKindSchema,
  isCholHaMoed: z.boolean(),
  /** Jerusalem local hour. */
  localHour: z.number().int().min(0).max(23),
  /** Calendar month, 1–12. */
  month: z.number().int().min(1).max(12),
});

/**
 * A promotion as the client presents it. The code is carried through to the
 * price line and to the ledger, so it is length-bounded rather than free text.
 *
 * A promo with neither an amount nor a percentage is rejected instead of
 * quietly discounting nothing: the customer typed a code and would be told it
 * worked while the total did not move.
 */
export const PromoInputSchema = z
  .object({
    code: z.string().min(1).max(64),
    /** VAT-inclusive amount off, as promos are advertised. */
    amountOff: NonNegativeAgorotSchema.optional(),
    percentOffBps: BpsSchema.optional(),
  })
  .refine(
    (promo) => promo.amountOff !== undefined || promo.percentOffBps !== undefined,
    'a promo needs either an amount off or a percentage',
  );

/**
 * Crane thresholds, present because `QuoteInput` carries them as an ops
 * override.
 *
 * A public endpoint must strip this field rather than parse it: a caller who
 * can raise `craneFromFloor` prices away a crane the crew will still need on
 * the day, which breaks the locked price on the doorstep — the exact failure
 * `crane.ts` exists to prevent.
 */
export const CraneRulesSchema = z.object({
  craneFromFloor: z.number().int().min(0).max(60),
  neverBelowFloor: z.number().int().min(0).max(60),
});

export const QuoteInputSchema = z.object({
  cityId: z.string().min(1).max(64),
  manifest: ManifestSchema,
  /**
   * At least two: a move has somewhere to leave from and somewhere to arrive.
   * One stop would price as a job with no destination and still return a
   * number, which is worse than a rejection.
   */
  stops: z.array(QuoteStopInputSchema).min(2).max(20).readonly(),
  /**
   * Routed metres, never straight-line. Integer to match `@haul/geo`, the
   * `Quote` schema and the database column; the ceiling is twice the length of
   * the country, so it rejects a garbage payload without ever rejecting a job.
   */
  routedDistanceMeters: z.number().int().min(0).max(1_000_000),
  vehicleClassId: VehicleClassIdSchema,
  crewSize: z.number().int().min(1).max(6),
  schedule: ScheduleInputSchema,
  /** Live supply/demand ratio. The rate card caps it; this only bounds the type. */
  demandFactorBps: BpsSchema.optional(),
  promo: PromoInputSchema.optional(),
  protectionTierId: z.string().min(1).max(64).optional(),
  craneRules: CraneRulesSchema.optional(),
});
