import { describe, expect, it } from 'vitest';
import { newBookingDraft } from '../draft.js';
import {
  BOOKING_STEPS,
  BookingStep,
  DRAFT_STEPS,
  STEP_OWNING_PROBLEM,
  canEnterStep,
  isBookingStep,
  isDraftStep,
  resumeStep,
  stepNumber,
  stepOwning,
  type DraftStep,
} from '../steps.js';
import { DraftProblemCode, draftProblems, type DraftProblem } from '../to-quote-input.js';
import { CARD, CITY, DROPOFF_STOP, PICKUP_STOP, completeDraft } from './fixtures.js';

/**
 * ---------------------------------------------------------------------------
 * The funnel
 * ---------------------------------------------------------------------------
 * Two halves, and the second is the one that matters.
 *
 * The first checks the ordering and the guard in isolation, from hand-built
 * problem lists. Cheap, and it proves the arithmetic.
 *
 * The second runs real drafts through `draftProblems` — the function the server
 * refuses to price with — and asserts where each one lands. That is the only
 * thing that can catch the failure this model exists to prevent: a problem code
 * mapped to a screen that cannot clear it. A map to `Truck` for a missing floor
 * is a perfectly valid `Record`, compiles, passes every unit test above, and
 * puts the customer in a loop between two screens with the same complaint.
 * ---------------------------------------------------------------------------
 */

function problem(code: DraftProblemCode): DraftProblem {
  return { code, path: 'test', message: 'test' };
}

describe('the step list', () => {
  it('is the eleven steps of plan §05, in order', () => {
    expect(BOOKING_STEPS).toHaveLength(11);
    expect(new Set(BOOKING_STEPS).size).toBe(11);
    expect(BOOKING_STEPS[0]).toBe(BookingStep.Items);
    expect(BOOKING_STEPS.at(-1)).toBe(BookingStep.Done);
  });

  it('has the draft steps as its first eight, structurally', () => {
    expect(DRAFT_STEPS).toHaveLength(8);
    expect(BOOKING_STEPS.slice(0, DRAFT_STEPS.length)).toEqual([...DRAFT_STEPS]);
  });

  it('numbers steps the way the plan and the customer both count', () => {
    expect(stepNumber(BookingStep.Items)).toBe(1);
    expect(stepNumber(BookingStep.Price)).toBe(7);
    expect(stepNumber(BookingStep.Done)).toBe(11);
  });

  it('recognises its own steps and nothing else', () => {
    expect(isBookingStep('items')).toBe(true);
    expect(isBookingStep('matching')).toBe(true);
    expect(isBookingStep('checkout')).toBe(false);
    expect(isBookingStep(undefined)).toBe(false);

    // The three job-keyed steps are real steps and are not draft steps. A URL
    // matcher that accepted `matching` would route to a page with no draft.
    expect(isDraftStep('pay')).toBe(true);
    expect(isDraftStep('matching')).toBe(false);
  });
});

describe('every problem has a screen that can fix it', () => {
  it('assigns every problem code to a draft step', () => {
    for (const code of Object.values(DraftProblemCode)) {
      const step = STEP_OWNING_PROBLEM[code];
      expect(step, `${code} has no owning step`).toBeDefined();
      // The `Record` type demands a `DraftStep` at compile time. This says the
      // value is one at run time too, which is the half a cast could hide.
      expect(isDraftStep(step), `${code} is owned by ${step}, which is not a draft step`).toBe(
        true,
      );
    }
  });

  it('covers the codes and no more', () => {
    expect(Object.keys(STEP_OWNING_PROBLEM).sort()).toEqual(Object.values(DraftProblemCode).sort());
  });
});

