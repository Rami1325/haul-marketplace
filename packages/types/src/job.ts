import { z } from 'zod';
import { AccessDetailsSchema } from './access.js';
import { AddressSchema, LatLngSchema } from './geo.js';
import { ManifestSchema } from './catalog.js';
import { JobStateSchema } from './job-state.js';
import { AdjustmentSchema, QuoteSchema } from './quote.js';
import { IsraeliMobileSchema } from './locale.js';
import { VehicleClassIdSchema } from './vehicle.js';

/**
 * ---------------------------------------------------------------------------
 * Job — the aggregate everything else hangs off
 * ---------------------------------------------------------------------------
 */

export const StopKind = { Pickup: 'pickup', Dropoff: 'dropoff' } as const;
export type StopKind = (typeof StopKind)[keyof typeof StopKind];
export const StopKindSchema = z.enum([StopKind.Pickup, StopKind.Dropoff]);

/**
 * Multi-stop is a first-class citizen from day one. It is a structural
 * decision, and retrofitting it later means touching pricing, dispatch, the driver
 * job sheet and the manifest all at once.
 */
export const StopSchema = z.object({
  index: z.number().int().min(0).max(20),
  kind: StopKindSchema,
  address: AddressSchema,
  access: AccessDetailsSchema,

  /** Often not the booker — a partner, a parent, a shop assistant. */
  contactName: z.string().max(120).nullable().default(null),
  contactPhone: IsraeliMobileSchema.nullable().default(null),

  arrivedAt: z.coerce.date().nullable().default(null),
  departedAt: z.coerce.date().nullable().default(null),
});
export type Stop = z.infer<typeof StopSchema>;

export const ScheduleKind = { Now: 'now', Scheduled: 'scheduled' } as const;
export type ScheduleKind = (typeof ScheduleKind)[keyof typeof ScheduleKind];
export const ScheduleKindSchema = z.enum([ScheduleKind.Now, ScheduleKind.Scheduled]);

/**
 * Roughly seven in ten moves are planned rather than spontaneous, yet every
 * rival buries scheduling behind an on-demand default. Now and Later carry
 * equal weight here, in the schema as well as on the screen.
 */
export const ScheduleSchema = z.object({
  kind: ScheduleKindSchema,
  /** Start of the promised arrival window. For `now`, roughly the booking time. */
  windowStart: z.coerce.date(),
  windowEnd: z.coerce.date(),
  timezone: z.string().max(64).default('Asia/Jerusalem'),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

export const ProofPhotoKind = { Load: 'load', Unload: 'unload', Issue: 'issue' } as const;
export type ProofPhotoKind = (typeof ProofPhotoKind)[keyof typeof ProofPhotoKind];
export const ProofPhotoKindSchema = z.enum([
  ProofPhotoKind.Load,
  ProofPhotoKind.Unload,
  ProofPhotoKind.Issue,
]);

/**
 * Proof of condition. Timestamped and geotagged at capture, never at upload —
 * the gap between the two is exactly where a disputed photo lives. Damage
 * disputes resolve in minutes instead of weeks, and drivers get protection
 * against false claims, which is a recruiting pitch on its own.
 */
export const ProofPhotoSchema = z.object({
  id: z.string().min(1).max(64),
  jobId: z.string().min(1).max(64),
  kind: ProofPhotoKindSchema,
  url: z.string().max(500),
  /** Device capture time, not server receipt time. */
  capturedAt: z.coerce.date(),
  capturedAtLocation: LatLngSchema.nullable().default(null),
  uploadedAt: z.coerce.date(),
  /** Hash of the original bytes. Makes tampering after the fact detectable. */
  contentHash: z.string().max(128).nullable().default(null),
  stopIndex: z.number().int().min(0).max(20).default(0),
});
export type ProofPhoto = z.infer<typeof ProofPhotoSchema>;

export const CancellationSchema = z.object({
  cancelledBy: z.enum(['customer', 'driver', 'ops', 'system']),
  cancelledAt: z.coerce.date(),
  reasonCode: z.string().max(64),
  reasonText: z.string().max(500).nullable().default(null),
  /** Whether a driver had already committed — decides whether a fee applies. */
  afterDriverCommitted: z.boolean(),
});
export type Cancellation = z.infer<typeof CancellationSchema>;

export const RatingSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().max(1000).nullable().default(null),
  tags: z.array(z.string().max(40)).max(10).default([]),
  createdAt: z.coerce.date(),
});
export type Rating = z.infer<typeof RatingSchema>;

