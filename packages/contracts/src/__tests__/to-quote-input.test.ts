import { CATALOG_BY_ID, TEL_AVIV_CITY } from '@haul/config';
import { QuoteInputSchema, computeQuote } from '@haul/pricing';
import {
  CraneNeed,
  DayKind,
  ElevatorKind,
  ParkingSituation,
  StopKind,
  bps,
  shekels,
  verifyBreakdown,
} from '@haul/types';
import { describe, expect, it } from 'vitest';
import { BOOKING_DRAFT_VERSION, BookingDraftSchema, type BookingDraft } from '../draft.js';
import {
  DraftIncompleteError,
  DraftProblemCode,
  draftProblems,
  toManifest,
  toQuoteInput,
  toStops,
} from '../to-quote-input.js';
import {
  CARD,
  CITY,
  DROPOFF_STOP,
  SCHEDULED_AT,
  completeDraft,
  completeDraftInput,
  draftWithPickupAccess,
} from './fixtures.js';

const codesOf = (draft: Parameters<typeof draftProblems>[0]): string[] =>
  draftProblems(draft, CITY, CARD).map((problem) => problem.code);

describe('an incomplete draft is refused, and says what is missing', () => {
  it('names every unanswered question at once rather than one per attempt', () => {
    const empty = BookingDraftSchema.parse({ version: BOOKING_DRAFT_VERSION });
    const codes = codesOf(empty);
    expect(codes).toContain(DraftProblemCode.EmptyBasket);
    expect(codes).toContain(DraftProblemCode.MissingPickup);
    expect(codes).toContain(DraftProblemCode.MissingDropoff);
    expect(codes).toContain(DraftProblemCode.MissingSchedule);
    expect(codes).toContain(DraftProblemCode.MissingRoute);
  });

  it('throws rather than returning a plausible-looking QuoteInput', () => {
    const empty = BookingDraftSchema.parse({ version: BOOKING_DRAFT_VERSION });
    expect(() => toQuoteInput(empty, CITY, CARD)).toThrow(DraftIncompleteError);
  });

  it('carries the machine-readable list on the error, not just a sentence', () => {
    const empty = BookingDraftSchema.parse({ version: BOOKING_DRAFT_VERSION });
    try {
      toQuoteInput(empty, CITY, CARD);
      expect.unreachable('an empty draft cannot become a QuoteInput');
    } catch (error) {
      expect(error).toBeInstanceOf(DraftIncompleteError);
      const problems = (error as DraftIncompleteError).problems;
      expect(problems).toEqual(draftProblems(empty, CITY, CARD));
    }
  });

  it('points at the field rather than the form', () => {
    const draft = completeDraft({
      stops: [
        { kind: StopKind.Pickup, access: { floor: 3, elevator: 'none', parking: 'street_hard' } },
        DROPOFF_STOP,
      ],
    });
    const missing = draftProblems(draft, CITY, CARD).find(
      (problem) => problem.code === DraftProblemCode.MissingAddress,
    );
    expect(missing?.path).toBe('stops.0.address');
    expect(missing?.detail).toContain('street');
  });

  it('agrees with itself: the problem list is empty exactly when the conversion works', () => {
    const cases = [
      completeDraft(),
      completeDraft({ basket: [] }),
      completeDraft({ at: null }),
      completeDraft({ routedDistanceMeters: null }),
      completeDraft({ scheduleKind: null }),
      completeDraft({ cityId: 'jerusalem' }),
    ];
    for (const draft of cases) {
      const clean = draftProblems(draft, CITY, CARD).length === 0;
      let converted = true;
      try {
        toQuoteInput(draft, CITY, CARD);
      } catch {
        converted = false;
      }
      expect(converted).toBe(clean);
    }
  });
});

describe('a complete draft becomes an input the engine actually accepts', () => {
  it('parses as a QuoteInput and prices to a breakdown that adds up', () => {
    const input = toQuoteInput(completeDraft(), CITY, CARD);
    expect(QuoteInputSchema.safeParse(input).success).toBe(true);

    const result = computeQuote(input, CARD, CATALOG_BY_ID);
    expect(verifyBreakdown(result.breakdown)).toEqual({ ok: true });
    expect(result.lockedTotal).toBeGreaterThan(0);
  });

  it('carries the answers through instead of re-deciding them', () => {
    const input = toQuoteInput(completeDraft(), CITY, CARD);
    expect(input.cityId).toBe(CITY.id);
    expect(input.routedDistanceMeters).toBe(8_400);
    expect(input.stops).toHaveLength(2);
    expect(input.stops.map((stop) => stop.kind)).toEqual([StopKind.Pickup, StopKind.Dropoff]);
    expect(input.manifest.lines).toHaveLength(4);
  });
});

