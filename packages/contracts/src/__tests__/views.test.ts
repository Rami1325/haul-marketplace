import {
  DriverSchema,
  JobSchema,
  QuoteSchema,
  VehicleSchema,
  finalChargeableTotal,
  quoteSecondsRemaining,
  verifyBreakdown,
  type Driver,
} from '@haul/types';
import { describe, expect, it } from 'vitest';
import { toJobSummary, toPublicDriver, toPublicVehicle, toQuoteView } from '../views.js';
import { DRIVER, ISSUED_AT, PICKUP_ADDRESS, VEHICLE, testJob, testQuote } from './fixtures.js';

/**
 * The enforcement in this file is not "the type has the right fields" — a type
 * cannot stop a key reaching a response body. Every key of the source schema is
 * classified as shown or withheld, and the union must be the whole schema. Add
 * a field to `Driver` and this fails until somebody decides which it is, which
 * is the moment the decision is cheap.
 */

function classify(
  schemaKeys: readonly string[],
  shown: readonly string[],
  withheld: readonly string[],
) {
  return {
    unclassified: schemaKeys.filter((key) => !shown.includes(key) && !withheld.includes(key)),
    stale: [...shown, ...withheld].filter((key) => !schemaKeys.includes(key)),
  };
}

// --- driver -----------------------------------------------------------------

const DRIVER_SHOWN = [
  'id',
  'firstName',
  'photoUrl',
  'bioHe',
  'rating',
  'ratingCount',
  'completedJobs',
];

const DRIVER_WITHHELD = [
  'status',
  'lastName',
  'phone',
  'email',
  'cityId',
  'homeBase',
  'acceptanceRate',
  'completionRate',
  'capabilities',
  'payoutAccountId',
  'payoutAccountReady',
  'createdAt',
  'approvedAt',
  'suspendedAt',
  'suspensionReasonHe',
];

