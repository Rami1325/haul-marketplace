import { agorot, bps, extractVat, percent, shekels, type Agorot } from '@haul/types';
import { RateCardSchema, advertisedMinimum, type RateCard } from '@haul/pricing';

/**
 * ---------------------------------------------------------------------------
 * Tel Aviv / Gush Dan rate card
 * ---------------------------------------------------------------------------
 * Seeded from published Israeli mover pricing (see SOURCES below), not invented.
 *
 * Read this before trusting any number here:
 *
 * Israeli movers do not sell the way a rate card models the world. They quote a
 * whole-job lump sum off a WhatsApp survey — rooms, floors, lift, crane yes/no
 * — not base + per-km + per-hour. So the evidence is strong for *totals* and
 * for *crane rates*, and weak for the decomposition. The unit rates below are
 * reconstructed so that they reproduce the sourced whole-apartment totals, and
 * `calibration.test.ts` asserts exactly that.
 *
 * Confidence, honestly:
 *   HIGH      whole-apartment totals · crane hourly rates and floor bands · VAT
 *   MEDIUM    per-floor surcharge (sources span ₪100–350) · piano and safe · seasonality
 *   LOW       base fare by vehicle (derived) · labour per mover-hour (derived) ·
 *             per-km (conflicting bases, and inside Gush Dan it rarely fires)
 *   INVENTED  long carry per 10m — NO Israeli mover publishes one. Movers absorb
 *             it into billed hours or add a lump ₪100–300. Do not defend this
 *             number to a customer; recalibrate it first.
 *
 * Recalibrate long carry, the per-floor rate, and the base/labour split first —
 * they carry the most invented content. Phase 0's twenty manual moves exist
 * precisely to replace them.
 * ---------------------------------------------------------------------------
 */

/**
 * Israeli consumer prices are quoted VAT-inclusive, and every source below
 * quotes that way. The rate card stores NET, so research figures are converted
 * once, here, rather than being silently mixed.
 */
const VAT_RATE = percent(18);
function fromGross(grossShekels: number): Agorot {
  return extractVat(shekels(grossShekels), VAT_RATE).net;
}