describe('the schedule is read in Jerusalem, never off the Date', () => {
  it('reports the local hour, not the UTC one', () => {
    const at = '2026-08-12T07:00:00.000Z';
    const input = toQuoteInput(completeDraft({ at }), CITY, CARD);
    expect(input.schedule.localHour).toBe(10);
    expect(input.schedule.localHour).not.toBe(new Date(at).getUTCHours());
    expect(input.schedule.month).toBe(8);
  });

  it('knows a winter Friday evening is already Shabbat', () => {
    // 17:00 in Tel Aviv on 9 January 2026. Candle lighting was 16:35, so this
    // is a slot no truck works — and the civil date still says short_day.
    const input = toQuoteInput(completeDraft({ at: '2026-01-09T15:00:00.000Z' }), CITY, CARD);
    expect(input.schedule.localHour).toBe(17);
    expect(input.schedule.dayKind).toBe(DayKind.Shabbat);
  });

  it('knows motzei Shabbat is not Shabbat', () => {
    // 19:00 in Tel Aviv on Saturday 10 January 2026 — nightfall has passed and
    // this is one of the busiest moving windows of the Israeli week.
    const input = toQuoteInput(completeDraft({ at: '2026-01-10T17:00:00.000Z' }), CITY, CARD);
    expect(input.schedule.dayKind).toBe(DayKind.Workday);
  });

  it('prices a Now booking against the clock it is handed, not its own', () => {
    const now = new Date('2026-08-12T07:00:00.000Z');
    const draft = completeDraft({ scheduleKind: 'now', at: null });
    const input = toQuoteInput(draft, CITY, CARD, { now });
    expect(input.schedule.at.getTime()).toBe(now.getTime());
    expect(input.schedule.localHour).toBe(10);
  });

  it('refuses to guess Now when the customer has not chosen', () => {
    // Roughly seven in ten moves are planned rather than spontaneous, so an
    // unanswered draft is not quietly an on-demand one.
    const codes = codesOf(completeDraft({ scheduleKind: null, at: null }));
    expect(codes).toContain(DraftProblemCode.MissingSchedule);
  });

  it('refuses a scheduled booking with no slot', () => {
    expect(codesOf(completeDraft({ at: null }))).toContain(DraftProblemCode.MissingSchedule);
  });
});

describe('unanswered access questions', () => {
  it('are fatal when the domain has no default to fall back on', () => {
    const codes = codesOf(draftWithPickupAccess({ floor: 4 }));
    const problem = draftProblems(draftWithPickupAccess({ floor: 4 }), CITY, CARD).find(
      (p) => p.code === DraftProblemCode.MissingAccess,
    );
    expect(codes).toContain(DraftProblemCode.MissingAccess);
    expect(problem?.detail).toBe('elevator,parking');
  });

  it('take the domain default when there is a safe one', () => {
    const input = toQuoteInput(
      draftWithPickupAccess({
        floor: 4,
        elevator: ElevatorKind.None,
        parking: ParkingSituation.None,
      }),
      CITY,
      CARD,
    );
    const pickup = input.stops[0];
    // An unasked crane question is `unknown`, which is what blocks a locked
    // quote above a size threshold — not `not_needed`, which would price the
    // job as though somebody had checked.
    expect(pickup?.access.crane).toBe(CraneNeed.Unknown);
    expect(pickup?.access.permitRequired).toBe(false);
    expect(pickup?.access.carryDistanceMeters).toBe(0);
  });

  it('derive the stair count from the floor when nobody counted', () => {
    const walkUp = toQuoteInput(
      draftWithPickupAccess({
        floor: 4,
        elevator: ElevatorKind.None,
        parking: ParkingSituation.None,
      }),
      CITY,
      CARD,
    );
    expect(walkUp.stops[0]?.access.stairFlights).toBe(4);

    const withLift = toQuoteInput(
      draftWithPickupAccess({
        floor: 4,
        elevator: ElevatorKind.Service,
        parking: ParkingSituation.None,
      }),
      CITY,
      CARD,
    );
    expect(withLift.stops[0]?.access.stairFlights).toBe(0);

    // A small lift is not a lift for furniture, so the flights are still walked.
    const smallLift = toQuoteInput(
      draftWithPickupAccess({
        floor: 4,
        elevator: ElevatorKind.Small,
        parking: ParkingSituation.None,
      }),
      CITY,
      CARD,
    );
    expect(smallLift.stops[0]?.access.stairFlights).toBe(4);

    const basement = toQuoteInput(
      draftWithPickupAccess({
        floor: -2,
        elevator: ElevatorKind.None,
        parking: ParkingSituation.None,
      }),
      CITY,
      CARD,
    );
    expect(basement.stops[0]?.access.stairFlights).toBe(2);
  });

  it('never override a count the customer gave', () => {
    const input = toQuoteInput(
      draftWithPickupAccess({
        floor: 4,
        elevator: ElevatorKind.None,
        parking: ParkingSituation.None,
        stairFlights: 7,
      }),
      CITY,
      CARD,
    );
    expect(input.stops[0]?.access.stairFlights).toBe(7);
  });
});

