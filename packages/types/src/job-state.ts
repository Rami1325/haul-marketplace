import { z } from 'zod';

/**
 * ---------------------------------------------------------------------------
 * The job state machine
 * ---------------------------------------------------------------------------
 * One machine governs the whole product. Every screen in both apps is a view
 * onto one of these states, and money moves at exactly three points on it:
 *
 *   1. AUTHORIZE  at booking      — a hold, not a charge. This is what makes
 *                                   free instant cancellation possible, and it
 *                                   doubles as the fraud filter.
 *   2. CAPTURE    at completion   — once, for the exact locked amount.
 *   3. PAYOUT     at settlement   — T+1 to the driver.
 *
 * Any mid-job change is a *separate customer-approved authorization*, never a
 * silent top-up of the original hold. If that rule ever bends, the price lock
 * is a marketing claim rather than a product.
 * ---------------------------------------------------------------------------
 */

export const JobState = {
  /** Price computed and held. Nothing charged, no driver involved. */
  Quoted: 'quoted',
  /** Quote lapsed before booking. Terminal. Re-quote required. */
  Expired: 'expired',
  /**
   * Booked for a future window, card tokenised, no hold placed yet.
   *
   * This state exists because of an Israeli payments constraint. Local PSPs
   * hold a J5 authorization for days, not weeks, but roughly seven in ten moves
   * are booked further ahead than that. So a scheduled job keeps a validated
   * card on file — which is what the fraud filter and free cancellation
   * actually depend on — and the hold is placed shortly before dispatch opens.
   */
  Scheduled: 'scheduled',
  /** Card authorized, dispatch fanning the offer out in waves. */
  Matching: 'matching',
  /** A driver took it. The job is now somebody's responsibility. */
  Accepted: 'accepted',
  /** Driver is travelling to the pickup. */
  EnRoute: 'en_route',
  /** At pickup, loading. Cannot advance without load photos. */
  Loading: 'loading',
  /** Loaded and driving to the destination. */
  Driving: 'driving',
  /** At destination, unloading. Cannot advance without unload photos. */
  Unloading: 'unloading',
  /** Work finished, customer confirmed, card captured. */
  Completed: 'completed',
  /** Driver paid out. Terminal happy path. */
  Settled: 'settled',
  /** Dispatch exhausted every wave and the human escalation. Hold released. */
  NoMatch: 'no_match',
  /** Cancelled by customer or ops. Fee depends on when. Terminal. */
  Cancelled: 'cancelled',
} as const;
export type JobState = (typeof JobState)[keyof typeof JobState];

export const JobStateSchema = z.enum([
  JobState.Quoted,
  JobState.Expired,
  JobState.Scheduled,
  JobState.Matching,
  JobState.Accepted,
  JobState.EnRoute,
  JobState.Loading,
  JobState.Driving,
  JobState.Unloading,
  JobState.Completed,
  JobState.Settled,
  JobState.NoMatch,
  JobState.Cancelled,
]);

export const TERMINAL_STATES: readonly JobState[] = [
  JobState.Settled,
  JobState.NoMatch,
  JobState.Cancelled,
  JobState.Expired,
];

