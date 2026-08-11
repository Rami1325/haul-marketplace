import {
  CancellationReasonSchema,
  JobStateSchema,
  LatLngSchema,
  NonNegativeAgorotSchema,
  PriceBreakdownSchema,
  StopKindSchema,
  VehicleClassIdSchema,
  finalChargeableTotal,
  quoteSecondsRemaining,
  type Driver,
  type Job,
  type Quote,
  type Stop,
  type Vehicle,
} from '@haul/types';
import { z } from 'zod';

/**
 * ---------------------------------------------------------------------------
 * View models — the shapes a client is allowed to see
 * ---------------------------------------------------------------------------
 * `Quote`, `Job` and `Driver` are the shapes the server reasons with. They
 * carry a driver's payout account, an ops reviewer's username, the rate card
 * version that produced a price and a driver's home coordinates. None of that
 * belongs on a phone.
 *
 * Every model here is a schema and a function, never a TypeScript type on its
 * own. A view model that is only a narrowing is a lie: `const view: PublicDriver
 * = driver` compiles, and every field the type does not mention is still on the
 * object, still serialised, still in the response body and still in whatever
 * logged it. The types below are `z.infer` of schemas, and each constructor
 * builds a fresh literal and parses it — so an unknown key is stripped by Zod
 * even if somebody later reaches for a spread.
 *
 * These are also where the derived numbers a client would otherwise recompute
 * live: seconds left on a lock, the chargeable total including approved
 * adjustments, how many items are on the manifest. Recomputing those on three
 * clients is three chances to get the arithmetic slightly different.
 * ---------------------------------------------------------------------------
 */

// --- driver -----------------------------------------------------------------

/**
 * The truck, as the customer standing on the pavement needs to recognise it.
 *
 * `plateNumber` is included deliberately: מספר רישוי is what you read off the
 * back of the truck that just pulled up, and every ride-hailing app in Israel
 * shows it for exactly that reason. The fitted-out equipment flags, the
 * registration id and the active flag are dispatch inputs and stay behind.
 */
export const PublicVehicleSchema = z.object({
  classId: VehicleClassIdSchema,
  make: z.string().max(60),
  model: z.string().max(60),
  colour: z.string().max(40),
  /** מספר רישוי. */
  plateNumber: z.string().min(5).max(15),
  /** Photos of this actual truck, not a stock illustration of the class. */
  photoUrls: z.array(z.string().max(500)).max(10),
});
export type PublicVehicle = z.infer<typeof PublicVehicleSchema>;

/**
 * The crew card: who is coming, what they drive, what other customers thought.
 *
 * What is deliberately absent, and why:
 *
 *  · `lastName`, `email` — the customer meets a person at a door, not a record.
 *  · `phone` — the customer does need to reach the driver, but through a
 *    per-job proxy number that stops working when the job does. A driver's real
 *    mobile handed out with every booking is a driver who changes it.
 *  · `acceptanceRate`, `completionRate`, `status` — internal dispatch scores. A
 *    customer reading "82% acceptance" off their own driver is a driver
 *    relations problem with no upside.
 *  · `homeBase` — where the driver lives.
 *  · `payoutAccountId`, `payoutAccountReady`, `suspensionReasonHe` — the
 *    business's side of the relationship.
 */
export const PublicDriverSchema = z.object({
  id: z.string().min(1).max(64),
  /** First name only. It is what appears on the door and in the SMS. */
  firstName: z.string().min(1).max(80),
  photoUrl: z.string().max(500).nullable(),
  /** In the driver's own voice. */
  bioHe: z.string().max(600).nullable(),
  rating: z.number().min(0).max(5),
  ratingCount: z.number().int().min(0),
  completedJobs: z.number().int().min(0),
  vehicle: PublicVehicleSchema.nullable(),
});
export type PublicDriver = z.infer<typeof PublicDriverSchema>;

/**
 * Narrow a driver to what a customer may see.
 *
 * Constructs a new object rather than narrowing a type, and parses it, so the
 * private half of the record cannot ride along in the response body. The
 * vehicle is a second argument because it is a second aggregate; a job with no
 * truck assigned yet still has a driver on it during the accepted state.
 */