describe('the truck and the crew are derived when the customer did not choose', () => {
  it('picks the smallest class the load fits into', () => {
    const input = toQuoteInput(completeDraft(), CITY, CARD);
    expect(input.vehicleClassId).toBe('van');
  });

  it('lets an explicit choice win', () => {
    const input = toQuoteInput(completeDraft({ vehicleClassId: 'box_truck_4t' }), CITY, CARD);
    expect(input.vehicleClassId).toBe('box_truck_4t');
  });

  it('takes the crew from the truck and from what the load needs', () => {
    // One washing machine fits a pickup, whose minimum crew is one — but it
    // cannot be carried by one person, so the crew is two either way.
    const twoPersonItem = toQuoteInput(
      completeDraft({ basket: [{ catalogItemId: 'washing_machine', quantity: 1 }] }),
      CITY,
      CARD,
    );
    expect(twoPersonItem.vehicleClassId).toBe('pickup');
    expect(twoPersonItem.crewSize).toBe(2);

    const oneBox = toQuoteInput(
      completeDraft({ basket: [{ catalogItemId: 'box_small', quantity: 1 }] }),
      CITY,
      CARD,
    );
    expect(oneBox.crewSize).toBe(1);
  });

  it('lets an explicit crew win', () => {
    const input = toQuoteInput(completeDraft({ crewSize: 4 }), CITY, CARD);
    expect(input.crewSize).toBe(4);
  });

  it('refuses rather than reaching for the biggest truck when nothing fits', () => {
    const codes = codesOf(
      completeDraft({ basket: [{ catalogItemId: 'fridge_large', quantity: 999 }] }),
    );
    expect(codes).toContain(DraftProblemCode.NoVehicleClassFits);
  });
});

/**
 * The product's one promise, enforced end-to-end rather than by field value: a
 * draft priced with the real card and the real catalog, so a client field that
 * quietly buys a smaller truck or a smaller crew shows up here as shekels.
 */