export const TEL_AVIV_RATE_CARD: RateCard = RateCardSchema.parse({
  cityId: 'tel-aviv',
  version: '2026.08-seed',
  effectiveFrom: new Date('2026-08-01T00:00:00Z'),
  currency: 'ILS',
  // 18% since January 2025. The proposed rise to 19% for 2026 was dropped.
  vatRate: VAT_RATE,

  // Derived from published vehicle-hour rates plus the observed single-item job
  // floor (₪250–650, averaging ~₪525). LOW confidence — the split between base
  // and labour is an assumption, not an observation.
  baseFareByVehicle: {
    pickup: fromGross(450),
    small_van: fromGross(550),
    van: fromGross(700),
    box_truck_4t: fromGross(1_000),
    box_truck_8t: fromGross(1_500),
    crane_truck: fromGross(1_200),
  },

  // Sources split between "₪3–5/km on top of work hours" and "₪8–12/km" — but
  // the latter absorbs driver time and the return leg, which this card bills
  // separately. Base quotes typically include the first ~30km, and almost every
  // Gush Dan move is inside that, so this rarely fires.
  perKm: fromGross(5),
  includedKm: 30,

  // No Israeli mover publishes a clean per-mover hourly rate. Reconstructed from
  // "additional worker ₪200" and "additional hours ₪150/hr".
  laborPerMoverHour: fromGross(130),

  // Sources span ₪100–350 flat, or +10–15% / +25–35% of base per floor. On a
  // 3-room base of ~₪2,800 the percentage conventions land around ₪280–340,
  // which reconciles with the flat figures. ₪200 is the middle. Wide band —
  // a prime recalibration target.
  perStairFlight: fromGross(200),

  // INVENTED. No source exists. Derived from crew-hour cost alone.
  longCarryPer10m: fromGross(40),
  freeCarryMeters: 20,

  // Movers add a lump ₪100–300 for distant parking rather than itemising it.
  hardParkingFee: fromGross(150),

  // Floor-banded and hourly with a de-facto one-hour minimum call-out. The
  // bands are steep and discontinuous, which is why this is not a linear
  // per-floor rate. Converted to VAT-inclusive where sources quoted ex-VAT.
  //
  // Calibration anchors from a real operator's quoted jobs:
  //   30 min to the 4th floor → ₪300–350   (the call-out floor)
  //   2 hours to the 5th floor → ₪800–850
  //   piano to the 6th floor → ₪400–450
  craneBands: [
    { maxFloor: 6, callOut: fromGross(500), perHour: fromGross(500), minimumHours: 1 },
    { maxFloor: 10, callOut: fromGross(600), perHour: fromGross(800), minimumHours: 1 },
    // Above the 10th an articulated arm crane is needed, and those carry a hard
    // two-hour minimum. This band is genuinely expensive and should be.
    { maxFloor: 99, callOut: fromGross(1_000), perHour: fromGross(1_400), minimumHours: 2 },
  ],

  // Calibrated against the operator rule of thumb — about an hour for a 2–3
  // room flat, 1.5–2 hours for a 4–5 room. The 3-room preset's crane-candidate
  // volume is 11.8 m³, which at this rate lands on almost exactly one hour.
  craneVolumePerHourM3: 12,
  cranePillarBuildingFloorBonus: 1,

  // Surcharges on top of a move, NOT standalone job prices. A standalone piano
  // job carries its own truck and call-out (~₪1,100); a piano inside a 4-room
  // move does not (~₪700).
  heavyItemSurcharges: {
    piano_upright: fromGross(700),
    piano_grand: fromGross(1_200),
    safe_home: fromGross(300),
    safe_gun: fromGross(700),
    pool_table: fromGross(600),
    gym_machine_multi: fromGross(400),
    treadmill: fromGross(200),
    aquarium_large: fromGross(400),
  },

  // Sources put Fridays, festival eves and late evenings at +25–50%.
  timeFactorBps: {
    workday: bps(10_000),
    short_day: bps(12_500),
    holiday_eve: bps(13_000),
    // Not dispatchable, but the factor must exist so a lookup never falls back
    // silently to 1.0 if the calendar ever hands one over.
    shabbat: bps(10_000),
    holiday: bps(10_000),
    // Chol HaMoed: the country is off work and a great many people move house.
    chol_hamoed: bps(12_500),
    evening: bps(12_500),
  },
  eveningFromHour: 18,

  // The largest swing in the card. Midwinter quotes run 25–30% below summer for
  // the identical flat — leases here turn over in the school holidays.
  seasonalFactorBps: {
    '1': bps(9_000),
    '2': bps(9_000),
    '3': bps(9_500),
    '4': bps(10_000),
    '5': bps(10_500),
    '6': bps(11_500),
    '7': bps(12_000),
    '8': bps(12_000),
    '9': bps(11_000),
    '10': bps(10_000),
    '11': bps(9_500),
    '12': bps(9_000),
  },

  maxDemandFactorBps: bps(12_500),

  // Many movers advertise "from ₪250–300"; single-item jobs run ₪250–650.
  //
  // `advertisedMinimum`, NOT `fromGross`, and it is the only money field on this
  // card that states which side of VAT it sits on. This is the figure the city
  // advertises — "החל מ-₪400" — and the engine extracts VAT from it rather than
  // adding VAT to it. Converting it the way every other figure here is converted
  // took VAT off twice and put the real floor at ₪338.98: not a number anybody
  // would advertise, and not a number anybody would notice. A bare integer no
  // longer parses at all, so the convention is stated here where it is written
  // rather than guessed at afterwards by a validator.
  minimumFare: advertisedMinimum(shekels(400)),
  // Round to the nearest ₪10. ₪2,847 reads as machine output.
  roundGrossToAgorot: 1_000,
  driverShareBps: bps(8_000),

  includedCoverValue: shekels(3_000),
  protectionTiers: [
    {
      id: 'extended',
      nameHe: 'כיסוי מורחב עד ₪25,000',
      nameEn: 'Extended cover up to ₪25,000',
      coverValue: shekels(25_000),
      price: fromGross(89),
    },
    {
      id: 'premium',
      nameHe: 'כיסוי מלא עד ₪75,000',
      nameEn: 'Full cover up to ₪75,000',
      coverValue: shekels(75_000),
      price: fromGross(219),
    },
  ],

  cancellationFee: fromGross(150),
  cancellationDriverShareBps: bps(7_000),

  freeWaitingMinutes: 15,
  waitingPerMinute: fromGross(3),
  // getmoving publishes +₪300 for an extra stop — the only source with an
  // explicit figure for it.
  perExtraStop: fromGross(300),

  workingMinutes: {
    fixedOverheadMinutes: 20,
    perStopOverheadMinutes: 10,
    unloadFactor: 0.85,
    crewScalingExponent: 0.8,
    // Fitted against the four sourced whole-apartment totals; the optimum is
    // interior on a wide grid, not a boundary artefact. RMS error 3.3%.
    bulkEfficiencyFloor: 0.46,
    bulkEfficiencyScale: 14,
    stairMinutesPerFlightPerM3: 2.4,
    elevatorMinutesPerM3: 1.1,
    carryMinutesPer10mPerM3: 1.6,
    hardParkingMinutes: 12,
    noParkingMinutes: 25,
    craneSetupMinutes: 30,
    craneMinutesPerM3: 2,
    // 12% padding. Under a locked price every minute of underestimate is a
    // minute the driver works for free, and a driver who feels ambushed leaves.
    bufferBps: bps(1_200),
  },

  // Roughly a 4-room move. Above this a human looks before the price is
  // honoured — the plan calls for reviewing every large quote for the first
  // thousand jobs.
  humanReviewThreshold: shekels(4_000),
  quoteValidityMinutes: 30,

  // POLICY, not market data — no Israeli mover publishes a reschedule term, so
  // there is nothing to source this against. 24 hours, because the crew and the
  // truck are assigned the evening before: a slot given up inside a day cannot
  // be refilled, and the driver eats it. Same reasoning that makes
  // `cancellationFee` exist at all, one day earlier.
  rescheduleCutoffHours: 24,
});

