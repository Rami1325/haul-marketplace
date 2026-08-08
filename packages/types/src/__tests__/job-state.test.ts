import { describe, expect, it } from 'vitest';
import {
  Actor,
  JobEvent,
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
} from '../job-state.js';

/** A context where every guard passes, so tests opt *out* of readiness explicitly. */
function readyContext(actor: Actor, overrides: Record<string, unknown> = {}) {
  return defaultTransitionContext({
    actor,
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
      [JobState.Quoted, JobEvent.Book, Actor.Customer, JobState.Matching],
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
    expect(moneyEffectFor(JobState.Quoted, JobEvent.Book)).toBe(MoneyEffect.Authorize);
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

  it('authorizes on exactly one edge', () => {
    const authorizations = TRANSITIONS.filter((t) => t.money === MoneyEffect.Authorize);
    expect(authorizations).toHaveLength(1);
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

describe('guards', () => {
  it('will not dispatch without an authorized card', () => {
    const result = attemptTransition(
      JobState.Quoted,
      JobEvent.Book,
      readyContext(Actor.Customer, { paymentAuthorized: false }),
    );
    expect(result).toMatchObject({ ok: false, code: TransitionErrorCode.GuardFailed });
  });

  it('will not book an expired quote', () => {
    const result = attemptTransition(
      JobState.Quoted,
      JobEvent.Book,
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
      const result = attemptTransition(state, JobEvent.Book, readyContext(Actor.Ops));
      expect(result).toMatchObject({ ok: false, code: TransitionErrorCode.AlreadyTerminal });
    }
  });

  it('cannot re-book a job that is already matching', () => {
    const result = attemptTransition(
      JobState.Matching,
      JobEvent.Book,
      readyContext(Actor.Customer),
    );
    expect(result).toMatchObject({ ok: false, code: TransitionErrorCode.NoSuchTransition });
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

  it('lets ops act on every non-terminal state', () => {
    // The plan is explicit that in the first six months a human saves more jobs
    // than the algorithm does. A state ops cannot touch is a state where they
    // end up in the database instead.
    for (const state of Object.values(JobState)) {
      if (isTerminal(state)) continue;
      expect(availableEvents(state, Actor.Ops).length, `ops are locked out of ${state}`)
        .toBeGreaterThan(0);
    }
  });
});
