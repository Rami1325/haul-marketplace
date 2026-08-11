import { describe, expect, it } from 'vitest';
import {
  Actor,
  JobEvent,
  JobEventSchema,
  JobState,
  MoneyEffect,
  TRANSITIONS,
  TransitionErrorCode,
  attemptTransition,
  availableEvents,
  defaultTransitionContext,
  isTerminal,
  moneyEffectFor,
  transitionsFrom,
  type Transition,
} from '../job-state.js';

/**
 * Every simple (non-repeating) path through the machine from a starting state.
 * The graph is small and acyclic in practice, so full enumeration is cheap and
 * lets structural money invariants be checked over routes rather than edges.
 */
function allSimplePathsFrom(start: JobState): Transition[][] {
  const paths: Transition[][] = [];

  const walk = (state: JobState, visited: Set<JobState>, soFar: Transition[]) => {
    const outgoing = transitionsFrom(state);
    if (outgoing.length === 0) {
      if (soFar.length > 0) paths.push([...soFar]);
      return;
    }
    let advanced = false;
    for (const transition of outgoing) {
      if (visited.has(transition.to)) continue;
      advanced = true;
      visited.add(transition.to);
      soFar.push(transition);
      walk(transition.to, visited, soFar);
      soFar.pop();
      visited.delete(transition.to);
    }
    if (!advanced && soFar.length > 0) paths.push([...soFar]);
  };

  walk(start, new Set([start]), []);
  return paths;
}

function describePath(path: Transition[]): string {
  return [path[0]?.from, ...path.map((t) => t.to)].join(' → ');
}

/** A context where every guard passes, so tests opt *out* of readiness explicitly. */
function readyContext(actor: Actor, overrides: Record<string, unknown> = {}) {
  return defaultTransitionContext({
    actor,
    paymentMethodSecured: true,
    paymentAuthorized: true,
    hasLoadProof: true,
    hasUnloadProof: true,
    customerConfirmed: true,
    driverWithinPickupGeofence: true,
    driverWithinDropoffGeofence: true,
    hasUnapprovedAdjustment: false,
    settlementDue: true,
    ...overrides,
  });
}

describe('the happy path', () => {
  it('walks quoted → settled', () => {
    const steps: Array<[JobState, JobEvent, Actor, JobState]> = [
      [JobState.Quoted, JobEvent.BookNow, Actor.Customer, JobState.Matching],
      [JobState.Matching, JobEvent.DriverAccept, Actor.Driver, JobState.Accepted],
      [JobState.Accepted, JobEvent.StartTrip, Actor.Driver, JobState.EnRoute],
      [JobState.EnRoute, JobEvent.ArriveAtPickup, Actor.Driver, JobState.Loading],
      [JobState.Loading, JobEvent.ConfirmLoaded, Actor.Driver, JobState.Driving],
      [JobState.Driving, JobEvent.ArriveAtDropoff, Actor.Driver, JobState.Unloading],
      [JobState.Unloading, JobEvent.Complete, Actor.Driver, JobState.Completed],
      [JobState.Completed, JobEvent.Settle, Actor.System, JobState.Settled],
    ];

    for (const [from, event, actor, expected] of steps) {
      const result = attemptTransition(from, event, readyContext(actor));
      expect(result, `${from} --${event}--> ${expected}`).toMatchObject({ ok: true, to: expected });
    }
  });
});