describe('the customer may choose up, never down', () => {
  const priceOf = (draft: BookingDraft): number =>
    computeQuote(toQuoteInput(draft, CITY, CARD), CARD, CATALOG_BY_ID).lockedTotal;

  it('refuses a truck that cannot carry the load, whoever named it', () => {
    // The fixture basket is 3.75m³ / 360kg. A טנדר is an open 2.5m³ bed.
    const draft = completeDraft({ vehicleClassId: 'pickup' });
    const problem = draftProblems(draft, CITY, CARD).find(
      (p) => p.code === DraftProblemCode.VehicleClassTooSmall,
    );
    expect(problem?.path).toBe('vehicleClassId');
    expect(problem?.detail).toBe('van');
    expect(() => toQuoteInput(draft, CITY, CARD)).toThrow(DraftIncompleteError);
  });

  it('judges a named class by the same rule that produces the recommendation', () => {
    for (const id of ['pickup', 'small_van']) {
      expect(codesOf(completeDraft({ vehicleClassId: id }))).toContain(
        DraftProblemCode.VehicleClassTooSmall,
      );
    }
    for (const id of ['van', 'crane_truck', 'box_truck_4t', 'box_truck_8t']) {
      expect(codesOf(completeDraft({ vehicleClassId: id }))).toEqual([]);
    }
  });

  it('still needs a human when nothing fits, named or not', () => {
    const overloaded = { basket: [{ catalogItemId: 'fridge_large', quantity: 999 }] };
    expect(codesOf(completeDraft({ ...overloaded, vehicleClassId: 'box_truck_8t' }))).toContain(
      DraftProblemCode.NoVehicleClassFits,
    );
  });

  it('floors a crew the client sent below what the load needs', () => {
    // The fixture basket has a fridge in it: two people, whatever the draft says.
    expect(toQuoteInput(completeDraft(), CITY, CARD).crewSize).toBe(2);
    expect(toQuoteInput(completeDraft({ crewSize: 1 }), CITY, CARD).crewSize).toBe(2);
    // Floored rather than refused, and the price is the honest one to the agora.
    expect(codesOf(completeDraft({ crewSize: 1 }))).toEqual([]);
    expect(priceOf(completeDraft({ crewSize: 1 }))).toBe(priceOf(completeDraft()));
  });

  it('floors it at the truck’s own minimum crew as well', () => {
    const oneBox = [{ catalogItemId: 'box_small', quantity: 1 }];
    // One small box needs neither a second pair of hands nor a big truck…
    expect(toQuoteInput(completeDraft({ basket: oneBox }), CITY, CARD).crewSize).toBe(1);
    // …but a 4-tonne truck is never dispatched with one person in it.
    const bigTruck = completeDraft({
      basket: oneBox,
      vehicleClassId: 'box_truck_4t',
      crewSize: 1,
    });
    expect(toQuoteInput(bigTruck, CITY, CARD).crewSize).toBe(2);
  });

  it('prices no client-set combination below the honest quote', () => {
    const honest = priceOf(completeDraft());
    const cheats = [
      { vehicleClassId: 'pickup' },
      { vehicleClassId: 'small_van' },
      { crewSize: 1 },
      { vehicleClassId: 'pickup', crewSize: 1 },
      { vehicleClassId: 'box_truck_4t', crewSize: 1 },
    ];
    for (const patch of cheats) {
      const draft = completeDraft(patch);
      if (draftProblems(draft, CITY, CARD).length > 0) {
        expect(() => toQuoteInput(draft, CITY, CARD)).toThrow(DraftIncompleteError);
        continue;
      }
      expect(priceOf(draft)).toBeGreaterThanOrEqual(honest);
    }

    // Upwards is still the customer's to choose, and it costs what it costs.
    expect(priceOf(completeDraft({ vehicleClassId: 'box_truck_4t' }))).toBeGreaterThan(honest);
    expect(priceOf(completeDraft({ crewSize: 4 }))).toBeGreaterThan(honest);
  });
});

describe('the basket', () => {
  it('drops rows stepped down to zero', () => {
    const manifest = toManifest(
      completeDraft({
        basket: [
          { catalogItemId: 'box_small', quantity: 0 },
          { catalogItemId: 'box_medium', quantity: 3 },
        ],
      }),
    );
    expect(manifest.lines).toHaveLength(1);
    expect(manifest.lines[0]?.catalogItemId).toBe('box_medium');
  });

  it('treats a basket of nothing but zeroes as empty, not as invalid', () => {
    const draft = completeDraft({ basket: [{ catalogItemId: 'box_small', quantity: 0 }] });
    expect(() => toManifest(draft)).toThrow(DraftIncompleteError);
    expect(codesOf(draft)).toContain(DraftProblemCode.EmptyBasket);
  });

  it('records that a preset built it, so the accuracy comparison is not skewed', () => {
    expect(toManifest(completeDraft({ presetId: 'flat_3_rooms' })).source).toBe('preset');
    expect(toManifest(completeDraft()).source).toBe('picker');
    expect(toManifest(completeDraft({ presetId: 'flat_3_rooms', source: 'ops' })).source).toBe(
      'ops',
    );
  });

  it('refuses a free-text item we will not carry, wherever the client failed to check', () => {
    const draft = completeDraft({
      basket: [
        { catalogItemId: 'box_small', quantity: 2 },
        { catalogItemId: 'other_item', quantity: 1, customLabel: 'בלוני גז' },
      ],
    });
    const refusal = draftProblems(draft, CITY, CARD).find(
      (problem) => problem.code === DraftProblemCode.RefusedItem,
    );
    expect(refusal?.path).toBe('basket.1.customLabel');
    expect(refusal?.detail).toBe('gas_balloon');
  });

  it('does not refuse an ordinary description', () => {
    const draft = completeDraft({
      basket: [{ catalogItemId: 'other_item', quantity: 1, customLabel: 'ארגז כלים ישן' }],
    });
    expect(codesOf(draft)).not.toContain(DraftProblemCode.RefusedItem);
  });

  it('ignores a refused label on a row the customer already removed', () => {
    const draft = completeDraft({
      basket: [
        { catalogItemId: 'box_small', quantity: 1 },
        { catalogItemId: 'other_item', quantity: 0, customLabel: 'בלון גז' },
      ],
    });
    expect(codesOf(draft)).not.toContain(DraftProblemCode.RefusedItem);
  });
});