describe('resumeStep', () => {
  it('sends a customer to the earliest outstanding problem, not the first listed', () => {
    // `draftProblems` emits in assembly order, which is not step order — the
    // schedule is checked before the truck. Taking `problems[0]` would send a
    // customer with both to the later screen and strand them there.
    const problems = [
      problem(DraftProblemCode.UnknownProtectionTier),
      problem(DraftProblemCode.MissingAccess),
      problem(DraftProblemCode.MissingAddress),
    ];
    expect(resumeStep(problems)).toBe(BookingStep.Addresses);
    expect(resumeStep([...problems].reverse())).toBe(BookingStep.Addresses);
  });

  it('sends a complete draft to the price, and only past it once a price is locked', () => {
    // Not `Pay`. A customer must read the locked number before authorising it,
    // and the quote row is the evidence that they were shown one.
    expect(resumeStep([])).toBe(BookingStep.Price);
    expect(resumeStep([], { hasQuote: false })).toBe(BookingStep.Price);
    expect(resumeStep([], { hasQuote: true })).toBe(BookingStep.Pay);
  });

  it('treats a problem code it does not recognise as a problem on step 01', () => {
    // An older client, or a newer one, posting a code this build has no entry
    // for. Ignoring it would let an unknown problem read as no problem — the
    // one outcome the total `Record` exists to prevent.
    const unknown = { code: 'invented_code' as DraftProblemCode, path: 'x', message: 'x' };
    expect(resumeStep([unknown])).toBe(BookingStep.Items);
    expect(resumeStep([unknown, problem(DraftProblemCode.MissingAccess)])).toBe(BookingStep.Items);
  });
});

describe('canEnterStep', () => {
  const problems = [problem(DraftProblemCode.MissingSchedule)];

  it('lets a customer back to any step they have already answered', () => {
    // The back button is the step navigator in an eleven-URL flow. An earlier
    // screen shows nothing the customer has not already told us.
    for (const step of [BookingStep.Items, BookingStep.Addresses, BookingStep.When] as const) {
      expect(canEnterStep(step, problems)).toBe(true);
    }
  });

  it('refuses the steps past the first unanswered question', () => {
    for (const step of [BookingStep.Truck, BookingStep.Price, BookingStep.Pay] as const) {
      expect(canEnterStep(step, problems)).toBe(false);
    }
  });

  it('opens the payment step only once a price is locked', () => {
    expect(canEnterStep(BookingStep.Pay, [])).toBe(false);
    expect(canEnterStep(BookingStep.Pay, [], { hasQuote: true })).toBe(true);
  });
});

/**
 * The half that matters: real drafts, through the real conversion.
 */
