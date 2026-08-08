import { z } from 'zod';
import { IsraeliMobileSchema } from './locale.js';
import { LatLngSchema } from './geo.js';
import { VehicleClassIdSchema } from './vehicle.js';

/**
 * ---------------------------------------------------------------------------
 * Drivers, vehicles, documents
 * ---------------------------------------------------------------------------
 * Retention on this side is the whole business. A driver who is ambushed by a
 * job bigger than its description, or whose payout doesn't match what they were
 * promised, leaves — and replacing them costs more than the job earned.
 *
 * Israel has no Checkr equivalent, so the background check is a תעודת יושר
 * (police clearance certificate) uploaded and reviewed by a human. That is
 * slower than an API call and it is not optional.
 * ---------------------------------------------------------------------------
 */

export const DriverStatus = {
  /** Signed up, documents incomplete. */
  Onboarding: 'onboarding',
  /** Documents submitted, awaiting human review. */
  PendingReview: 'pending_review',
  /** Approved and able to go online. */
  Active: 'active',
  /** Auto-suspended — usually a lapsed insurance certificate. Self-healing on re-upload. */
  Suspended: 'suspended',
  /** Removed by ops. Not self-healing. */
  Banned: 'banned',
  /** Voluntarily left. */
  Inactive: 'inactive',
} as const;
export type DriverStatus = (typeof DriverStatus)[keyof typeof DriverStatus];
export const DriverStatusSchema = z.enum([
  DriverStatus.Onboarding,
  DriverStatus.PendingReview,
  DriverStatus.Active,
  DriverStatus.Suspended,
  DriverStatus.Banned,
  DriverStatus.Inactive,
]);

export const DocumentKind = {
  /** תעודת זהות */
  NationalId: 'national_id',
  /** Liveness selfie matched against the ID photo. */
  LivenessSelfie: 'liveness_selfie',
  /** רישיון נהיגה */
  DrivingLicence: 'driving_licence',
  /** רישיון רכב */
  VehicleRegistration: 'vehicle_registration',
  /** ביטוח חובה — compulsory motor insurance. */
  CompulsoryInsurance: 'compulsory_insurance',
  /** ביטוח צד ג׳ — third-party liability. */
  ThirdPartyInsurance: 'third_party_insurance',
  /** ביטוח מטענים — goods in transit. The one that matters when a sofa is destroyed. */
  GoodsInTransitInsurance: 'goods_in_transit_insurance',
  /** תעודת יושר — police clearance. Stands in for a background check. */
  PoliceClearance: 'police_clearance',
  /** Photos of the actual truck, inside and out. */
  VehiclePhotos: 'vehicle_photos',
  /** אישור ניהול חשבון — bank account confirmation, for payouts. */
  BankConfirmation: 'bank_confirmation',
  /** עוסק מורשה / פטור — tax registration. Required to invoice. */
  TaxRegistration: 'tax_registration',
} as const;
export type DocumentKind = (typeof DocumentKind)[keyof typeof DocumentKind];
export const DocumentKindSchema = z.enum([
  DocumentKind.NationalId,
  DocumentKind.LivenessSelfie,
  DocumentKind.DrivingLicence,
  DocumentKind.VehicleRegistration,
  DocumentKind.CompulsoryInsurance,
  DocumentKind.ThirdPartyInsurance,
  DocumentKind.GoodsInTransitInsurance,
  DocumentKind.PoliceClearance,
  DocumentKind.VehiclePhotos,
  DocumentKind.BankConfirmation,
  DocumentKind.TaxRegistration,
]);

/** Documents without which a driver cannot be dispatched a single job. */
export const REQUIRED_DOCUMENTS: readonly DocumentKind[] = [
  DocumentKind.NationalId,
  DocumentKind.LivenessSelfie,
  DocumentKind.DrivingLicence,
  DocumentKind.VehicleRegistration,
  DocumentKind.CompulsoryInsurance,
  DocumentKind.ThirdPartyInsurance,
  DocumentKind.GoodsInTransitInsurance,
  DocumentKind.PoliceClearance,
  DocumentKind.VehiclePhotos,
  DocumentKind.BankConfirmation,
];

/** Documents that expire, and whose lapse auto-suspends the account. */
export const EXPIRING_DOCUMENTS: readonly DocumentKind[] = [
  DocumentKind.DrivingLicence,
  DocumentKind.VehicleRegistration,
  DocumentKind.CompulsoryInsurance,
  DocumentKind.ThirdPartyInsurance,
  DocumentKind.GoodsInTransitInsurance,
];

export const DocumentStatus = {
  Missing: 'missing',
  Submitted: 'submitted',
  Approved: 'approved',
  Rejected: 'rejected',
  Expired: 'expired',
} as const;
export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus];
export const DocumentStatusSchema = z.enum([
  DocumentStatus.Missing,
  DocumentStatus.Submitted,
  DocumentStatus.Approved,
  DocumentStatus.Rejected,
  DocumentStatus.Expired,
]);

