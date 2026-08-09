import { computeQuote, type QuoteInput } from '@haul/pricing';
import {
  CraneNeed,
  DayKind,
  ElevatorKind,
  ParkingSituation,
  StopKind,
  formatILS,
  verifyBreakdown,
  type AccessDetails,
  type Manifest,
} from '@haul/types';
import { describe, expect, it } from 'vitest';
import { CATALOG_BY_ID, MANIFEST_PRESETS, VEHICLE_CLASSES } from '../catalog.js';
import { TEL_AVIV_MARKET_ANCHORS, TEL_AVIV_RATE_CARD } from '../cities/tel-aviv.js';

/**
 * ---------------------------------------------------------------------------
 * Calibration against the real Israeli market
 * ---------------------------------------------------------------------------
 * The unit tests in `@haul/pricing` prove the engine is internally consistent.
 * They cannot tell you it produces the right *number* — a receipt can reconcile
 * perfectly and still be double what a Tel Aviv mover would charge.
 *
 * This is the test that catches that. It runs the real catalog through the real
 * rate card and checks the answers land inside the range published by Israeli
 * movers. When the rate card is retuned from Phase 0 data, this is the file
 * that says whether the retune was sane.
 * ---------------------------------------------------------------------------
 */

function access(overrides: Partial<AccessDetails> = {}): AccessDetails {
  return {
    floor: 0,
    elevator: ElevatorKind.None,
    stairFlights: 0,
    carryDistanceMeters: 0,
    parking: ParkingSituation.StreetEasy,
    narrowStairwell: false,
    crane: CraneNeed.NotNeeded,
    permitRequired: false,
    notes: null,
    ...overrides,
  };
}

function manifestFromPreset(presetId: string): Manifest {
  const preset = MANIFEST_PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error(`no preset ${presetId}`);
  return {
    lines: preset.lines.map((l) => ({
      catalogItemId: l.catalogItemId,
      quantity: l.quantity,
      customLabel: null,
      stopIndex: 0,
      addedDuringJob: false,
      loadedAt: null,
      unloadedAt: null,
    })),
    presetId,
    source: 'preset',
  };
}

/**
 * The baseline the market figures describe: a standard local move with a lift
 * or ground floor, no crane, no packing, on an ordinary weekday in a neutral
 * month. Everything else is a surcharge on top of this.
 */
function standardMove(presetId: string, vehicleClassId: string, crewSize: number) {
  const input: QuoteInput = {
    cityId: 'tel-aviv',
    manifest: manifestFromPreset(presetId),
    stops: [
      { kind: StopKind.Pickup, access: access({ elevator: ElevatorKind.Standard }) },
      { kind: StopKind.Dropoff, access: access({ elevator: ElevatorKind.Standard }) },
    ],
    // Gush Dan local move, inside the included radius.
    routedDistanceMeters: 9_000,
    vehicleClassId: vehicleClassId as QuoteInput['vehicleClassId'],
    crewSize,
    schedule: {
      at: new Date('2026-10-13T07:00:00Z'),
      dayKind: DayKind.Workday,
      isCholHaMoed: false,
      localHour: 9,
      month: 10, // neutral seasonal factor
    },
  };
  return computeQuote(input, TEL_AVIV_RATE_CARD, CATALOG_BY_ID);
}

describe('the engine reproduces published Israeli market prices', () => {
  // Crew sizes from the sources: 2–3 movers for a 3-room, scaling to 4 for a 5-room.
  const scenarios = [
    { presetId: 'apartment_2_rooms', vehicle: 'van', crew: 2 },
    { presetId: 'apartment_3_rooms', vehicle: 'box_truck_4t', crew: 3 },
    { presetId: 'apartment_4_rooms', vehicle: 'box_truck_4t', crew: 3 },
    { presetId: 'apartment_5_rooms_plus', vehicle: 'box_truck_8t', crew: 4 },
  ];

  for (const scenario of scenarios) {
    const anchor = TEL_AVIV_MARKET_ANCHORS.find((a) => a.presetId === scenario.presetId)!;

    it(`prices a ${anchor.rooms} move inside the market range`, () => {
      const result = standardMove(scenario.presetId, scenario.vehicle, scenario.crew);

      const message =
        `${anchor.rooms}: quoted ${formatILS(result.lockedTotal, 'en')}, ` +
        `market ${formatILS(anchor.low, 'en')}–${formatILS(anchor.high, 'en')} ` +
        `(typical ${formatILS(anchor.typical, 'en')}), ` +
        `${result.estimatedWorkingMinutes} working minutes`;

      expect(result.lockedTotal, message).toBeGreaterThanOrEqual(anchor.low);
      expect(result.lockedTotal, message).toBeLessThanOrEqual(anchor.high);
    });

    it(`prices a ${anchor.rooms} move within 35% of the typical quote`, () => {
      const result = standardMove(scenario.presetId, scenario.vehicle, scenario.crew);
      const ratio = result.lockedTotal / anchor.typical;
      expect(
        Math.abs(ratio - 1),
        `${anchor.rooms}: ${formatILS(result.lockedTotal, 'en')} vs typical ${formatILS(anchor.typical, 'en')} (ratio ${ratio.toFixed(2)})`,
      ).toBeLessThan(0.35);
    });
  }

  it('keeps every quote reconciling against the real catalog', () => {
    for (const scenario of scenarios) {
      const result = standardMove(scenario.presetId, scenario.vehicle, scenario.crew);
      expect(verifyBreakdown(result.breakdown), scenario.presetId).toEqual({ ok: true });
      expect(result.unknownItemIds, scenario.presetId).toEqual([]);
    }
  });

  it('produces plausible durations', () => {
    // Israeli movers describe a 3-room as most of a working day for a crew of 3.
    const threeRoom = standardMove('apartment_3_rooms', 'box_truck_4t', 3);
    expect(threeRoom.estimatedWorkingMinutes).toBeGreaterThan(180);
    expect(threeRoom.estimatedWorkingMinutes).toBeLessThan(480);
  });
});

