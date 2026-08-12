import { DraftProblemCode, type DraftProblem } from './to-quote-input.js';

/**
 * ---------------------------------------------------------------------------
 * The booking funnel — one ordering, one vocabulary
 * ---------------------------------------------------------------------------
 * Plan §05 is eleven steps and plan §11 wants abandonment measured against
 * them, which makes the step list two things at once: the order a customer
 * moves through, and the buckets a funnel is grouped by. Those have to be the
 * same list or the metric is measuring a different product from the one being
 * navigated.
 *
 * It lives here rather than in `apps/web` for the reason `@haul/contracts`
 * exists at all: `apps/mobile` walks the same funnel with completely different
 * navigation, and a second set of step names is a second funnel — two charts
 * that cannot be added together and no way to tell which one is short. The web
 * app owns the *URLs* (`apps/web/src/booking/paths.ts`); this owns what a step
 * **is**.
 *
 * WHAT MAKES A STEP DONE IS NOT DECIDED HERE EITHER. `draftProblems` already
 * answers "what is still missing from this draft", and it is the same function
 * the server refuses to price with — so the step model does not re-derive
 * completeness, it only says **which step owns each problem**. A guard built on
 * its own reading of the draft would eventually disagree with the pricing path,
 * and the way that surfaces is a customer bounced back to a screen they have
 * already filled in, or waved through to a price that then refuses to lock.
 *
 * `STEP_OWNING_PROBLEM` is a total `Record`, so a new `DraftProblemCode` fails
 * to compile until someone decides which screen fixes it. That is the whole
 * mechanism: the compiler asks the question at the moment the answer is
 * obvious, rather than a guard silently treating an unknown problem as no
 * problem and sending the customer to a step that cannot clear it.
 * ---------------------------------------------------------------------------
 */

export const BookingStep = {
  /** 01 — the item grid, search, preset bundles. */
  Items: 'items',
  /** 02 — the basket, quantities, always editable. */
  Basket: 'basket',
  /** 03 — from & to, autocomplete, stops. */
  Addresses: 'addresses',
  /** 04 — floor, lift, stairs, parking, carry, crane. */
  Access: 'access',
  /** 05 — Now / Today / a date and a window. */
  When: 'when',
  /** 06 — truck size and crew, recommendation pre-selected. */
  Truck: 'truck',
  /** 07 — the locked price, its breakdown, the protection tier. */
  Price: 'price',
  /** 08 — authorize, not charge. */
  Pay: 'pay',
  /** 09 — live notified count, free cancel. Keyed by job, not by draft. */
  Matching: 'matching',
  /** 10 — the live job sheet. Keyed by job. */
  Job: 'job',
  /** 11 — receipt, photos, tip, rate, rebook. Keyed by job. */
  Done: 'done',
} as const;
export type BookingStep = (typeof BookingStep)[keyof typeof BookingStep];

/**
 * The steps a *draft* can answer — 01 through 08.
 *
 * The split from the three that follow is not cosmetic. Everything up to and
 * including Pay is a customer filling in a form we are holding for them; 09
 * onward is a job that exists, with a driver being found for it, and its
 * screens are keyed by a job id rather than by a booking cookie. A draft
 * therefore has no opinion about them, which is why `resumeStep` returns a
 * `DraftStep` and not a `BookingStep`.
 */
export const DRAFT_STEPS = [
  BookingStep.Items,
  BookingStep.Basket,
  BookingStep.Addresses,
  BookingStep.Access,
  BookingStep.When,
  BookingStep.Truck,
  BookingStep.Price,
  BookingStep.Pay,
] as const;
export type DraftStep = (typeof DRAFT_STEPS)[number];

/**
 * Every step, in the order plan §05 numbers them.
 *
 * Composed from `DRAFT_STEPS` rather than restated, so "the draft steps are the
 * first eight" is structural. Written out as a second literal list it would be
 * a fact held in two places, and the way that breaks is silent: a step inserted
 * in one order and not the other leaves `stepNumber` and the guard disagreeing
 * about which screen comes first.
 *
 * The array is also the *only* ordering. There is no `order` field on a step
 * and no sort key, for the same reason.
 */
export const BOOKING_STEPS = [
  ...DRAFT_STEPS,
  BookingStep.Matching,
  BookingStep.Job,
  BookingStep.Done,
] as const satisfies readonly BookingStep[];

export function isBookingStep(value: unknown): value is BookingStep {
  return typeof value === 'string' && (BOOKING_STEPS as readonly string[]).includes(value);
}

export function isDraftStep(value: unknown): value is DraftStep {
  return typeof value === 'string' && (DRAFT_STEPS as readonly string[]).includes(value);
}

/**
 * Where this step sits in the funnel, 1-based — `01` in the plan is `1` here.
 *
 * 1-based because the number is read by humans in two places that both count
 * from one: the plan's own §05 numbering, and the "step 3 of 8" the customer
 * sees. A 0-based index would be correct and would be wrong on both screens.
 */
export function stepNumber(step: BookingStep): number {
  return BOOKING_STEPS.indexOf(step) + 1;
}