export function toPublicDriver(driver: Driver, vehicle?: Vehicle | null): PublicDriver {
  return PublicDriverSchema.parse({
    id: driver.id,
    firstName: driver.firstName,
    photoUrl: driver.photoUrl,
    bioHe: driver.bioHe,
    rating: driver.rating,
    ratingCount: driver.ratingCount,
    completedJobs: driver.completedJobs,
    vehicle: vehicle ? toPublicVehicle(vehicle) : null,
  });
}

/** The truck alone, for the "choose your crew" card before a driver is assigned. */
export function toPublicVehicle(vehicle: Vehicle): PublicVehicle {
  return PublicVehicleSchema.parse({
    classId: vehicle.classId,
    make: vehicle.make,
    model: vehicle.model,
    colour: vehicle.colour,
    plateNumber: vehicle.plateNumber,
    photoUrls: vehicle.photoUrls,
  });
}

// --- quote ------------------------------------------------------------------

export const QuoteViewSchema = z.object({
  id: z.string().min(1).max(64),
  cityId: z.string().min(1).max(64),

  /**
   * Every line, including the ones flagged `isVisible: false`.
   *
   * Dropping the invisible lines here would be the obvious tidy-up and it would
   * break the one property the product is built on: the rounding adjustment
   * lives on the net side precisely so the lines still sum to the total, and a
   * receipt whose lines do not add up is the failure this company exists to
   * prevent. The flag says which lines get their own row on screen; it does not
   * say which lines exist.
   */
  breakdown: PriceBreakdownSchema,
  /** The locked number. Mirrors `breakdown.grossTotal`. */
  lockedTotal: NonNegativeAgorotSchema,

  issuedAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
  /**
   * Seconds left when the response was built.
   *
   * Redundant against `expiresAt` and carried anyway, because a phone's clock
   * is routinely minutes out and a countdown seeded from the device's own idea
   * of now starts at the wrong number. The client counts down from this and
   * reconciles against `expiresAt` on the next round trip.
   */
  secondsRemaining: z.number().int().min(0),
  isExpired: z.boolean(),

  estimatedWorkingMinutes: z.number().int().min(0).max(2880),
  recommendedVehicleClass: VehicleClassIdSchema,
  crewSize: z.number().int().min(1).max(6),
  routedDistanceMeters: z.number().int().min(0),
});
export type QuoteView = z.infer<typeof QuoteViewSchema>;

/**
 * A quote as the customer may see it.
 *
 * Four fields of the record do not cross: `driverPayout`, because what share of
 * the fare the driver is guaranteed is a disclosure decision nobody has made
 * and a default of "publish it" is not one to make by accident; and
 * `engineVersion`, `rateCardVersion` and `inputHash`, which are how support
 * explains a price months later and, put together, are a running description of
 * when we retune. `reviewedBy` is an ops username.
 *
 * The clock is a parameter for the same reason it is one in `toQuote`: the
 * server's clock is the one the lock is measured against.
 */
export function toQuoteView(quote: Quote, now: Date = new Date()): QuoteView {
  return QuoteViewSchema.parse({
    id: quote.id,
    cityId: quote.cityId,
    breakdown: quote.breakdown,
    lockedTotal: quote.lockedTotal,
    issuedAt: quote.issuedAt,
    expiresAt: quote.expiresAt,
    secondsRemaining: quoteSecondsRemaining(quote, now),
    isExpired: now > quote.expiresAt,
    estimatedWorkingMinutes: quote.estimatedWorkingMinutes,
    recommendedVehicleClass: quote.recommendedVehicleClass,
    crewSize: quote.crewSize,
    routedDistanceMeters: quote.routedDistanceMeters,
  });
}

// --- job --------------------------------------------------------------------

/**
 * A stop as a list row and a map pin need it.
 *
 * The full `Address` — entrance, apartment, gate code, postal code — is not
 * here. A summary is the object that ends up in a list response, a push
 * notification payload and a log line, and "דירה 5, קוד שער 1234" is the part
 * of an address that should travel only when somebody is actually going there.
 */