describe('against the problems draftProblems actually emits', () => {
  const resumeFor = (draft: Parameters<typeof draftProblems>[0]): DraftStep =>
    resumeStep(draftProblems(draft, CITY, CARD));

  it('starts an empty draft on step 01', () => {
    // An empty draft is missing something on nearly every screen. The customer
    // has to be sent to the first of them.
    expect(resumeFor(newBookingDraft(CITY.id))).toBe(BookingStep.Items);
  });

  it('sends a fully answered draft to the price', () => {
    expect(draftProblems(completeDraft(), CITY, CARD)).toEqual([]);
    expect(resumeFor(completeDraft())).toBe(BookingStep.Price);
  });

  it('sends a draft with no chosen slot to the calendar', () => {
    expect(resumeFor(completeDraft({ at: null }))).toBe(BookingStep.When);
    expect(resumeFor(completeDraft({ scheduleKind: null }))).toBe(BookingStep.When);
  });

  it('sends a draft with no routed distance back to the addresses', () => {
    // The route is written server-side when a stop resolves, so this means the
    // addresses are answered and the routing behind them is not. The address
    // screen is where re-confirming a stop re-runs it.
    expect(resumeFor(completeDraft({ routedDistanceMeters: null }))).toBe(BookingStep.Addresses);
  });

  it('sends an empty basket to the picker and a refused item to the list', () => {
    expect(resumeFor(completeDraft({ basket: [] }))).toBe(BookingStep.Items);
    expect(
      resumeFor(
        completeDraft({
          basket: [{ catalogItemId: 'other', quantity: 1, customLabel: 'בלון גז' }],
        }),
      ),
    ).toBe(BookingStep.Basket);
  });

  it('sends a truck that cannot carry the load to the truck step', () => {
    // Chosen down, not up: a pickup priced for a van's worth of furniture. The
    // customer picked this off a screen of real dimensions, so the screen that
    // offered it is the one that has to take it back.
    expect(resumeFor(completeDraft({ vehicleClassId: 'pickup' }))).toBe(BookingStep.Truck);
  });

  it('sends a protection tier this card does not sell to the price step', () => {
    expect(resumeFor(completeDraft({ protectionTierId: 'platinum_invented' }))).toBe(
      BookingStep.Price,
    );
  });

  it('restarts a draft priced against the wrong city', () => {
    // Not fixable on any screen. The honest recovery is to start again, and
    // step 01 is where starting again begins.
    expect(resumeFor(completeDraft({ cityId: 'haifa' }))).toBe(BookingStep.Items);
  });

  it('sends unanswered access details to the access step, behind the addresses', () => {
    const noAccess = completeDraft({
      stops: [
        {
          kind: 'pickup',
          address: {
            street: 'דיזנגוף',
            houseNumber: '100',
            city: 'תל אביב-יפו',
            coordinates: { lat: 32.0785, lng: 34.7742 },
          },
          access: {},
        },
        {
          kind: 'dropoff',
          address: {
            street: 'רוטשילד',
            houseNumber: '22',
            city: 'תל אביב-יפו',
            coordinates: { lat: 32.0641, lng: 34.7748 },
          },
          access: { floor: 0, elevator: 'none', parking: 'street_easy' },
        },
      ],
    });
    expect(resumeFor(noAccess)).toBe(BookingStep.Access);
  });

  it('sends a move with only one end of it to the addresses', () => {
    // `missing_pickup` and `missing_dropoff` are emitted by no other case in
    // this file, because `newBookingDraft` seeds both stops and every fixture
    // keeps them. Without these two the mapping for both codes is unasserted —
    // and an unasserted mapping is one a refactor may quietly change.
    expect(resumeFor(completeDraft({ stops: [DROPOFF_STOP] }))).toBe(BookingStep.Addresses);
    expect(resumeFor(completeDraft({ stops: [PICKUP_STOP] }))).toBe(BookingStep.Addresses);
  });

  it('sends a stop with answered access and no address to the addresses', () => {
    // `missing_address` alone, with the access questions all answered — the
    // pair that could plausibly have been mapped to the same screen and must
    // not be, because one is fixed on step 03 and the other on step 04.
    const noAddress = completeDraft({
      stops: [
        {
          kind: 'pickup',
          address: {},
          access: { floor: 3, elevator: 'none', parking: 'street_hard' },
        },
        DROPOFF_STOP,
      ],
    });
    expect(resumeFor(noAddress)).toBe(BookingStep.Addresses);
  });

  it('sends a load nothing in the fleet can carry back to the basket', () => {
    // Not the truck step: no screen offers a vehicle we do not own, so sending
    // the customer there would be sending them somewhere with nothing to press.
    // The load is what has to change.
    const tooMuch = completeDraft({ basket: [{ catalogItemId: 'fridge_large', quantity: 999 }] });
    expect(draftProblems(tooMuch, CITY, CARD).map((problem) => problem.code)).toContain(
      DraftProblemCode.NoVehicleClassFits,
    );
    expect(resumeFor(tooMuch)).toBe(BookingStep.Basket);
  });

  it('sends a promo the server resolved to a different code to the price step', () => {
    // The one code that needs server context to appear at all: the customer
    // typed one thing and the server resolved another, which is a disagreement
    // about money and belongs on the screen where money is shown.
    const problems = draftProblems(completeDraft({ promoCode: 'FIRSTMOVE' }), CITY, CARD, {
      promo: { code: 'SOMETHINGELSE', percentOffBps: 1000 as never },
    });
    expect(problems.map((problem) => problem.code)).toContain(DraftProblemCode.PromoMismatch);
    expect(resumeStep(problems)).toBe(BookingStep.Price);
  });

  it('agrees with itself: the resume step owns one of the outstanding problems', () => {
    // The property behind every case above. Whatever a draft is missing, the
    // step it lands on is a step that can clear something — never a screen with
    // nothing on it for the problem that sent the customer there.
    const drafts = [
      newBookingDraft(CITY.id),
      completeDraft({ at: null }),
      completeDraft({ routedDistanceMeters: null }),
      completeDraft({ basket: [] }),
      completeDraft({ vehicleClassId: 'pickup' }),
      completeDraft({ protectionTierId: 'platinum_invented' }),
    ];

    for (const draft of drafts) {
      const problems = draftProblems(draft, CITY, CARD);
      const step = resumeStep(problems);
      expect(
        problems.some((p) => stepOwning(p.code) === step),
        step,
      ).toBe(true);
    }
  });
});
