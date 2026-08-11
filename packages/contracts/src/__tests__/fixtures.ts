import { CATALOG_BY_ID, TEL_AVIV_CITY, type CityConfig } from '@haul/config';
import { computeQuote, toQuote, type RateCard } from '@haul/pricing';
import {
  DriverSchema,
  JobSchema,
  StopKind,
  VehicleSchema,
  type Driver,
  type Job,
  type Quote,
  type Vehicle,
} from '@haul/types';
import { BOOKING_DRAFT_VERSION, BookingDraftSchema, type BookingDraft } from '../draft.js';
import { toManifest, toQuoteInput, toStops } from '../to-quote-input.js';

/**
 * Fixtures.
 *
 * The real Tel Aviv city and rate card, deliberately: this package converts
 * drafts rather than pricing them, so nothing here asserts a shekel figure, and
 * `scheduleInputFor` needs real candle-lighting coordinates to classify a
 * Friday evening correctly. A synthetic city would make the one test that
 * proves the schedule went through Jerusalem local time prove nothing.
 *
 * Everything is stated as a plain JSON document — the shape a jsonb column
 * holds, before `BookingDraftSchema` has seen it — so a test can drop a field
 * and get the state a half-filled form is actually in.
 */

export const CITY: CityConfig = TEL_AVIV_CITY;
export const CARD: RateCard = TEL_AVIV_CITY.rateCard;

/** Wednesday 12 August 2026, 10:00 Jerusalem (UTC+3 in August). */
export const SCHEDULED_AT = '2026-08-12T07:00:00.000Z';

export const PICKUP_ADDRESS = {
  street: 'דיזנגוף',
  houseNumber: '100',
  city: 'תל אביב-יפו',
  coordinates: { lat: 32.0785, lng: 34.7742 },
};

export const DROPOFF_ADDRESS = {
  street: 'רוטשילד',
  houseNumber: '22',
  city: 'תל אביב-יפו',
  coordinates: { lat: 32.0641, lng: 34.7748 },
};

/** Third floor, no lift, contested street parking — the Tel Aviv default. */
export const PICKUP_STOP = {
  kind: StopKind.Pickup,
  address: PICKUP_ADDRESS,
  access: { floor: 3, elevator: 'none', parking: 'street_hard' },
  contactName: 'רמי',
  contactPhone: '052-123-4567',
};

export const DROPOFF_STOP = {
  kind: StopKind.Dropoff,
  address: DROPOFF_ADDRESS,
  access: { floor: 0, elevator: 'none', parking: 'street_easy' },
};

export function completeDraftInput(): Record<string, unknown> {
  return {
    version: BOOKING_DRAFT_VERSION,
    cityId: CITY.id,
    locale: 'he',
    basket: [
      { catalogItemId: 'fridge_large', quantity: 1 },
      { catalogItemId: 'washing_machine', quantity: 1 },
      { catalogItemId: 'bed_double_frame', quantity: 1 },
      { catalogItemId: 'box_medium', quantity: 10 },
    ],
    stops: [PICKUP_STOP, DROPOFF_STOP],
    scheduleKind: 'scheduled',
    at: SCHEDULED_AT,
    routedDistanceMeters: 8_400,
  };
}

/** The same draft, parsed, with an optional patch applied at the top level. */
export function completeDraft(patch: Record<string, unknown> = {}): BookingDraft {
  return BookingDraftSchema.parse({ ...completeDraftInput(), ...patch });
}

/** The complete draft with the pickup's access answers replaced wholesale. */
export function draftWithPickupAccess(access: Record<string, unknown>): BookingDraft {
  return completeDraft({
    stops: [{ kind: StopKind.Pickup, address: PICKUP_ADDRESS, access }, DROPOFF_STOP],
  });
}

export const ISSUED_AT = new Date('2026-08-11T09:00:00.000Z');