/**
 * Sourced whole-apartment totals, VAT-inclusive, for Gush Dan.
 *
 * Weighted toward pro.co.il and midrag — both are comparison marketplaces
 * aggregating real quotes and both state VAT-inclusive explicitly. One low
 * outlier (headline prices no crew shows up for) was discarded and one lead-gen
 * guide discounted.
 *
 * `calibration.test.ts` asserts the engine reproduces these. They are the
 * strongest evidence in the whole rate card, so they are the thing to hold the
 * engine to — not the reconstructed unit rates.
 */
export const TEL_AVIV_MARKET_ANCHORS: ReadonlyArray<{
  presetId: string;
  rooms: string;
  typical: Agorot;
  low: Agorot;
  high: Agorot;
}> = [
  {
    presetId: 'apartment_2_rooms',
    rooms: '2 חדרים',
    typical: shekels(1_900),
    low: shekels(1_100),
    high: shekels(2_900),
  },
  {
    presetId: 'apartment_3_rooms',
    rooms: '3 חדרים',
    typical: shekels(2_800),
    low: shekels(1_950),
    high: shekels(3_800),
  },
  {
    presetId: 'apartment_4_rooms',
    rooms: '4 חדרים',
    typical: shekels(3_800),
    low: shekels(2_300),
    high: shekels(5_000),
  },
  {
    presetId: 'apartment_5_rooms_plus',
    rooms: '5 חדרים',
    typical: shekels(5_000),
    low: shekels(3_150),
    high: shekels(6_500),
  },
];

export const TEL_AVIV_RATE_CARD_SOURCES: readonly string[] = [
  'https://www.pro.co.il/moving-companies/pricing — marketplace, aggregated real quotes, VAT-incl. Highest weight.',
  'https://www.midrag.co.il/content/Price/5760 — Tel Aviv specific, VAT-incl, only source showing seasonality.',
  'https://www.midrag.co.il/Content/Price/8708 — crane rates by floor band, ex-VAT. Primary crane structure source.',
  'https://hamanof.net/מחירון-עבודות-מנוף/ — real crane operator list, ex-VAT. Arm-crane vs furniture-lift distinction.',
  'https://www.aviv-moving.co.il/מנוף-הרמה/ — table of real quoted jobs; best evidence for call-out behaviour.',
  'https://www.hvl.co.il/מחירון-הובלות — apartment totals, no-elevator uplift, crane bands by floor.',
  'https://getmoving.co.il/מחירון_הובלות_קטנות.html — only source with explicit unit surcharges (extra stop, per floor).',
  'https://www.vatcalc.com/vat/israel-vat-rise-to-19-jan-2026-proposal/ — VAT held at 18% for 2026.',
];

const roundedAgorot = agorot;
export { roundedAgorot };