describe('money moves at exactly three points', () => {
  it('authorizes at booking', () => {
    expect(moneyEffectFor(JobState.Quoted, JobEvent.BookNow)).toBe(MoneyEffect.Authorize);
  });

  it('captures at completion', () => {
    expect(moneyEffectFor(JobState.Unloading, JobEvent.Complete)).toBe(MoneyEffect.Capture);
  });

  it('pays out at settlement', () => {
    expect(moneyEffectFor(JobState.Completed, JobEvent.Settle)).toBe(MoneyEffect.Payout);
  });

  it('captures the full amount on exactly one edge in the entire machine', () => {
    // If a second Capture edge ever appears, a job can be charged twice.
    const captures = TRANSITIONS.filter((t) => t.money === MoneyEffect.Capture);
    expect(captures).toHaveLength(1);
  });

  it('authorizes at most once along any single route through the machine', () => {
    // There are two Authorize edges — one for on-demand bookings, one for the
    // deferred hold on scheduled jobs — but they sit on mutually exclusive
    // paths. Counting edges would be the wrong check; what actually matters is
    // that no job can ever be held twice. So walk every simple path and count.
    const authorizeEdges = TRANSITIONS.filter((t) => t.money === MoneyEffect.Authorize);
    expect(authorizeEdges.length).toBeGreaterThan(1);

    for (const path of allSimplePathsFrom(JobState.Quoted)) {
      const authorizations = path.filter((t) => t.money === MoneyEffect.Authorize);
      expect(
        authorizations.length,
        `path ${describePath(path)} authorizes ${authorizations.length} times`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('captures at most once along any single route through the machine', () => {
    for (const path of allSimplePathsFrom(JobState.Quoted)) {
      const captures = path.filter(
        (t) => t.money === MoneyEffect.Capture || t.money === MoneyEffect.CaptureCancellationFee,
      );
      expect(
        captures.length,
        `path ${describePath(path)} takes the customer's money ${captures.length} times`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('never captures without having authorized first', () => {
    for (const path of allSimplePathsFrom(JobState.Quoted)) {
      let authorized = false;
      for (const step of path) {
        if (step.money === MoneyEffect.Authorize) authorized = true;
        if (
          step.money === MoneyEffect.Capture ||
          step.money === MoneyEffect.CaptureCancellationFee
        ) {
          expect(authorized, `path ${describePath(path)} captures before authorizing`).toBe(true);
        }
      }
    }
  });

  it('defers the hold on a scheduled booking and places it when dispatch opens', () => {
    expect(moneyEffectFor(JobState.Quoted, JobEvent.BookScheduled)).toBeNull();
    expect(moneyEffectFor(JobState.Scheduled, JobEvent.OpenDispatch)).toBe(MoneyEffect.Authorize);
  });

  it('releases the hold in full whenever no driver ever committed', () => {
    expect(moneyEffectFor(JobState.Matching, JobEvent.MatchTimeout)).toBe(MoneyEffect.Release);
    expect(moneyEffectFor(JobState.Matching, JobEvent.CancelBeforeMatch)).toBe(MoneyEffect.Release);
  });

  it('charges a fee only once a driver has committed', () => {
    expect(moneyEffectFor(JobState.Accepted, JobEvent.CancelAfterMatch)).toBe(
      MoneyEffect.CaptureCancellationFee,
    );
    expect(moneyEffectFor(JobState.EnRoute, JobEvent.CancelAfterMatch)).toBe(
      MoneyEffect.CaptureCancellationFee,
    );
  });
});

describe('the scheduled path', () => {
  it('walks quoted → scheduled → matching', () => {
    const booked = attemptTransition(
      JobState.Quoted,
      JobEvent.BookScheduled,
      readyContext(Actor.Customer, { paymentAuthorized: false }),
    );
    expect(booked).toMatchObject({ ok: true, to: JobState.Scheduled, money: null });

    const opened = attemptTransition(
      JobState.Scheduled,
      JobEvent.OpenDispatch,
      readyContext(Actor.System),
    );
    expect(opened).toMatchObject({ ok: true, to: JobState.Matching });
  });

  it('books a future job on a tokenised card with no hold placed', () => {
    // The whole point of the deferred hold: a validated card is enough to book.
    const result = attemptTransition(
      JobState.Quoted,
      JobEvent.BookScheduled,
      readyContext(Actor.Customer, { paymentAuthorized: false }),
    );
    expect(result).toMatchObject({ ok: true });
  });

  it('still refuses to book without a card on file', () => {
    const result = attemptTransition(
      JobState.Quoted,
      JobEvent.BookScheduled,
      readyContext(Actor.Customer, { paymentMethodSecured: false, paymentAuthorized: false }),
    );
    expect(result).toMatchObject({ ok: false, code: TransitionErrorCode.GuardFailed });
    if (!result.ok) expect(result.reason).toMatch(/card/);
  });

  it('will not open dispatch until the hold is actually placed', () => {
    // A failure here happens 24 hours out, which is the entire point — it
    // leaves a day to reach the customer instead of surfacing on the doorstep.
    const result = attemptTransition(
      JobState.Scheduled,
      JobEvent.OpenDispatch,
      readyContext(Actor.System, { paymentAuthorized: false }),
    );
    expect(result).toMatchObject({ ok: false, code: TransitionErrorCode.GuardFailed });
  });

  it('cancels a scheduled job for free', () => {
    const result = attemptTransition(
      JobState.Scheduled,
      JobEvent.CancelBeforeMatch,
      readyContext(Actor.Customer),
    );
    expect(result).toMatchObject({ ok: true, to: JobState.Cancelled, money: MoneyEffect.Release });
  });

  it('does not let a customer skip the hold by booking a scheduled job for now', () => {
    // BookScheduled must not be a back door into Matching without a hold.
    const result = attemptTransition(
      JobState.Quoted,
      JobEvent.BookScheduled,
      readyContext(Actor.Customer, { paymentAuthorized: false }),
    );
    expect(result).toMatchObject({ ok: true, to: JobState.Scheduled });
    expect(result.ok && result.to).not.toBe(JobState.Matching);
  });
});

describe('guards', () => {
  it('will not dispatch without an authorized card', () => {
    const result = attemptTransition(
      JobState.Quoted,
      JobEvent.BookNow,
      readyContext(Actor.Customer, { paymentAuthorized: false }),
    );
    expect(result).toMatchObject({ ok: false, code: TransitionErrorCode.GuardFailed });
  });

  it('will not book an expired quote', () => {
    const result = attemptTransition(
      JobState.Quoted,
      JobEvent.BookNow,
      readyContext(Actor.Customer, {
        now: new Date('2026-01-02T00:00:00Z'),
        quoteExpiresAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    expect(result).toMatchObject({ ok: false, code: TransitionErrorCode.GuardFailed });
    if (!result.ok) expect(result.reason).toMatch(/expired/);
  });

  it('will not advance past loading without load photos', () => {
    const result = attemptTransition(
      JobState.Loading,
      JobEvent.ConfirmLoaded,
      readyContext(Actor.Driver, { hasLoadProof: false }),
    );
    expect(result).toMatchObject({ ok: false, code: TransitionErrorCode.GuardFailed });
    if (!result.ok) expect(result.reason).toMatch(/load photos/);
  });

  it('will not complete without unload photos', () => {
    const result = attemptTransition(
      JobState.Unloading,
      JobEvent.Complete,
      readyContext(Actor.Driver, { hasUnloadProof: false }),
    );
    expect(result).toMatchObject({ ok: false });
  });

  it('will not complete without customer confirmation', () => {
    const result = attemptTransition(
      JobState.Unloading,
      JobEvent.Complete,
      readyContext(Actor.Driver, { customerConfirmed: false }),
    );
    expect(result).toMatchObject({ ok: false });
  });

  it('will not capture while an adjustment is awaiting the customer', () => {
    // The price lock's load-bearing guard: we never capture an amount the
    // customer has not seen and agreed to.
    const result = attemptTransition(
      JobState.Unloading,
      JobEvent.Complete,
      readyContext(Actor.Driver, { hasUnapprovedAdjustment: true }),
    );
    expect(result).toMatchObject({ ok: false, code: TransitionErrorCode.GuardFailed });
    if (!result.ok) expect(result.reason).toMatch(/awaiting customer approval/);
  });

  it('will not mark arrival from outside the geofence', () => {
    const result = attemptTransition(
      JobState.EnRoute,
      JobEvent.ArriveAtPickup,
      readyContext(Actor.Driver, { driverWithinPickupGeofence: false }),
    );
    expect(result).toMatchObject({ ok: false });
  });

  it('lets ops override the geofence, because GPS fails in stairwells', () => {
    const result = attemptTransition(
      JobState.EnRoute,
      JobEvent.ArriveAtPickup,
      readyContext(Actor.Ops, { driverWithinPickupGeofence: false }),
    );
    expect(result).toMatchObject({ ok: true, to: JobState.Loading });
  });

  it('will not pay out before the hold period elapses', () => {
    const result = attemptTransition(
      JobState.Completed,
      JobEvent.Settle,
      readyContext(Actor.System, { settlementDue: false }),
    );
    expect(result).toMatchObject({ ok: false });
  });
});

describe('actor permissions', () => {
  it('a customer cannot accept a job on a driver’s behalf', () => {
    const result = attemptTransition(
      JobState.Matching,
      JobEvent.DriverAccept,
      readyContext(Actor.Customer),
    );
    expect(result).toMatchObject({ ok: false, code: TransitionErrorCode.ActorNotPermitted });
  });

  it('a driver cannot cancel the customer’s job', () => {
    const result = attemptTransition(
      JobState.Accepted,
      JobEvent.CancelAfterMatch,
      readyContext(Actor.Driver),
    );
    expect(result).toMatchObject({ ok: false, code: TransitionErrorCode.ActorNotPermitted });
  });

  it('only ops can abort a job that is already in progress', () => {
    for (const state of [JobState.Loading, JobState.Driving, JobState.Unloading] as const) {
      expect(
        attemptTransition(state, JobEvent.AbortInProgress, readyContext(Actor.Driver)),
      ).toMatchObject({ ok: false });
      expect(
        attemptTransition(state, JobEvent.AbortInProgress, readyContext(Actor.Ops)),
      ).toMatchObject({ ok: true, to: JobState.Cancelled, money: MoneyEffect.ManualSettlement });
    }
  });

  it('a customer cannot cancel for free once a driver has committed', () => {
    // CancelBeforeMatch does not exist as an edge out of Accepted, so the only
    // way out is the fee-bearing one. This is a structural guarantee, not a
    // check somewhere in a service.
    const result = attemptTransition(
      JobState.Accepted,
      JobEvent.CancelBeforeMatch,
      readyContext(Actor.Customer),
    );
    expect(result).toMatchObject({ ok: false, code: TransitionErrorCode.NoSuchTransition });
  });
});

describe('illegal transitions', () => {
  it('cannot skip loading and go straight to completed', () => {
    const result = attemptTransition(
      JobState.EnRoute,
      JobEvent.Complete,
      readyContext(Actor.Driver),
    );
    expect(result).toMatchObject({ ok: false, code: TransitionErrorCode.NoSuchTransition });
  });

  it('cannot move a terminal job', () => {
    for (const state of [
      JobState.Settled,
      JobState.Cancelled,
      JobState.NoMatch,
      JobState.Expired,
    ] as const) {
      const result = attemptTransition(state, JobEvent.BookNow, readyContext(Actor.Ops));
      expect(result).toMatchObject({ ok: false, code: TransitionErrorCode.AlreadyTerminal });
    }
  });

  it('cannot re-book a job that is already matching', () => {
    const result = attemptTransition(
      JobState.Matching,
      JobEvent.BookNow,
      readyContext(Actor.Customer),
    );
    expect(result).toMatchObject({ ok: false, code: TransitionErrorCode.NoSuchTransition });
  });
});

describe('parsing an event off the wire', () => {
  it('drives a real transition without a cast', () => {
    // The reason the schema exists: a server action reads an event name from a
    // request body and hands it straight to the machine.
    const event = JobEventSchema.parse('book_now');
    expect(attemptTransition(JobState.Quoted, event, readyContext(Actor.Customer))).toMatchObject({
      ok: true,
      to: JobState.Matching,
    });
  });

  it('refuses a name nobody defined', () => {
    // Without this, an unknown string reaches the machine as a JobEvent and
    // comes back as "no such transition" — a validation error wearing a state
    // machine's error message.
    for (const bogus of ['', 'BOOK_NOW', 'book now', 'cancel', 'settle_now']) {
      expect(JobEventSchema.safeParse(bogus).success, bogus).toBe(false);
    }
  });
});

describe('structural invariants of the table', () => {
  it('resolves (from, event, actor) to exactly one transition', () => {
    // attemptTransition takes the first permitted match. If a triple ever
    // resolved to two rows, the machine would be silently non-deterministic.
    const seen = new Set<string>();
    for (const t of TRANSITIONS) {
      for (const actor of t.actors) {
        const key = `${t.from}|${t.event}|${actor}`;
        expect(seen.has(key), `duplicate transition for ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('gives every non-terminal state a way out', () => {
    for (const state of Object.values(JobState)) {
      if (isTerminal(state)) continue;
      expect(transitionsFrom(state).length, `${state} is a dead end`).toBeGreaterThan(0);
    }
  });

  it('gives every terminal state no way out', () => {
    for (const state of Object.values(JobState)) {
      if (!isTerminal(state)) continue;
      expect(transitionsFrom(state)).toHaveLength(0);
    }
  });

  it('makes every state reachable from quoted', () => {
    const reached = new Set<JobState>([JobState.Quoted]);
    const queue: JobState[] = [JobState.Quoted];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const t of transitionsFrom(current)) {
        if (!reached.has(t.to)) {
          reached.add(t.to);
          queue.push(t.to);
        }
      }
    }
    for (const state of Object.values(JobState)) {
      expect(reached.has(state), `${state} is unreachable`).toBe(true);
    }
  });

  it('exposes every event it defines to the parser', () => {
    // An event the machine fires but the schema rejects is a server action that
    // cannot be reached at all; the reverse is a name nothing will ever accept.
    expect([...JobEventSchema.options].sort()).toEqual(Object.values(JobEvent).sort());
    for (const transition of TRANSITIONS) {
      expect(JobEventSchema.safeParse(transition.event).success, transition.event).toBe(true);
    }
  });

  it('lets ops act on every non-terminal state', () => {
    // The plan is explicit that in the first six months a human saves more jobs
    // than the algorithm does. A state ops cannot touch is a state where they
    // end up in the database instead.
    for (const state of Object.values(JobState)) {
      if (isTerminal(state)) continue;
      expect(
        availableEvents(state, Actor.Ops).length,
        `ops are locked out of ${state}`,
      ).toBeGreaterThan(0);
    }
  });
});