/** A real quote: priced by the engine from the fixture draft, not hand-built. */
export function testQuote(): Quote {
  const input = toQuoteInput(completeDraft(), CITY, CARD);
  const result = computeQuote(input, CARD, CATALOG_BY_ID);
  return toQuote(input, result, CARD, { issuedAt: ISSUED_AT });
}

/**
 * A driver whose private half is filled with values a test can search the
 * serialised output for. Anything recognisable in a response body is a leak.
 */
export const DRIVER: Driver = DriverSchema.parse({
  id: 'drv_TESTDRIVER',
  status: 'active',
  firstName: 'יוסי',
  lastName: 'כהן-פרטי',
  phone: '052-111-2222',
  email: 'private.driver@example.com',
  photoUrl: 'https://cdn.example.com/drivers/yossi.jpg',
  bioHe: 'מוביל ותיק, עשר שנים בגוש דן.',
  cityId: 'tel-aviv',
  homeBase: { lat: 32.0134, lng: 34.7743 },
  rating: 4.8,
  ratingCount: 132,
  completedJobs: 410,
  acceptanceRate: 0.82,
  completionRate: 0.97,
  capabilities: ['piano_upright', 'crane_operation'],
  payoutAccountId: 'acct_SECRET_BANK_TRIPLET',
  payoutAccountReady: true,
  createdAt: new Date('2025-03-01T08:00:00.000Z'),
  approvedAt: new Date('2025-03-14T08:00:00.000Z'),
  suspendedAt: null,
  suspensionReasonHe: null,
});

export const VEHICLE: Vehicle = VehicleSchema.parse({
  id: 'veh_TESTVEHICLE',
  driverId: DRIVER.id,
  classId: 'van',
  plateNumber: '12-345-67',
  make: 'Mercedes',
  model: 'Sprinter',
  year: 2021,
  colour: 'לבן',
  photoUrls: ['https://cdn.example.com/vehicles/sprinter.jpg'],
  hasCrane: false,
  hasTailLift: true,
  hasBlankets: true,
  hasStraps: true,
  hasTrolley: true,
  isActive: true,
});

/**
 * A booked job, mid-flight, carrying every field a summary must not repeat: the
 * handover PIN, the signature, the customer id, an approved adjustment and a
 * tip.
 */
export function testJob(overrides: Record<string, unknown> = {}): Job {
  const draft = completeDraft();
  const quote = testQuote();
  return JobSchema.parse({
    id: 'job_TESTJOB',
    reference: 'HL-4821',
    state: 'accepted',
    cityId: CITY.id,
    customerId: 'cus_SECRETCUSTOMER',
    driverId: DRIVER.id,
    vehicleId: VEHICLE.id,

    stops: toStops(draft),
    manifest: toManifest(draft),
    schedule: {
      kind: 'scheduled',
      windowStart: new Date(SCHEDULED_AT),
      windowEnd: new Date('2026-08-12T09:00:00.000Z'),
      timezone: 'Asia/Jerusalem',
    },

    vehicleClassId: 'van',
    crewSize: 2,
    quote,
    adjustments: [
      {
        id: 'adj_TEST',
        jobId: 'job_TESTJOB',
        reason: 'unlisted_items',
        status: 'approved',
        lines: [
          {
            kind: 'adjustment',
            key: 'unlisted.boxes',
            labelHe: 'ארגזים נוספים',
            labelEn: 'Extra boxes',
            amount: 8_475,
          },
        ],
        deltaGross: 10_000,
        proposedBy: 'driver',
        proposedAt: new Date('2026-08-12T08:10:00.000Z'),
      },
    ],
    // Deliberately unrelated to the reference: a PIN that happened to be the
    // reference's digits would make the leak test pass for the wrong reason.
    completionPin: '9137',
    signatureUrl: 'https://cdn.example.com/signatures/job_TESTJOB.png',
    tipAmount: 2_000,
    createdAt: new Date('2026-08-11T09:00:00.000Z'),
    bookedAt: new Date('2026-08-11T09:02:00.000Z'),
    matchedAt: new Date('2026-08-11T09:03:00.000Z'),
    ...overrides,
  });
}