export const JobStopViewSchema = z.object({
  index: z.number().int().min(0).max(20),
  kind: StopKindSchema,
  /** Single-line rendering. The one string a row shows. */
  formatted: z.string().max(500),
  city: z.string().max(120),
  coordinates: LatLngSchema,
  arrivedAt: z.coerce.date().nullable(),
  departedAt: z.coerce.date().nullable(),
});
export type JobStopView = z.infer<typeof JobStopViewSchema>;

export const JobCancellationViewSchema = z.object({
  reasonCode: CancellationReasonSchema,
  cancelledBy: z.enum(['customer', 'driver', 'ops', 'system']),
  cancelledAt: z.coerce.date(),
});
export type JobCancellationView = z.infer<typeof JobCancellationViewSchema>;

export const JobSummarySchema = z.object({
  id: z.string().min(1).max(64),
  /** "HL-4821" — what the customer reads out on the phone. */
  reference: z.string().min(4).max(20),
  state: JobStateSchema,
  cityId: z.string().min(1).max(64),

  stops: z.array(JobStopViewSchema).min(2).max(20),
  /** Total pieces on the manifest. The list row says "23 items", not the list. */
  itemCount: z.number().int().min(0),

  windowStart: z.coerce.date(),
  windowEnd: z.coerce.date(),
  timezone: z.string().max(64),

  vehicleClassId: VehicleClassIdSchema,
  crewSize: z.number().int().min(1).max(6),

  /** The price that was locked. */
  lockedTotal: NonNegativeAgorotSchema,
  /**
   * What will actually be captured: the lock, plus adjustments the customer
   * approved, plus any tip. Equal to `lockedTotal` on the ordinary job, and the
   * two being separate fields is what makes a difference between them visible
   * rather than something the customer discovers on a statement.
   */
  chargeableTotal: NonNegativeAgorotSchema,

  driver: PublicDriverSchema.nullable(),
  cancellation: JobCancellationViewSchema.nullable(),

  createdAt: z.coerce.date(),
  bookedAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(),
});
export type JobSummary = z.infer<typeof JobSummarySchema>;

function toJobStopView(stop: Stop): JobStopView {
  return JobStopViewSchema.parse({
    index: stop.index,
    kind: stop.kind,
    formatted: stop.address.formatted,
    city: stop.address.city,
    coordinates: stop.address.coordinates,
    arrivedAt: stop.arrivedAt,
    departedAt: stop.departedAt,
  });
}

/**
 * A job as a row in "my moves" and as the header of the tracking screen.
 *
 * Summary means summary. The manifest, the proof photos, the adjustment
 * history, the customer id, the signature and the handover PIN are all separate
 * reads with their own authorisation — the PIN in particular, because it is the
 * secret that proves a handover happened and this object is the one that ends
 * up in a push payload.
 *
 * `cancellation.reasonText` is left behind with them: the code is the bucket
 * both sides agree on, and the text beside it is ops prose written for another
 * human at the console.
 */
export function toJobSummary(
  job: Job,
  driver?: Driver | null,
  vehicle?: Vehicle | null,
): JobSummary {
  return JobSummarySchema.parse({
    id: job.id,
    reference: job.reference,
    state: job.state,
    cityId: job.cityId,

    stops: job.stops.map(toJobStopView),
    itemCount: job.manifest.lines.reduce((total, line) => total + line.quantity, 0),

    windowStart: job.schedule.windowStart,
    windowEnd: job.schedule.windowEnd,
    timezone: job.schedule.timezone,

    vehicleClassId: job.vehicleClassId,
    crewSize: job.crewSize,

    lockedTotal: job.quote.lockedTotal,
    chargeableTotal: finalChargeableTotal(job),

    driver: driver ? toPublicDriver(driver, vehicle) : null,
    cancellation: job.cancellation
      ? {
          reasonCode: job.cancellation.reasonCode,
          cancelledBy: job.cancellation.cancelledBy,
          cancelledAt: job.cancellation.cancelledAt,
        }
      : null,

    createdAt: job.createdAt,
    bookedAt: job.bookedAt,
    completedAt: job.completedAt,
  });
}