describe('toPublicDriver', () => {
  it('classifies every field the driver record has', () => {
    const { unclassified, stale } = classify(
      Object.keys(DriverSchema.shape),
      DRIVER_SHOWN,
      DRIVER_WITHHELD,
    );
    expect(unclassified).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('emits exactly the shown fields, plus the vehicle', () => {
    const view = toPublicDriver(DRIVER, VEHICLE);
    expect(Object.keys(view).sort()).toEqual([...DRIVER_SHOWN, 'vehicle'].sort());
  });

  it('carries no withheld key', () => {
    const view = toPublicDriver(DRIVER, VEHICLE);
    for (const key of DRIVER_WITHHELD) {
      expect(view).not.toHaveProperty(key);
    }
  });

  it('carries no withheld value anywhere in the serialised body', () => {
    const body = JSON.stringify(toPublicDriver(DRIVER, VEHICLE));
    const secrets = [
      DRIVER.lastName,
      DRIVER.phone,
      DRIVER.email,
      DRIVER.payoutAccountId,
      String(DRIVER.homeBase?.lat),
      String(DRIVER.acceptanceRate),
    ];
    for (const secret of secrets) {
      expect(secret).toBeTruthy();
      expect(body).not.toContain(secret);
    }
  });

  it('constructs a new object rather than narrowing the one it was given', () => {
    // A view model that is only a type annotation still serialises the whole
    // record. This one is built and parsed, so a key nobody declared is gone
    // even when it exists at runtime.
    const smuggled = { ...DRIVER, nationalIdNumber: '123456789' } as unknown as Driver;
    const view = toPublicDriver(smuggled);
    expect(view).not.toHaveProperty('nationalIdNumber');
    expect(JSON.stringify(view)).not.toContain('123456789');
    expect(view as unknown).not.toBe(smuggled);
  });

  it('has no vehicle until one is assigned', () => {
    expect(toPublicDriver(DRIVER).vehicle).toBeNull();
    expect(toPublicDriver(DRIVER, null).vehicle).toBeNull();
  });
});

const VEHICLE_SHOWN = ['classId', 'make', 'model', 'colour', 'plateNumber', 'photoUrls'];

const VEHICLE_WITHHELD = [
  'id',
  'driverId',
  'year',
  'hasCrane',
  'hasTailLift',
  'hasBlankets',
  'hasStraps',
  'hasTrolley',
  'isActive',
];

describe('toPublicVehicle', () => {
  it('classifies every field the vehicle record has', () => {
    const { unclassified, stale } = classify(
      Object.keys(VehicleSchema.shape),
      VEHICLE_SHOWN,
      VEHICLE_WITHHELD,
    );
    expect(unclassified).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('shows what identifies the truck at the kerb and nothing about its fit-out', () => {
    const view = toPublicVehicle(VEHICLE);
    expect(Object.keys(view).sort()).toEqual([...VEHICLE_SHOWN].sort());
    expect(view.plateNumber).toBe(VEHICLE.plateNumber);
    for (const key of VEHICLE_WITHHELD) expect(view).not.toHaveProperty(key);
  });
});

// --- quote ------------------------------------------------------------------

const QUOTE_SHOWN = [
  'id',
  'cityId',
  'breakdown',
  'lockedTotal',
  'issuedAt',
  'expiresAt',
  'estimatedWorkingMinutes',
  'recommendedVehicleClass',
  'crewSize',
  'routedDistanceMeters',
];

const QUOTE_WITHHELD = [
  'driverPayout',
  'engineVersion',
  'rateCardVersion',
  'inputHash',
  'reviewedBy',
];

describe('toQuoteView', () => {
  it('classifies every field the quote record has', () => {
    const { unclassified, stale } = classify(
      Object.keys(QuoteSchema.shape),
      QUOTE_SHOWN,
      QUOTE_WITHHELD,
    );
    expect(unclassified).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('keeps the price and drops the provenance', () => {
    const view = toQuoteView(testQuote(), ISSUED_AT);
    expect(Object.keys(view).sort()).toEqual(
      [...QUOTE_SHOWN, 'secondsRemaining', 'isExpired'].sort(),
    );
    for (const key of QUOTE_WITHHELD) expect(view).not.toHaveProperty(key);
  });

  it('keeps a breakdown that still adds up, invisible lines included', () => {
    const quote = testQuote();
    const view = toQuoteView(quote, ISSUED_AT);
    expect(view.breakdown.lines).toHaveLength(quote.breakdown.lines.length);
    expect(verifyBreakdown(view.breakdown)).toEqual({ ok: true });
    expect(view.lockedTotal).toBe(view.breakdown.grossTotal);
  });

  it('seeds the countdown from the server clock, not the device', () => {
    const quote = testQuote();
    const halfway = new Date(
      quote.issuedAt.getTime() + (quote.expiresAt.getTime() - quote.issuedAt.getTime()) / 2,
    );
    const view = toQuoteView(quote, halfway);
    expect(view.secondsRemaining).toBe(quoteSecondsRemaining(quote, halfway));
    expect(view.isExpired).toBe(false);
  });

  it('reads zero and expired once the lock has lapsed, never a negative countdown', () => {
    const quote = testQuote();
    const after = new Date(quote.expiresAt.getTime() + 60_000);
    const view = toQuoteView(quote, after);
    expect(view.secondsRemaining).toBe(0);
    expect(view.isExpired).toBe(true);
  });
});

// --- job --------------------------------------------------------------------

/** Same name in the summary. */
const JOB_SHOWN = [
  'id',
  'reference',
  'state',
  'cityId',
  'stops',
  'vehicleClassId',
  'crewSize',
  'cancellation',
  'createdAt',
  'bookedAt',
  'completedAt',
];

/** Reaches the summary as a derived field: an item count, a window, a total. */
const JOB_DERIVED = ['manifest', 'schedule', 'quote', 'adjustments', 'tipAmount', 'driverId'];

const JOB_WITHHELD = [
  'customerId',
  'vehicleId',
  'proofPhotos',
  'completionPin',
  'signatureUrl',
  'customerRating',
  'driverRating',
  'matchedAt',
  'enRouteAt',
  'arrivedPickupAt',
  'loadedAt',
  'arrivedDropoffAt',
  'settledAt',
  'actualWorkingMinutes',
];

describe('toJobSummary', () => {
  it('classifies every field the job record has', () => {
    const { unclassified, stale } = classify(
      Object.keys(JobSchema.shape),
      [...JOB_SHOWN, ...JOB_DERIVED],
      JOB_WITHHELD,
    );
    expect(unclassified).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('withholds the handover secret and everything support reads', () => {
    const job = testJob();
    const summary = toJobSummary(job, DRIVER, VEHICLE);
    for (const key of JOB_WITHHELD) expect(summary).not.toHaveProperty(key);
    const body = JSON.stringify(summary);
    expect(body).not.toContain(job.completionPin ?? 'never');
    expect(body).not.toContain(job.customerId);
    expect(body).not.toContain('signatures/');
  });

  it('says what will actually be captured, not only what was locked', () => {
    const job = testJob();
    const summary = toJobSummary(job, DRIVER, VEHICLE);
    expect(summary.lockedTotal).toBe(job.quote.lockedTotal);
    expect(summary.chargeableTotal).toBe(finalChargeableTotal(job));
    expect(summary.chargeableTotal).toBeGreaterThan(summary.lockedTotal);
  });

  it('counts the pieces instead of listing them', () => {
    const job = testJob();
    const summary = toJobSummary(job, DRIVER, VEHICLE);
    expect(summary.itemCount).toBe(
      job.manifest.lines.reduce((total, line) => total + line.quantity, 0),
    );
    expect(summary).not.toHaveProperty('manifest');
  });

  it('narrows the stops to a row and a pin', () => {
    const summary = toJobSummary(testJob(), DRIVER, VEHICLE);
    const pickup = summary.stops[0];
    expect(pickup?.index).toBe(0);
    // The pin is the row's map marker, so it survives the narrowing — and it is
    // this stop's, which `toBeDefined` alone would not have caught.
    expect(pickup?.coordinates).toEqual(PICKUP_ADDRESS.coordinates);
    for (const key of ['entrance', 'apartment', 'postalCode', 'placeId', 'notes', 'street']) {
      expect(pickup).not.toHaveProperty(key);
    }
  });

  it('has no driver until one is assigned', () => {
    expect(toJobSummary(testJob({ driverId: null, state: 'matching' })).driver).toBeNull();
  });

  it('gives the cancellation bucket without the ops prose beside it', () => {
    const job = testJob({
      state: 'cancelled',
      cancellation: {
        cancelledBy: 'customer',
        cancelledAt: new Date('2026-08-11T10:00:00.000Z'),
        reasonCode: 'date_changed',
        reasonText: 'INTERNAL ops note: customer called the console twice',
        afterDriverCommitted: true,
      },
    });
    const summary = toJobSummary(job, DRIVER, VEHICLE);
    expect(summary.cancellation?.reasonCode).toBe('date_changed');
    expect(summary.cancellation).not.toHaveProperty('reasonText');
    expect(summary.cancellation).not.toHaveProperty('afterDriverCommitted');
    expect(JSON.stringify(summary)).not.toContain('INTERNAL ops note');
  });
});