/**
 * Which screen fixes this problem.
 *
 * Total by type. The entries that are not obvious carry their reasoning:
 *
 *   - **`CityMismatch` → Items.** Nothing a customer can fix on any screen —
 *     the draft was started against one city's rate card and is being priced
 *     against another's, which means either the launch geography moved or the
 *     draft is being replayed somewhere it does not belong. It maps to the
 *     first step because the honest recovery is to start again, and a guard
 *     that mapped it to "no step" would wave the draft through to a price that
 *     then refuses.
 *   - **`EmptyBasket` → Items, `RefusedItem` → Basket.** Different screens for
 *     what looks like one concern. Nothing selected is answered by the picker;
 *     a free-text line naming a gas cylinder is answered by the list where that
 *     line is editable.
 *   - **`NoVehicleClassFits` → Basket.** The load, not the truck. No screen in
 *     the flow offers a vehicle we do not own, so sending the customer to the
 *     truck step would be sending them somewhere with nothing to press.
 *   - **`MissingRoute` → Addresses.** The routed distance is written
 *     server-side when a stop resolves, so this code means the addresses are
 *     answered and the routing behind them is not. The customer lands on a form
 *     that looks complete, which is right: re-confirming a stop is what
 *     re-runs the route.
 */
export const STEP_OWNING_PROBLEM: Record<DraftProblemCode, DraftStep> = {
  [DraftProblemCode.CityMismatch]: BookingStep.Items,
  [DraftProblemCode.EmptyBasket]: BookingStep.Items,
  [DraftProblemCode.RefusedItem]: BookingStep.Basket,
  [DraftProblemCode.NoVehicleClassFits]: BookingStep.Basket,
  [DraftProblemCode.MissingPickup]: BookingStep.Addresses,
  [DraftProblemCode.MissingDropoff]: BookingStep.Addresses,
  [DraftProblemCode.MissingAddress]: BookingStep.Addresses,
  [DraftProblemCode.MissingRoute]: BookingStep.Addresses,
  [DraftProblemCode.MissingAccess]: BookingStep.Access,
  [DraftProblemCode.MissingSchedule]: BookingStep.When,
  [DraftProblemCode.VehicleClassTooSmall]: BookingStep.Truck,
  [DraftProblemCode.UnknownProtectionTier]: BookingStep.Price,
  [DraftProblemCode.PromoMismatch]: BookingStep.Price,
};

export function stepOwning(code: DraftProblemCode): DraftStep {
  return STEP_OWNING_PROBLEM[code];
}

/**
 * Server-side facts a draft cannot carry, and the flow's position depends on.
 *
 * `hasQuote` is the only one so far, and it is here rather than on the draft
 * for the reason every price fact is: a draft is a document the customer's
 * device writes, and a client that could assert it had locked a price could
 * walk itself onto the payment screen without one.
 */
export interface BookingProgress {
  /** True once `createQuote` has locked a price for this draft. */
  readonly hasQuote?: boolean;
}

/**
 * The step this draft belongs on — where `/book` sends someone coming back.
 *
 * The earliest step that owns an outstanding problem, and `Price` when there
 * are none. **Not `Pay`:** a draft with every answer in is a draft that can be
 * priced, and a customer must be shown the locked number before being asked to
 * authorise it. `hasQuote` is what says they have been, because locking the
 * price is an action taken *on* step 07 and the quote row is its evidence.
 *
 * A draft that has already become a job does not resume here at all — steps 09
 * onward are keyed by job id, and the caller reads `jobId` off the row before
 * asking this function anything.
 */
export function resumeStep(
  problems: readonly DraftProblem[],
  progress: BookingProgress = {},
): DraftStep {
  let earliest: DraftStep | null = null;

  for (const problem of problems) {
    const step = STEP_OWNING_PROBLEM[problem.code];
    // `undefined` is unreachable through the type, and reachable through a
    // problem list that crossed a version boundary — an older client posting a
    // code this build does not know. Ignoring it would be the one failure mode
    // the total Record exists to prevent, so it is treated as a problem on the
    // first step rather than as no problem at all.
    if (step === undefined) return BookingStep.Items;
    if (earliest === null || BOOKING_STEPS.indexOf(step) < BOOKING_STEPS.indexOf(earliest)) {
      earliest = step;
    }
  }

  if (earliest !== null) return earliest;
  return progress.hasQuote === true ? BookingStep.Pay : BookingStep.Price;
}

/**
 * Whether the customer may be on this step right now.
 *
 * Forward-only gating: anything at or before the resume step is allowed, and
 * everything past it is not. Going **back** is always permitted and that is
 * deliberate — the back button is a step navigator in an eleven-URL flow, and a
 * guard that refused it would break the browser rather than protect anything.
 * There is nothing to protect: an earlier step's screen shows answers the
 * customer already gave.
 *
 * Forward is refused because the steps past the first unanswered one cannot
 * render honestly. The price screen with no date on the draft has no price to
 * show, and the payment screen with no price is a card form attached to
 * nothing.
 */
export function canEnterStep(
  step: DraftStep,
  problems: readonly DraftProblem[],
  progress: BookingProgress = {},
): boolean {
  return BOOKING_STEPS.indexOf(step) <= BOOKING_STEPS.indexOf(resumeStep(problems, progress));
}