export function isTerminal(state: JobState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** The happy path, in order. Drives the customer's live progress display. */
export const JOB_PROGRESS_STATES: readonly JobState[] = [
  JobState.Matching,
  JobState.Accepted,
  JobState.EnRoute,
  JobState.Loading,
  JobState.Driving,
  JobState.Unloading,
  JobState.Completed,
];

/** True once a driver is committed — the point after which cancelling costs money. */
export function hasCommittedDriver(state: JobState): boolean {
  return (
    state === JobState.Accepted ||
    state === JobState.EnRoute ||
    state === JobState.Loading ||
    state === JobState.Driving ||
    state === JobState.Unloading
  );
}

/** True once the crew is physically handling the customer's belongings. */
export function isInProgress(state: JobState): boolean {
  return state === JobState.Loading || state === JobState.Driving || state === JobState.Unloading;
}

// --- actors -----------------------------------------------------------------

export const Actor = {
  Customer: 'customer',
  Driver: 'driver',
  /** Automated: timers, geofences, webhooks, schedulers. */
  System: 'system',
  /** A human on the ops console. Can do things the other actors cannot. */
  Ops: 'ops',
} as const;
export type Actor = (typeof Actor)[keyof typeof Actor];
export const ActorSchema = z.enum([Actor.Customer, Actor.Driver, Actor.System, Actor.Ops]);

// --- events -----------------------------------------------------------------

export const JobEvent = {
  /** Book for immediate dispatch. Places the hold there and then. */
  BookNow: 'book_now',
  /** Book a future window. Tokenises the card; the hold comes later. */
  BookScheduled: 'book_scheduled',
  /** T-24h: place the hold on a scheduled job and open it to dispatch. */
  OpenDispatch: 'open_dispatch',
  ExpireQuote: 'expire_quote',
  DriverAccept: 'driver_accept',
  MatchTimeout: 'match_timeout',
  CancelBeforeMatch: 'cancel_before_match',
  CancelAfterMatch: 'cancel_after_match',
  StartTrip: 'start_trip',
  ArriveAtPickup: 'arrive_at_pickup',
  ConfirmLoaded: 'confirm_loaded',
  ArriveAtDropoff: 'arrive_at_dropoff',
  Complete: 'complete',
  Settle: 'settle',
  /** Ops pulling the emergency brake mid-job. Always manual settlement after. */
  AbortInProgress: 'abort_in_progress',
} as const;
export type JobEvent = (typeof JobEvent)[keyof typeof JobEvent];

// --- money effects ----------------------------------------------------------

export const MoneyEffect = {
  /** Place a hold for the locked amount. Nothing is charged. */
  Authorize: 'authorize',
  /** Capture the exact locked amount. Happens once. */
  Capture: 'capture',
  /** Release the hold in full. Customer pays nothing. */
  Release: 'release',
  /** Capture only the cancellation fee, release the rest. Driver is compensated. */
  CaptureCancellationFee: 'capture_cancellation_fee',
  /** Release the driver's payout. */
  Payout: 'payout',
  /** Ops must settle by hand — no automatic movement of money. */
  ManualSettlement: 'manual_settlement',
} as const;
export type MoneyEffect = (typeof MoneyEffect)[keyof typeof MoneyEffect];

// --- guards -----------------------------------------------------------------

/**
 * Everything a guard is allowed to look at. Deliberately a flat, serialisable
 * snapshot: guards must be pure so the same decision can be replayed in a test,
 * in the ops console, and in an audit six months later.
 */
export interface TransitionContext {
  readonly actor: Actor;
  readonly now: Date;

  /**
   * A real, validated card is on file — tokenised, but no hold placed. This is
   * what removes most fraud and most no-shows; the hold is a separate concern.
   */
  readonly paymentMethodSecured: boolean;
  /** Card hold successfully placed. */
  readonly paymentAuthorized: boolean;
  /** Quote's hold-until timestamp. Null when not applicable. */
  readonly quoteExpiresAt: Date | null;

  /** Proof-of-condition photos taken at the pickup. */
  readonly hasLoadProof: boolean;
  /** Proof-of-condition photos taken at the destination. */
  readonly hasUnloadProof: boolean;

  /** Customer signed or entered the PIN at handover. */
  readonly customerConfirmed: boolean;

  readonly driverWithinPickupGeofence: boolean;
  readonly driverWithinDropoffGeofence: boolean;

  /**
   * An adjustment the customer has not yet approved. Blocks completion — we
   * never capture an amount the customer hasn't agreed to.
   */
  readonly hasUnapprovedAdjustment: boolean;

  /** Payout hold period elapsed (T+1). */
  readonly settlementDue: boolean;
}

export function defaultTransitionContext(
  overrides: Partial<TransitionContext> & Pick<TransitionContext, 'actor'>,
): TransitionContext {
  return {
    now: new Date(),
    paymentMethodSecured: false,
    paymentAuthorized: false,
    quoteExpiresAt: null,
    hasLoadProof: false,
    hasUnloadProof: false,
    customerConfirmed: false,
    driverWithinPickupGeofence: false,
    driverWithinDropoffGeofence: false,
    hasUnapprovedAdjustment: false,
    settlementDue: false,
    ...overrides,
  };
}

type Guard = (ctx: TransitionContext) => string | null;

const requirePaymentAuthorized: Guard = (ctx) =>
  ctx.paymentAuthorized ? null : 'payment must be authorized before dispatch';

const requirePaymentSecured: Guard = (ctx) =>
  ctx.paymentMethodSecured ? null : 'a validated card must be on file before booking';

const requireQuoteNotExpired: Guard = (ctx) =>
  ctx.quoteExpiresAt && ctx.now > ctx.quoteExpiresAt
    ? 'quote has expired — re-quote required'
    : null;

const requireLoadProof: Guard = (ctx) =>
  ctx.hasLoadProof ? null : 'load photos are required before the job can advance';

const requireUnloadProof: Guard = (ctx) =>
  ctx.hasUnloadProof ? null : 'unload photos are required before the job can be completed';

const requireCustomerConfirmation: Guard = (ctx) =>
  ctx.customerConfirmed ? null : 'customer signature or PIN is required to complete';

const requireNoUnapprovedAdjustment: Guard = (ctx) =>
  ctx.hasUnapprovedAdjustment
    ? 'an adjustment is awaiting customer approval — cannot capture'
    : null;

const requireAtPickup: Guard = (ctx) =>
  ctx.driverWithinPickupGeofence || ctx.actor === Actor.Ops
    ? null
    : 'driver is not at the pickup location';

const requireAtDropoff: Guard = (ctx) =>
  ctx.driverWithinDropoffGeofence || ctx.actor === Actor.Ops
    ? null
    : 'driver is not at the destination';

const requireSettlementDue: Guard = (ctx) =>
  ctx.settlementDue || ctx.actor === Actor.Ops ? null : 'settlement hold period has not elapsed';

// --- the transition table ---------------------------------------------------

export interface Transition {
  readonly from: JobState;
  readonly to: JobState;
  readonly event: JobEvent;
  /** Who is permitted to fire this. Ops is added to nearly everything by design. */
  readonly actors: readonly Actor[];
  readonly guards: readonly Guard[];
  readonly money: MoneyEffect | null;
  readonly description: string;
}

export const TRANSITIONS: readonly Transition[] = [
  {
    from: JobState.Quoted,
    to: JobState.Matching,
    event: JobEvent.BookNow,
    actors: [Actor.Customer, Actor.Ops],
    guards: [requireQuoteNotExpired, requirePaymentSecured, requirePaymentAuthorized],
    money: MoneyEffect.Authorize,
    description: 'On-demand booking. Card is authorized for the locked amount, not charged.',
  },
  {
    from: JobState.Quoted,
    to: JobState.Scheduled,
    event: JobEvent.BookScheduled,
    actors: [Actor.Customer, Actor.Ops],
    guards: [requireQuoteNotExpired, requirePaymentSecured],
    money: null,
    description:
      'Future booking. Card tokenised and validated; the hold waits until dispatch opens, ' +
      'because a local J5 authorization will not survive a two-week lead time.',
  },
  {
    from: JobState.Scheduled,
    to: JobState.Matching,
    event: JobEvent.OpenDispatch,
    actors: [Actor.System, Actor.Ops],
    guards: [requirePaymentAuthorized],
    money: MoneyEffect.Authorize,
    description:
      'T-24h. Hold placed and the job opens to dispatch. A failure here leaves a day to ' +
      'reach the customer, rather than surfacing when the truck is outside.',
  },
  {
    from: JobState.Scheduled,
    to: JobState.Cancelled,
    event: JobEvent.CancelBeforeMatch,
    actors: [Actor.Customer, Actor.Ops],
    guards: [],
    // No hold exists yet, so this releases nothing. Kept as Release so the
    // ledger path is uniform and the effect stays idempotent.
    money: MoneyEffect.Release,
    description: 'Free cancellation of a scheduled job. No driver committed, no hold placed.',
  },
  {
    from: JobState.Quoted,
    to: JobState.Expired,
    event: JobEvent.ExpireQuote,
    actors: [Actor.System],
    guards: [],
    money: null,
    description: 'Quote lapsed. A locked price cannot be held indefinitely.',
  },
  {
    from: JobState.Matching,
    to: JobState.Accepted,
    event: JobEvent.DriverAccept,
    actors: [Actor.Driver, Actor.Ops],
    guards: [],
    money: null,
    description: 'First accept wins. Ops can force-assign from the console.',
  },
  {
    from: JobState.Matching,
    to: JobState.NoMatch,
    event: JobEvent.MatchTimeout,
    actors: [Actor.System, Actor.Ops],
    guards: [],
    money: MoneyEffect.Release,
    description: 'All waves and the human escalation failed. Hold released in full, ops alerted.',
  },
  {
    from: JobState.Matching,
    to: JobState.Cancelled,
    event: JobEvent.CancelBeforeMatch,
    actors: [Actor.Customer, Actor.Ops],
    guards: [],
    money: MoneyEffect.Release,
    description: 'Free cancellation — no driver has committed yet.',
  },
  {
    from: JobState.Accepted,
    to: JobState.EnRoute,
    event: JobEvent.StartTrip,
    actors: [Actor.Driver, Actor.Ops],
    guards: [],
    money: null,
    description: 'Driver sets off for the pickup.',
  },
  {
    from: JobState.Accepted,
    to: JobState.Cancelled,
    event: JobEvent.CancelAfterMatch,
    actors: [Actor.Customer, Actor.Ops],
    guards: [],
    money: MoneyEffect.CaptureCancellationFee,
    description: 'Cancelled after a driver committed. Fee applies; the driver is compensated.',
  },
  {
    from: JobState.EnRoute,
    to: JobState.Loading,
    event: JobEvent.ArriveAtPickup,
    actors: [Actor.Driver, Actor.Ops],
    guards: [requireAtPickup],
    money: null,
    description: 'Geofenced arrival at pickup. Customer is notified.',
  },
  {
    from: JobState.EnRoute,
    to: JobState.Cancelled,
    event: JobEvent.CancelAfterMatch,
    actors: [Actor.Customer, Actor.Ops],
    guards: [],
    money: MoneyEffect.CaptureCancellationFee,
    description: 'Cancelled with the driver already travelling. Fee applies.',
  },
  {
    from: JobState.Loading,
    to: JobState.Driving,
    event: JobEvent.ConfirmLoaded,
    actors: [Actor.Driver, Actor.Ops],
    guards: [requireLoadProof],
    money: null,
    description: 'Everything aboard. Load photos are a hard gate — they protect both sides.',
  },
  {
    from: JobState.Driving,
    to: JobState.Unloading,
    event: JobEvent.ArriveAtDropoff,
    actors: [Actor.Driver, Actor.Ops],
    guards: [requireAtDropoff],
    money: null,
    description: 'Geofenced arrival at the destination.',
  },
  {
    from: JobState.Unloading,
    to: JobState.Completed,
    event: JobEvent.Complete,
    actors: [Actor.Driver, Actor.Ops],
    guards: [requireUnloadProof, requireCustomerConfirmation, requireNoUnapprovedAdjustment],
    money: MoneyEffect.Capture,
    description: 'Work done and confirmed. Capture the exact locked amount, once.',
  },
  {
    from: JobState.Completed,
    to: JobState.Settled,
    event: JobEvent.Settle,
    actors: [Actor.System, Actor.Ops],
    guards: [requireSettlementDue],
    money: MoneyEffect.Payout,
    description: 'Driver payout released, T+1 or instantly for a fee.',
  },
  // Ops emergency brake. Deliberately reachable from every in-progress state and
  // deliberately never automatic — a job with the customer's sofa in the truck
  // cannot be resolved by a state machine.
  {
    from: JobState.Loading,
    to: JobState.Cancelled,
    event: JobEvent.AbortInProgress,
    actors: [Actor.Ops],
    guards: [],
    money: MoneyEffect.ManualSettlement,
    description: 'Ops aborted the job mid-load. Settled by hand.',
  },
  {
    from: JobState.Driving,
    to: JobState.Cancelled,
    event: JobEvent.AbortInProgress,
    actors: [Actor.Ops],
    guards: [],
    money: MoneyEffect.ManualSettlement,
    description: 'Ops aborted the job in transit. Settled by hand.',
  },
  {
    from: JobState.Unloading,
    to: JobState.Cancelled,
    event: JobEvent.AbortInProgress,
    actors: [Actor.Ops],
    guards: [],
    money: MoneyEffect.ManualSettlement,
    description: 'Ops aborted the job during unload. Settled by hand.',
  },
];

// --- the API ----------------------------------------------------------------

export type TransitionResult =
  | { readonly ok: true; readonly to: JobState; readonly money: MoneyEffect | null }
  | { readonly ok: false; readonly reason: string; readonly code: TransitionErrorCode };

export const TransitionErrorCode = {
  NoSuchTransition: 'no_such_transition',
  ActorNotPermitted: 'actor_not_permitted',
  GuardFailed: 'guard_failed',
  AlreadyTerminal: 'already_terminal',
} as const;
export type TransitionErrorCode = (typeof TransitionErrorCode)[keyof typeof TransitionErrorCode];

/**
 * The only sanctioned way to move a job. Returns a result rather than throwing,
 * because a rejected transition is an ordinary outcome — a driver taps accept a
 * half-second after someone else did, and that is not an exception.
 */
export function attemptTransition(
  from: JobState,
  event: JobEvent,
  ctx: TransitionContext,
): TransitionResult {
  if (isTerminal(from)) {
    return {
      ok: false,
      code: TransitionErrorCode.AlreadyTerminal,
      reason: `job is already in terminal state "${from}"`,
    };
  }

  const candidates = TRANSITIONS.filter((t) => t.from === from && t.event === event);
  if (candidates.length === 0) {
    return {
      ok: false,
      code: TransitionErrorCode.NoSuchTransition,
      reason: `no transition "${event}" from state "${from}"`,
    };
  }

  const permitted = candidates.filter((t) => t.actors.includes(ctx.actor));
  if (permitted.length === 0) {
    return {
      ok: false,
      code: TransitionErrorCode.ActorNotPermitted,
      reason: `actor "${ctx.actor}" may not fire "${event}" from "${from}"`,
    };
  }

  // A single (from, event, actor) triple must resolve to exactly one transition.
  const transition = permitted[0]!;

  for (const guard of transition.guards) {
    const failure = guard(ctx);
    if (failure !== null) {
      return { ok: false, code: TransitionErrorCode.GuardFailed, reason: failure };
    }
  }

  return { ok: true, to: transition.to, money: transition.money };
}

/** Every transition leaving a state, for building UI affordances. */
export function transitionsFrom(state: JobState): readonly Transition[] {
  return TRANSITIONS.filter((t) => t.from === state);
}

/** What this actor could do right now, ignoring guards. For rendering buttons. */
export function availableEvents(state: JobState, actor: Actor): readonly JobEvent[] {
  return TRANSITIONS.filter((t) => t.from === state && t.actors.includes(actor)).map(
    (t) => t.event,
  );
}

/** Where money moves on a given edge. Used by the ledger and by tests. */
export function moneyEffectFor(from: JobState, event: JobEvent): MoneyEffect | null {
  return TRANSITIONS.find((t) => t.from === from && t.event === event)?.money ?? null;
}