describe('crane pricing matches quoted operator jobs', () => {
  // From a real operator's published table of jobs actually quoted:
  //   30 min to the 4th floor  → ₪300–350   (the call-out floor)
  //   piano to the 6th floor   → ₪400–450
  //   bedroom suite from 6th   → ₪400–450
  //   2 hours to the 5th floor → ₪800–850
  // A 3-room flat's crane-candidate volume is about one hour of work, so it
  // should land in the ₪400–600 call-out band — not at the two-hour figure.
  it('prices a one-hour lift at the call-out rate', () => {
    const result = computeQuote(
      {
        cityId: 'tel-aviv',
        manifest: manifestFromPreset('apartment_3_rooms'),
        stops: [
          {
            kind: StopKind.Pickup,
            access: access({
              floor: 5,
              stairFlights: 5,
              narrowStairwell: true,
              crane: CraneNeed.Required,
            }),
          },
          { kind: StopKind.Dropoff, access: access({ elevator: ElevatorKind.Standard }) },
        ],
        routedDistanceMeters: 9_000,
        vehicleClassId: 'box_truck_4t',
        crewSize: 3,
        schedule: {
          at: new Date('2026-10-13T07:00:00Z'),
          dayKind: DayKind.Workday,
          isCholHaMoed: false,
          localHour: 9,
          month: 10,
        },
      },
      TEL_AVIV_RATE_CARD,
      CATALOG_BY_ID,
    );

    const craneLine = result.breakdown.lines.find((l) => l.kind === 'crane');
    expect(craneLine).toBeDefined();

    // Compare gross, since the operator quotes are VAT-inclusive.
    const craneGross = Math.round(craneLine!.amount * 1.18);
    const message =
      `crane line ₪${(craneGross / 100).toFixed(0)}, operator call-out band is ₪400–600 ` +
      `for roughly an hour at floors 1–6`;
    expect(craneGross, message).toBeGreaterThan(40_000); // ₪400
    expect(craneGross, message).toBeLessThan(65_000); // ₪650
  });

  it('charges near the two-hour figure for a flat with twice the furniture', () => {
    // The same operator table puts two hours to a 5th floor at ₪800–850.
    const result = computeQuote(
      {
        cityId: 'tel-aviv',
        manifest: manifestFromPreset('apartment_5_rooms_plus'),
        stops: [
          {
            kind: StopKind.Pickup,
            access: access({
              floor: 5,
              stairFlights: 5,
              narrowStairwell: true,
              crane: CraneNeed.Required,
            }),
          },
          { kind: StopKind.Dropoff, access: access({ elevator: ElevatorKind.Standard }) },
        ],
        routedDistanceMeters: 9_000,
        vehicleClassId: 'box_truck_8t',
        crewSize: 4,
        schedule: {
          at: new Date('2026-10-13T07:00:00Z'),
          dayKind: DayKind.Workday,
          isCholHaMoed: false,
          localHour: 9,
          month: 10,
        },
      },
      TEL_AVIV_RATE_CARD,
      CATALOG_BY_ID,
    );

    const craneGross = Math.round(
      result.breakdown.lines.filter((l) => l.kind === 'crane').reduce((a, l) => a + l.amount, 0) *
        1.18,
    );
    const message = `crane line ₪${(craneGross / 100).toFixed(0)}, operator table says ₪800–850 for 2h to floor 5`;
    expect(craneGross, message).toBeGreaterThan(70_000); // ₪700
    expect(craneGross, message).toBeLessThan(110_000); // ₪1,100
  });

  it('charges dramatically more above the 10th floor', () => {
    const build = (floor: number) =>
      computeQuote(
        {
          cityId: 'tel-aviv',
          manifest: manifestFromPreset('apartment_3_rooms'),
          stops: [
            {
              kind: StopKind.Pickup,
              access: access({
                floor,
                stairFlights: floor,
                narrowStairwell: true,
                crane: CraneNeed.Required,
              }),
            },
            { kind: StopKind.Dropoff, access: access({ elevator: ElevatorKind.Standard }) },
          ],
          routedDistanceMeters: 9_000,
          vehicleClassId: 'box_truck_4t',
          crewSize: 3,
          schedule: {
            at: new Date('2026-10-13T07:00:00Z'),
            dayKind: DayKind.Workday,
            isCholHaMoed: false,
            localHour: 9,
            month: 10,
          },
        },
        TEL_AVIV_RATE_CARD,
        CATALOG_BY_ID,
      );

    const craneAt = (floor: number) =>
      build(floor)
        .breakdown.lines.filter((l) => l.kind === 'crane')
        .reduce((a, l) => a + l.amount, 0);

    // The bands are steep and discontinuous — an arm crane above the 10th is a
    // different machine with a two-hour minimum, not a taller version.
    expect(craneAt(12)).toBeGreaterThan(craneAt(8));
    expect(craneAt(8)).toBeGreaterThan(craneAt(3));
  });
});