export const JobSchema = z.object({
  id: z.string().min(1).max(64),
  /**
   * Short human reference — "HL-4821". What a customer reads out on the phone
   * and what ops types into the console. A UUID is unusable out loud.
   */
  reference: z.string().min(4).max(20),

  state: JobStateSchema,
  cityId: z.string().min(1).max(64),

  customerId: z.string().min(1).max(64),
  driverId: z.string().max(64).nullable().default(null),
  vehicleId: z.string().max(64).nullable().default(null),

  stops: z.array(StopSchema).min(2).max(20),
  manifest: ManifestSchema,
  schedule: ScheduleSchema,

  vehicleClassId: VehicleClassIdSchema,
  /** Total people working, driver included. */
  crewSize: z.number().int().min(1).max(6),

  quote: QuoteSchema,
  adjustments: z.array(AdjustmentSchema).max(20).default([]),

  proofPhotos: z.array(ProofPhotoSchema).max(60).default([]),

  /** Handover confirmation — PIN entered by the customer, or a signature blob. */
  completionPin: z.string().max(12).nullable().default(null),
  signatureUrl: z.string().max(500).nullable().default(null),

  cancellation: CancellationSchema.nullable().default(null),
  customerRating: RatingSchema.nullable().default(null),
  driverRating: RatingSchema.nullable().default(null),
  tipAmount: z.number().int().min(0).default(0),

  // --- timeline. One timestamp per state entered, for the duration dataset. ---
  createdAt: z.coerce.date(),
  bookedAt: z.coerce.date().nullable().default(null),
  matchedAt: z.coerce.date().nullable().default(null),
  enRouteAt: z.coerce.date().nullable().default(null),
  arrivedPickupAt: z.coerce.date().nullable().default(null),
  loadedAt: z.coerce.date().nullable().default(null),
  arrivedDropoffAt: z.coerce.date().nullable().default(null),
  completedAt: z.coerce.date().nullable().default(null),
  settledAt: z.coerce.date().nullable().default(null),

  /**
   * The single most valuable column in the database. Estimated vs. actual is
   * what turns a hand-tuned formula into a learned model, and after a couple of
   * thousand rows it is a moat no new entrant can copy by looking at the app.
   */
  actualWorkingMinutes: z.number().int().min(0).max(2880).nullable().default(null),
});
export type Job = z.infer<typeof JobSchema>;

// --- derived ----------------------------------------------------------------

export function pickupStop(job: Pick<Job, 'stops'>): Stop {
  const stop = job.stops.find((s) => s.kind === StopKind.Pickup);
  if (!stop) throw new Error('job has no pickup stop — schema guarantees at least two stops');
  return stop;
}

export function dropoffStops(job: Pick<Job, 'stops'>): Stop[] {
  return job.stops.filter((s) => s.kind === StopKind.Dropoff);
}

export function finalDropoff(job: Pick<Job, 'stops'>): Stop {
  const stops = dropoffStops(job);
  const last = stops[stops.length - 1];
  if (!last) throw new Error('job has no dropoff stop');
  return last;
}

/**
 * Actual working minutes: from arrival at the pickup to completion. This is the
 * number the pricing model is trying to predict, so it is measured the same way
 * every time rather than reconstructed differently in each report.
 */
export function computeActualWorkingMinutes(
  job: Pick<Job, 'arrivedPickupAt' | 'completedAt'>,
): number | null {
  if (!job.arrivedPickupAt || !job.completedAt) return null;
  const ms = job.completedAt.getTime() - job.arrivedPickupAt.getTime();
  return ms <= 0 ? 0 : Math.round(ms / 60_000);
}

/** Approved adjustments only. Proposed ones are not money until the customer agrees. */
export function approvedAdjustmentTotal(job: Pick<Job, 'adjustments'>): number {
  return job.adjustments
    .filter((a) => a.status === 'approved' || a.status === 'applied')
    .reduce((acc, a) => acc + a.deltaGross, 0);
}

/** What will actually be captured: the locked total, plus anything the customer approved. */
export function finalChargeableTotal(
  job: Pick<Job, 'quote' | 'adjustments' | 'tipAmount'>,
): number {
  return job.quote.lockedTotal + approvedAdjustmentTotal(job) + job.tipAmount;
}