export const DriverDocumentSchema = z.object({
  id: z.string().min(1).max(64),
  driverId: z.string().min(1).max(64),
  kind: DocumentKindSchema,
  status: DocumentStatusSchema.default(DocumentStatus.Missing),

  fileUrls: z.array(z.string().max(500)).max(10).default([]),

  submittedAt: z.coerce.date().nullable().default(null),
  reviewedAt: z.coerce.date().nullable().default(null),
  reviewedBy: z.string().max(64).nullable().default(null),

  /** Tracked in the database so a lapse can suspend the account automatically. */
  expiresAt: z.coerce.date().nullable().default(null),

  /**
   * Shown verbatim to the driver. The onboarding tracker must name exactly what
   * is blocking them — "rejected" with no reason is why drivers give up.
   */
  rejectionReasonHe: z.string().max(500).nullable().default(null),
});
export type DriverDocument = z.infer<typeof DriverDocumentSchema>;

export const VehicleSchema = z.object({
  id: z.string().min(1).max(64),
  driverId: z.string().min(1).max(64),
  classId: VehicleClassIdSchema,

  /** מספר רישוי */
  plateNumber: z.string().min(5).max(15),
  make: z.string().max(60),
  model: z.string().max(60),
  year: z.number().int().min(1980).max(2100),
  colour: z.string().max(40),

  /** Real photos of this truck — shown to the customer in "choose your crew". */
  photoUrls: z.array(z.string().max(500)).max(10).default([]),

  /** Overrides the class default when a driver's van is fitted out differently. */
  hasCrane: z.boolean().default(false),
  hasTailLift: z.boolean().default(false),
  hasBlankets: z.boolean().default(true),
  hasStraps: z.boolean().default(true),
  hasTrolley: z.boolean().default(false),

  isActive: z.boolean().default(true),
});
export type Vehicle = z.infer<typeof VehicleSchema>;

export const DriverSchema = z.object({
  id: z.string().min(1).max(64),
  status: DriverStatusSchema.default(DriverStatus.Onboarding),

  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  phone: IsraeliMobileSchema,
  email: z.email().max(200).nullable().default(null),
  /** Shown to customers. Real face, not a logo. */
  photoUrl: z.string().max(500).nullable().default(null),

  /** In their own voice. Cheap to build, and it earns trust. */
  bioHe: z.string().max(600).nullable().default(null),

  cityId: z.string().min(1).max(64),
  /** Home base. Used to bias dispatch toward jobs that end near where they live. */
  homeBase: LatLngSchema.nullable().default(null),

  // --- reputation, all of it computed rather than entered --------------------
  rating: z.number().min(0).max(5).default(0),
  ratingCount: z.number().int().min(0).default(0),
  completedJobs: z.number().int().min(0).default(0),
  /** Offers accepted / offers received. A core dispatch scoring input. */
  acceptanceRate: z.number().min(0).max(1).default(0),
  /** Accepted jobs completed without cancelling. */
  completionRate: z.number().min(0).max(1).default(0),

  /** Self-declared and verified competencies: pianos, safes, crane operation. */
  capabilities: z.array(z.string().max(64)).max(30).default([]),

  /** Payment-provider connected-account id. Provider-agnostic on purpose. */
  payoutAccountId: z.string().max(120).nullable().default(null),
  payoutAccountReady: z.boolean().default(false),

  createdAt: z.coerce.date(),
  approvedAt: z.coerce.date().nullable().default(null),
  suspendedAt: z.coerce.date().nullable().default(null),
  suspensionReasonHe: z.string().max(500).nullable().default(null),
});
export type Driver = z.infer<typeof DriverSchema>;

/**
 * Whether this driver may currently be offered work. Deliberately strict: an
 * expired goods-in-transit certificate is the difference between an insured
 * claim and an uninsured one, which the plan names as the single biggest
 * existential risk in the business.
 */
export function canReceiveOffers(
  driver: Pick<Driver, 'status' | 'payoutAccountReady'>,
  documents: readonly Pick<DriverDocument, 'kind' | 'status' | 'expiresAt'>[],
  now: Date = new Date(),
): { eligible: boolean; blockers: string[] } {
  const blockers: string[] = [];

  if (driver.status !== DriverStatus.Active) {
    blockers.push(`driver status is "${driver.status}"`);
  }
  if (!driver.payoutAccountReady) {
    blockers.push('payout account is not ready');
  }

  const byKind = new Map(documents.map((d) => [d.kind, d]));
  for (const kind of REQUIRED_DOCUMENTS) {
    const doc = byKind.get(kind);
    if (!doc || doc.status !== DocumentStatus.Approved) {
      blockers.push(`missing or unapproved document: ${kind}`);
      continue;
    }
    if (doc.expiresAt && doc.expiresAt <= now) {
      blockers.push(`expired document: ${kind}`);
    }
  }

  return { eligible: blockers.length === 0, blockers };
}

/** Documents lapsing soon, for the nudge that prevents the suspension. */
export function documentsExpiringWithin(
  documents: readonly DriverDocument[],
  days: number,
  now: Date = new Date(),
): DriverDocument[] {
  const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return documents.filter(
    (d) => d.expiresAt !== null && d.expiresAt > now && d.expiresAt <= cutoff,
  );
}