describe('seasonality is the biggest swing in the card', () => {
  it('prices midwinter well below high summer', () => {
    const at = (month: number) =>
      computeQuote(
        {
          cityId: 'tel-aviv',
          manifest: manifestFromPreset('apartment_3_rooms'),
          stops: [
            { kind: StopKind.Pickup, access: access({ elevator: ElevatorKind.Standard }) },
            { kind: StopKind.Dropoff, access: access({ elevator: ElevatorKind.Standard }) },
          ],
          routedDistanceMeters: 9_000,
          vehicleClassId: 'box_truck_4t',
          crewSize: 3,
          schedule: {
            at: new Date('2026-10-13T07:00:00Z'),
            dayKind: DayKind.Workday,
            isCholHaMoed: false,
            localHour: 9,
            month,
          },
        },
        TEL_AVIV_RATE_CARD,
        CATALOG_BY_ID,
      ).lockedTotal;

    const january = at(1);
    const july = at(7);
    // Sources show winter quotes running 25–30% below summer for the same flat.
    const swing = july / january - 1;
    expect(swing, `Jan ${january} vs Jul ${july} → ${(swing * 100).toFixed(0)}%`).toBeGreaterThan(
      0.2,
    );
    expect(swing).toBeLessThan(0.45);
  });
});

describe('the catalog itself', () => {
  it('resolves every preset item', () => {
    for (const preset of MANIFEST_PRESETS) {
      for (const line of preset.lines) {
        expect(CATALOG_BY_ID.has(line.catalogItemId), `${preset.id} → ${line.catalogItemId}`).toBe(
          true,
        );
      }
    }
  });

  it('has a rate for every heavy-item surcharge key in the catalog', () => {
    // A surcharge key with no rate is an item that silently prices as ordinary.
    for (const item of CATALOG_BY_ID.values()) {
      if (!item.heavyItemSurchargeKey) continue;
      expect(
        TEL_AVIV_RATE_CARD.heavyItemSurcharges[item.heavyItemSurchargeKey],
        `${item.id} → ${item.heavyItemSurchargeKey}`,
      ).toBeDefined();
    }
  });

  it('has a base fare for every vehicle class', () => {
    for (const vehicle of VEHICLE_CLASSES) {
      expect(TEL_AVIV_RATE_CARD.baseFareByVehicle[vehicle.id], vehicle.id).toBeDefined();
    }
  });

  it('never flags a mattress as needing a crane', () => {
    // The audit's headline catch: a 42kg mattress flagged crane-required while
    // an 80kg rigid fridge was not. Mattresses bend around a stairwell.
    for (const item of CATALOG_BY_ID.values()) {
      if (/mattress|מזרן/.test(item.id + item.nameHe)) {
        expect(item.craneCandidate, item.id).toBe(false);
      }
    }
  });

  it('flags heavy rigid appliances as crane candidates', () => {
    for (const id of ['fridge_large', 'fridge_two_door', 'freezer_upright', 'washing_machine']) {
      const item = CATALOG_BY_ID.get(id);
      if (!item) continue;
      if (item.weightKg >= 70 || item.volumeM3 >= 0.8) {
        expect(item.craneCandidate, `${id} (${item.weightKg}kg, ${item.volumeM3}m³)`).toBe(true);
      }
    }
  });

  it('offers an escape hatch for items not in the catalog', () => {
    // Without it, anything unlisted is silently omitted from the quote.
    expect(CATALOG_BY_ID.has('other_item')).toBe(true);
  });
});