describe('the things a customer must not be able to set', () => {
  it('takes the crane thresholds from the caller, never from the draft', () => {
    const smuggled = BookingDraftSchema.parse({
      ...completeDraftInput(),
      craneRules: { craneFromFloor: 60, neverBelowFloor: 60 },
    });
    expect(toQuoteInput(smuggled, CITY, CARD).craneRules).toBeUndefined();

    const rules = { craneFromFloor: 5, neverBelowFloor: 3 };
    expect(toQuoteInput(smuggled, CITY, CARD, { craneRules: rules }).craneRules).toEqual(rules);
  });

  it('takes the demand factor from the caller', () => {
    const input = toQuoteInput(completeDraft(), CITY, CARD, { demandFactorBps: bps(11_000) });
    expect(input.demandFactorBps).toBe(11_000);
    expect(toQuoteInput(completeDraft(), CITY, CARD).demandFactorBps).toBeUndefined();
  });

  it('keeps the promo code on the draft and its value on the server', () => {
    const draft = completeDraft({ promoCode: 'WELCOME50' });
    const promo = { code: 'WELCOME50', amountOff: shekels(50) };
    expect(toQuoteInput(draft, CITY, CARD, { promo }).promo).toEqual(promo);
  });

  it('refuses a resolved promo for a code the customer never typed', () => {
    const draft = completeDraft({ promoCode: 'WELCOME50' });
    const problems = draftProblems(draft, CITY, CARD, {
      promo: { code: 'STAFF100', percentOffBps: bps(1_000) },
    });
    expect(problems.map((p) => p.code)).toContain(DraftProblemCode.PromoMismatch);
  });

  it('refuses a protection tier the card does not sell', () => {
    expect(codesOf(completeDraft({ protectionTierId: 'platinum' }))).toContain(
      DraftProblemCode.UnknownProtectionTier,
    );
    expect(codesOf(completeDraft({ protectionTierId: 'extended' }))).toEqual([]);
  });

  it('refuses to price one city’s draft against another city’s card', () => {
    const problem = draftProblems(completeDraft({ cityId: 'jerusalem' }), CITY, CARD).find(
      (p) => p.code === DraftProblemCode.CityMismatch,
    );
    expect(problem?.detail).toBe('jerusalem');
    // Same draft, right city: no complaint.
    expect(codesOf(completeDraft({ cityId: TEL_AVIV_CITY.id }))).toEqual([]);
  });
});

describe('toStops', () => {
  it('takes the index from the array position', () => {
    const stops = toStops(completeDraft());
    expect(stops.map((stop) => stop.index)).toEqual([0, 1]);
  });

  it('normalises the contact number here, where it is about to be used', () => {
    const stops = toStops(completeDraft());
    expect(stops[0]?.contactPhone).toBe('+972521234567');
    expect(stops[1]?.contactPhone).toBeNull();
  });

  it('builds a display line when the customer typed the address instead of picking it', () => {
    const stops = toStops(completeDraft());
    expect(stops[0]?.address.formatted).toBe('דיזנגוף 100, תל אביב-יפו');
  });

  it('refuses the same way the price conversion does', () => {
    const draft = completeDraft({
      stops: [
        { kind: StopKind.Pickup, access: { floor: 0, elevator: 'none', parking: 'street_easy' } },
        DROPOFF_STOP,
      ],
    });
    expect(() => toStops(draft)).toThrow(DraftIncompleteError);
  });
});

describe('the stored slot survives the conversion', () => {
  it('reads the ISO instant back as the instant it was written from', () => {
    const input = toQuoteInput(completeDraft(), CITY, CARD);
    expect(input.schedule.at.toISOString()).toBe(SCHEDULED_AT);
  });
});
