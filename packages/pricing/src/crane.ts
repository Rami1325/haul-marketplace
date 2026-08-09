import {
  CraneNeed,
  ElevatorKind,
  elevatorTakesFurniture,
  type AccessDetails,
  type ManifestTotals,
} from '@haul/types';

/**
 * ---------------------------------------------------------------------------
 * The crane (מנוף)
 * ---------------------------------------------------------------------------
 * The single largest gap between this plan and the Israeli market.
 *
 * Moving apps usually model moving as "carry it down the stairs".
 * In Israel that frequently is not possible. Stairwells in older Tel Aviv,
 * Haifa and Jerusalem buildings will not pass a three-seat sofa or a double bed
 * base, and the standard answer — not an exotic one — is to hoist it over the
 * balcony with a furniture crane.
 *
 * Getting this wrong is expensive in both directions:
 *
 *   Miss a needed crane  → the crew arrives, discovers the sofa will not fit,
 *                          and the locked price is broken on the doorstep. This
 *                          is the single most likely way Price Lock fails here.
 *   Add one that is not  → several hundred shekels of quote nobody else charges,
 *                          and the booking goes elsewhere.
 *
 * So the assessment is explicit, explainable, and always overridable by the
 * customer. It returns a *reason in Hebrew* because it has to be shown, not
 * silently applied — a surprise crane line is exactly the bill-shock the whole
 * product exists to avoid.
 * ---------------------------------------------------------------------------
 */

export interface CraneAssessment {
  need: CraneNeed;
  /** Cubic metres that would go over the balcony rather than down the stairs. */
  volumeM3: number;
  reasonHe: string;
  reasonEn: string;
  /**
   * True when we cannot tell from what the customer has told us, and the answer
   * changes the price materially. The booking flow must ask rather than guess.
   */
  needsCustomerConfirmation: boolean;
}

export interface CraneRules {
  /** At or above this floor, a walk-up with big furniture implies a crane. */
  craneFromFloor: number;
  /** Below this floor, carrying is assumed feasible even if it is unpleasant. */
  neverBelowFloor: number;
}

export const DEFAULT_CRANE_RULES: CraneRules = {
  // Three floors with a wardrobe is where Israeli movers reach for the crane.
  craneFromFloor: 3,
  // One flight is carried, always. Nobody books a crane for the first floor.
  neverBelowFloor: 2,
};

export function assessCraneNeed(
  access: AccessDetails,
  totals: Pick<ManifestTotals, 'hasCraneCandidate' | 'craneCandidateVolumeM3'>,
  rules: CraneRules = DEFAULT_CRANE_RULES,
): CraneAssessment {
  const volumeM3 = totals.craneCandidateVolumeM3;

  const none = (reasonHe: string, reasonEn: string): CraneAssessment => ({
    need: CraneNeed.NotNeeded,
    volumeM3: 0,
    reasonHe,
    reasonEn,
    needsCustomerConfirmation: false,
  });

  // The customer or ops already decided. Their answer wins over our inference —
  // they have seen the staircase and we have not.
  if (access.crane === CraneNeed.Required) {
    return {
      need: CraneNeed.Required,
      volumeM3: volumeM3 > 0 ? volumeM3 : 1.8,
      reasonHe: 'נבחר על ידך',
      reasonEn: 'Selected by you',
      needsCustomerConfirmation: false,
    };
  }
  if (access.crane === CraneNeed.NotNeeded) {
    return none('סימנת שאין צורך במנוף', 'You indicated no crane is needed');
  }

  if (!totals.hasCraneCandidate || volumeM3 <= 0) {
    return none('אין פריטים גדולים שדורשים מנוף', 'Nothing in the list needs hoisting');
  }

  if (access.floor <= 0) {
    return none('קומת קרקע', 'Ground floor');
  }

  if (elevatorTakesFurniture(access.elevator)) {
    return none('יש מעלית שמתאימה לרהיטים', 'The lift takes furniture');
  }

  const recommend = (reasonHe: string, reasonEn: string, confirm: boolean): CraneAssessment => ({
    need: CraneNeed.Recommended,
    volumeM3,
    reasonHe,
    reasonEn,
    needsCustomerConfirmation: confirm,
  });

  // A stairwell the customer has told us is tight, with furniture that will not
  // pass. This is the strongest signal available and it comes straight from the
  // person who lives there.
  if (access.narrowStairwell && access.floor >= rules.neverBelowFloor) {
    return recommend(
      'חדר המדרגות צר מדי לרהיטים הגדולים',
      'The stairwell is too narrow for the large items',
      false,
    );
  }

  if (access.floor >= rules.craneFromFloor) {
    // A small lift is the trap: the customer answers "yes, there's a lift" and
    // the crew discovers it takes people and not sofas.
    const liftCaveat = access.elevator === ElevatorKind.Small ? ' (המעלית קטנה מדי לרהיטים)' : '';
    return recommend(
      `קומה ${access.floor} ללא מעלית מתאימה${liftCaveat}`,
      `Floor ${access.floor} with no suitable lift${access.elevator === ElevatorKind.Small ? ' (the lift is too small for furniture)' : ''}`,
      false,
    );
  }

  // Floor 2, ordinary stairwell, big furniture. Genuinely could go either way,
  // and the difference is several hundred shekels — so ask rather than guess.
  return recommend(
    'ייתכן שיידרש מנוף — תלוי ברוחב חדר המדרגות',
    'A crane may be needed — it depends on the stairwell width',
    true,
  );
}

/** Whether this assessment should be priced in. */
export function craneIsPriced(assessment: CraneAssessment): boolean {
  return assessment.need === CraneNeed.Required || assessment.need === CraneNeed.Recommended;
}
