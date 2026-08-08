import { pgEnum } from 'drizzle-orm/pg-core';
import {
  AdjustmentReason,
  AdjustmentStatus,
  DocumentKind,
  DocumentStatus,
  DriverStatus,
  ElevatorKind,
  ItemCategory,
  JobState,
  LedgerAccount,
  LedgerEventKind,
  OfferStatus,
  ParkingSituation,
  ProofPhotoKind,
  CraneNeed,
  ScheduleKind,
  StopKind,
  VehicleClassId,
} from '@haul/types';

/**
 * Postgres enums generated from the domain enums in `@haul/types`.
 *
 * Deriving them means the database physically cannot hold a job state the
 * application does not know about. The cost is that adding a value needs a
 * migration — which is the correct amount of friction for changing the set of
 * states a job can be in.
 */

// Small helper so the tuple type Postgres enums require comes straight from the
// domain object without hand-maintaining a parallel list.
function values<T extends Record<string, string>>(source: T): [string, ...string[]] {
  const list = Object.values(source);
  return [list[0]!, ...list.slice(1)];
}

export const jobStateEnum = pgEnum('job_state', values(JobState));
export const stopKindEnum = pgEnum('stop_kind', values(StopKind));
export const scheduleKindEnum = pgEnum('schedule_kind', values(ScheduleKind));
export const elevatorKindEnum = pgEnum('elevator_kind', values(ElevatorKind));
export const parkingSituationEnum = pgEnum('parking_situation', values(ParkingSituation));
export const craneNeedEnum = pgEnum('crane_need', values(CraneNeed));
export const itemCategoryEnum = pgEnum('item_category', values(ItemCategory));
export const vehicleClassEnum = pgEnum('vehicle_class', values(VehicleClassId));
export const driverStatusEnum = pgEnum('driver_status', values(DriverStatus));
export const documentKindEnum = pgEnum('document_kind', values(DocumentKind));
export const documentStatusEnum = pgEnum('document_status', values(DocumentStatus));
export const offerStatusEnum = pgEnum('offer_status', values(OfferStatus));
export const adjustmentReasonEnum = pgEnum('adjustment_reason', values(AdjustmentReason));
export const adjustmentStatusEnum = pgEnum('adjustment_status', values(AdjustmentStatus));
export const ledgerAccountEnum = pgEnum('ledger_account', values(LedgerAccount));
export const ledgerEventKindEnum = pgEnum('ledger_event_kind', values(LedgerEventKind));
export const proofPhotoKindEnum = pgEnum('proof_photo_kind', values(ProofPhotoKind));

export const localeEnum = pgEnum('locale', ['he', 'en']);
export const userRoleEnum = pgEnum('user_role', ['customer', 'driver', 'ops', 'admin']);
export const payoutBatchStatusEnum = pgEnum('payout_batch_status', [
  'draft',
  'exported',
  'submitted',
  'settled',
  'partially_failed',
]);
export const payoutLineStatusEnum = pgEnum('payout_line_status', [
  'pending',
  'paid',
  'failed',
  'withheld',
]);
export const disputeStatusEnum = pgEnum('dispute_status', [
  'open',
  'investigating',
  'resolved_refund',
  'resolved_rejected',
  'resolved_goodwill',
]);
export const authorizationStatusEnum = pgEnum('authorization_status', [
  'active',
  'captured',
  'partially_captured',
  'voided',
  'expired',
  'declined',
]);
