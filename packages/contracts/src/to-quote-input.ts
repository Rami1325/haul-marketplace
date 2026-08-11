import {
  CATALOG_BY_ID,
  VEHICLE_CLASSES,
  VEHICLE_CLASS_BY_ID,
  isRefusedLabel,
  scheduleInputFor,
  type CityConfig,
} from '@haul/config';
import {
  QuoteInputSchema,
  type CraneRules,
  type PromoInput,
  type QuoteInput,
  type QuoteStopInput,
  type RateCard,
} from '@haul/pricing';
import {
  AccessDetailsSchema,
  AddressSchema,
  ManifestLineSchema,
  ManifestSchema,
  StopKind,
  StopSchema,
  elevatorTakesFurniture,
  recommendVehicleClass,
  summariseManifest,
  type AccessDetails,
  type Address,
  type Bps,
  type ElevatorKind,
  type Manifest,
  type ManifestLine,
  type Stop,
  type VehicleClassId,
} from '@haul/types';
import type { BookingDraft, DraftAccess, DraftAddress } from './draft.js';

/**
 * ---------------------------------------------------------------------------
 * Draft → domain
 * ---------------------------------------------------------------------------
 * The one place a form becomes a job. Everything upstream is nullable strings
 * in a jsonb blob; everything downstream is branded, bounded, defaulted domain
 * objects that the pricing engine and the database both accept. A second
 * implementation of this conversion — in the web app, in the mobile app, in the
 * dispatch service — is a second opinion about what a complete booking is, and
 * the one that disagrees is whichever one nobody is looking at.
 *
 * Three rules run through all of it.
 *
 * First: **a null the domain schema defaults is an unanswered question with a
 * safe answer; a null the domain schema requires is a missing answer.** The
 * crane question defaults to `unknown`, which is exactly what "nobody has been
 * asked yet" means. The floor has no default, because there is no safe floor to
 * assume, so an unanswered floor is a refusal.
 *
 * Second: **a customer may choose up, never down.** `vehicleClassId` and
 * `crewSize` are the two answers on a draft that are worth money in the
 * direction of less — a smaller truck is a smaller base fare, fewer hands is a
 * smaller labour bill, and dispatch sends what the load needs either way — so
 * each is checked against the load rather than taken. The rule that checks a
 * client's answer is the rule that produces the default, so the two cannot
 * drift apart.
 *
 * Third: **everything is parsed through the real domain schemas on the way
 * out**, not cast. The bounds those schemas enforce are the ones the database
 * column enforces and the ones the engine assumes, and failing here — while the
 * draft that produced the value is still in hand and can be pointed at — is the
 * entire reason this module exists rather than a spread.
 *
 * `draftProblems` and `toQuoteInput` share one implementation, so the progress
 * indicator on the customer's screen and the server's refusal to price cannot
 * reach different conclusions about the same draft.
 * ---------------------------------------------------------------------------
 */

export const DraftProblemCode = {
  /** Started in one city, being priced against another city's card. */
  CityMismatch: 'city_mismatch',
  /** Nothing to move. */
  EmptyBasket: 'empty_basket',
  /** A free-text item we will not carry — an LPG cylinder, fuel, an animal. */
  RefusedItem: 'refused_item',
  MissingPickup: 'missing_pickup',
  MissingDropoff: 'missing_dropoff',
  /** Street, house number, city or pin still blank on one of the stops. */
  MissingAddress: 'missing_address',
  /** Floor, lift or parking still unanswered on one of the stops. */
  MissingAccess: 'missing_access',
  /** Neither Now nor a chosen slot. */
  MissingSchedule: 'missing_schedule',
  /** No routed distance. A price is never computed from a straight line. */
  MissingRoute: 'missing_route',
  /** A protection tier this city's rate card does not sell. */
  UnknownProtectionTier: 'unknown_protection_tier',
  /** Nothing in the fleet carries this load. Needs a human, not a bigger number. */
  NoVehicleClassFits: 'no_vehicle_class_fits',
  /** The truck the customer picked cannot carry it. Something bigger can. */
  VehicleClassTooSmall: 'vehicle_class_too_small',
  /** The resolved promo is for a code other than the one the customer typed. */
  PromoMismatch: 'promo_mismatch',
} as const;
export type DraftProblemCode = (typeof DraftProblemCode)[keyof typeof DraftProblemCode];

/**
 * One reason a draft cannot become a job yet.
 *
 * `message` is English and stays English: it is a developer and ops string. The
 * sentence the customer reads is chosen by the client from `code` and `detail`,
 * because the copy for "you have not picked a date" is a product decision that
 * changes without the validation changing — and because it has to exist in two
 * languages.
 *
 * `path` is a dotted path into the draft (`stops.1.address.street`) so a client
 * can scroll to the field and focus it rather than printing a list.
 */
export interface DraftProblem {
  readonly code: DraftProblemCode;
  readonly path: string;
  readonly message: string;
  /** The specific value the code is about: a city id, a tier id, a refused item id. */
  readonly detail?: string;
}

/**
 * Thrown when a conversion is asked for and the draft cannot supply it.
 *
 * Carries the same list `draftProblems` returns, so a caller that skipped the
 * check still gets a machine-readable answer instead of a message to parse.
 */
export class DraftIncompleteError extends Error {
  readonly problems: readonly DraftProblem[];

  constructor(problems: readonly DraftProblem[]) {
    super(
      `booking draft is incomplete: ${problems.map((p) => `${p.path} (${p.code})`).join(', ')}`,
    );
    this.name = 'DraftIncompleteError';
    this.problems = problems;
  }
}

/**
 * Server-side facts that must never live on a draft.
 *
 * A draft is a document the customer's device writes. Each of these is
 * something a customer who could set it would be setting their own price with:
 * the promo's value rather than its code, the live demand ratio, and the crane
 * thresholds — where raising `craneFromFloor` prices away a crane the crew will
 * still need on the day.
 */
export interface QuoteInputContext {
  /**
   * The promo the server resolved from `draft.promoCode`. Its code must match
   * what the customer typed; a mismatch is reported rather than priced.
   */
  readonly promo?: PromoInput;
  /** Live supply/demand ratio. The rate card caps it. Never surfaced as a line. */
  readonly demandFactorBps?: Bps;
  /** Ops override for the crane thresholds. */
  readonly craneRules?: CraneRules;
  /**
   * The clock, for a `now` booking. A parameter rather than a read, so the
   * client's preview and the server's authority price the same instant.
   */
  readonly now?: Date;
}

// --- manifest ---------------------------------------------------------------

function basketLines(draft: BookingDraft): ManifestLine[] {
  return draft.basket
    .filter((line) => line.quantity > 0)
    .map((line) =>
      ManifestLineSchema.parse({
        catalogItemId: line.catalogItemId,
        quantity: line.quantity,
        customLabel: line.customLabel,
        stopIndex: line.stopIndex,
      }),
    );
}

function manifestFrom(draft: BookingDraft, lines: readonly ManifestLine[]): Manifest {
  return ManifestSchema.parse({
    lines,
    presetId: draft.presetId,
    // A draft carrying a preset id and no explicit source came off the preset
    // screen. Recording it as `picker` would make the preset-versus-picker
    // accuracy comparison that `source` exists for read systematically low.
    source: draft.source ?? (draft.presetId !== null ? 'preset' : undefined),
  });
}

const EMPTY_BASKET: DraftProblem = {
  code: DraftProblemCode.EmptyBasket,
  path: 'basket',
  message: 'the basket has no items with a quantity above zero',
};

/**
 * The basket as a `Manifest`, or an error.
 *
 * An empty basket is the one incompleteness that cannot be papered over. Every
 * other missing answer has a domain default or a derivation behind it; "nothing
 * to move" has neither, which is what `ManifestSchema`'s `min(1)` already says
 * and what this says with a problem a client can point at a screen.
 *
 * Rows the customer stepped down to zero are dropped rather than rejected —
 * that is how an item is removed — so a basket of nothing but zeroes is empty,
 * not invalid.
 */
export function toManifest(draft: BookingDraft): Manifest {
  const lines = basketLines(draft);
  if (lines.length === 0) throw new DraftIncompleteError([EMPTY_BASKET]);
  return manifestFrom(draft, lines);
}

// --- addresses and access ---------------------------------------------------

function toAddress(draft: DraftAddress, path: string, problems: DraftProblem[]): Address | null {
  const { street, houseNumber, city, coordinates } = draft;

  const missing: string[] = [];
  if (street === null) missing.push('street');
  if (houseNumber === null) missing.push('houseNumber');
  if (city === null) missing.push('city');
  // The pin, not the text, is what the driver is sent to and what the router
  // measures. An address that reads correctly and geocoded to nothing is the
  // one that fails on the morning of the move.
  if (coordinates === null) missing.push('coordinates');

  if (street === null || houseNumber === null || city === null || coordinates === null) {
    problems.push({
      code: DraftProblemCode.MissingAddress,
      path,
      message: `address is incomplete: ${missing.join(', ')}`,
      detail: missing.join(','),
    });
    return null;
  }

  return AddressSchema.parse({
    street,
    houseNumber,
    entrance: draft.entrance,
    apartment: draft.apartment,
    city,
    postalCode: draft.postalCode,
    coordinates,
    placeId: draft.placeId,
    // `formatted` is a display string, so it is built from the parts rather
    // than demanded: a customer who typed the address instead of picking a
    // suggestion has every component and no single-line rendering. Street, then
    // number, then city reads correctly in Hebrew and in English.
    formatted: draft.formatted ?? `${street} ${houseNumber}, ${city}`,
    notes: draft.notes,
  });
}

/**
 * Flights actually walked, when the customer was never asked to count them.
 *
 * `AccessDetailsSchema` keeps `stairFlights` explicit because split-levels and
 * buildings whose lift starts on the first floor break the derivation. This is
 * that derivation anyway, for the ordinary building: a lift that takes
 * furniture removes the walk, and a basement is walked in as many flights as
 * the storey above it.
 */
function derivedStairFlights(floor: number, elevator: ElevatorKind): number {
  if (elevatorTakesFurniture(elevator)) return 0;
  return Math.min(60, Math.abs(floor));
}

function toAccess(
  draft: DraftAccess,
  path: string,
  problems: DraftProblem[],
): AccessDetails | null {
  const { floor, elevator, parking } = draft;

  const missing: string[] = [];
  if (floor === null) missing.push('floor');
  if (elevator === null) missing.push('elevator');
  if (parking === null) missing.push('parking');

  if (floor === null || elevator === null || parking === null) {
    problems.push({
      code: DraftProblemCode.MissingAccess,
      path,
      message: `access details are unanswered: ${missing.join(', ')}`,
      detail: missing.join(','),
    });
    return null;
  }

  return AccessDetailsSchema.parse({
    floor,
    elevator,
    stairFlights: draft.stairFlights ?? derivedStairFlights(floor, elevator),
    parking,
    // Everything below has a domain default, and that default is the right
    // answer to an unasked question. `crane` in particular defaults to
    // `unknown`, which is what blocks a locked quote above a size threshold
    // rather than quietly pricing the job without one.
    carryDistanceMeters: draft.carryDistanceMeters ?? undefined,
    narrowStairwell: draft.narrowStairwell ?? undefined,
    crane: draft.crane ?? undefined,
    permitRequired: draft.permitRequired ?? undefined,
    notes: draft.notes,
  });
}

// --- assembly ---------------------------------------------------------------

interface Assembly {
  readonly problems: readonly DraftProblem[];
  readonly input: QuoteInput | null;
}

function assemble(
  draft: BookingDraft,
  city: CityConfig,
  card: RateCard,
  context: QuoteInputContext,
): Assembly {
  const problems: DraftProblem[] = [];

  if (draft.cityId !== null && draft.cityId !== city.id) {
    problems.push({
      code: DraftProblemCode.CityMismatch,
      path: 'cityId',
      message: `draft was started in "${draft.cityId}" but is being priced against "${city.id}"`,
      detail: draft.cityId,
    });
  }

  // --- basket ---------------------------------------------------------------
  const lines = basketLines(draft);
  if (lines.length === 0) problems.push(EMPTY_BASKET);
  collectRefusals(draft, problems);

  // --- stops ----------------------------------------------------------------
  const stops: QuoteStopInput[] = [];
  let pickups = 0;
  let dropoffs = 0;

  draft.stops.forEach((stop, index) => {
    if (stop.kind === StopKind.Pickup) pickups += 1;
    else dropoffs += 1;

    // The address does not price — `QuoteStopInput` carries access only — but a
    // locked price for a door the crew cannot be sent to is not a price. It is
    // checked here rather than at booking, by which point the customer has
    // already decided to pay.
    toAddress(stop.address, `stops.${index}.address`, problems);
    const access = toAccess(stop.access, `stops.${index}.access`, problems);
    if (access) stops.push({ kind: stop.kind, access });
  });

  if (pickups === 0) {
    problems.push({
      code: DraftProblemCode.MissingPickup,
      path: 'stops',
      message: 'a move needs somewhere to leave from',
    });
  }
  if (dropoffs === 0) {
    problems.push({
      code: DraftProblemCode.MissingDropoff,
      path: 'stops',
      message: 'a move needs somewhere to arrive',
    });
  }

  const at = resolveInstant(draft, context, problems);

  const routedDistanceMeters = draft.routedDistanceMeters;
  if (routedDistanceMeters === null) {
    problems.push({
      code: DraftProblemCode.MissingRoute,
      path: 'routedDistanceMeters',
      message: 'no routed distance — a price is never computed from a straight line',
    });
  }

  // The engine ignores a protection tier it does not recognise, which leaves a
  // customer who ticked full cover paying nothing for it and covered by
  // nothing. Caught here, where the tier id is still attached to the draft that
  // set it.
  const tierId = draft.protectionTierId;
  if (tierId !== null && !card.protectionTiers.some((tier) => tier.id === tierId)) {
    problems.push({
      code: DraftProblemCode.UnknownProtectionTier,
      path: 'protectionTierId',
      message: `rate card ${card.version} does not sell a protection tier "${tierId}"`,
      detail: tierId,
    });
  }

  if (context.promo && context.promo.code !== draft.promoCode) {
    problems.push({
      code: DraftProblemCode.PromoMismatch,
      path: 'promoCode',
      message: `resolved promo "${context.promo.code}" is not the code on the draft (${draft.promoCode ?? 'none'})`,
      detail: context.promo.code,
    });
  }

  // --- truck and crew -------------------------------------------------------
  const manifest = lines.length > 0 ? manifestFrom(draft, lines) : null;
  const totals = manifest ? summariseManifest(manifest, CATALOG_BY_ID) : null;
  const vehicleClassId = resolveVehicleClass(draft, totals, problems);

  if (problems.length > 0 || !manifest || !totals || !vehicleClassId || !at) {
    return { problems, input: null };
  }
  if (routedDistanceMeters === null) return { problems, input: null };

  // The crew the job takes whatever the draft says: the truck's dispatch
  // minimum, and two people for anything one cannot carry. A client-set value
  // is floored by it rather than trusted, because fewer hands is strictly
  // cheaper — labour is crew × minutes while minutes scale as (2/crew)^0.8, so
  // the bill goes as crew^0.2 — and dispatch sends the pair regardless, leaving
  // the driver to work a job priced for half the hands that turn up.
  //
  // Floored quietly, where a too-small truck is reported: this floor moves with
  // the basket, so a "1" answered honestly before the fridge went in is a stale
  // answer rather than a choice, and no screen offers a number below it. The
  // crew that results is on the quote the customer accepts.
  const minCrew = VEHICLE_CLASS_BY_ID.get(vehicleClassId)?.minCrew ?? 1;
  const requiredCrew = Math.max(minCrew, totals.requiresTwoPeople ? 2 : 1);
  const crewSize = Math.max(requiredCrew, draft.crewSize ?? requiredCrew);

  const candidate = {
    cityId: city.id,
    manifest,
    stops,
    routedDistanceMeters,
    vehicleClassId,
    crewSize,
    // Jerusalem local time, and the whole reason this conversion takes a city:
    // `dayKind`, `localHour` and `month` are three readings of one instant in
    // one timezone, and taking any of them off the Date directly produces a
    // quote that is internally consistent and silently wrong.
    schedule: scheduleInputFor(at, city),
    demandFactorBps: context.demandFactorBps,
    promo: context.promo,
    protectionTierId: tierId ?? undefined,
    craneRules: context.craneRules,
  } satisfies QuoteInput;

  // Parsed, not cast. `satisfies` above stops a future field being quietly
  // stubbed; this enforces the bounds the engine and the database assume.
  const input: QuoteInput = QuoteInputSchema.parse(candidate);
  return { problems, input };
}

/**
 * The free-text field is the only place a customer can name anything at all,
 * and the refusal list is otherwise a screen nobody visits. Checked here as the
 * backstop: a client that skipped the check at typing time must not be able to
 * book an LPG cylinder onto an uninsured truck.
 */
function collectRefusals(draft: BookingDraft, problems: DraftProblem[]): void {
  draft.basket.forEach((line, index) => {
    if (line.quantity <= 0 || line.customLabel === null) return;
    const refusal = isRefusedLabel(line.customLabel);
    if (!refusal) return;
    problems.push({
      code: DraftProblemCode.RefusedItem,
      path: `basket.${index}.customLabel`,
      message: `"${line.customLabel}" matches refused item "${refusal.item.id}" on "${refusal.matchedOn}"`,
      detail: refusal.item.id,
    });
  });
}

function resolveInstant(
  draft: BookingDraft,
  context: QuoteInputContext,
  problems: DraftProblem[],
): Date | null {
  if (draft.scheduleKind === null) {
    problems.push({
      code: DraftProblemCode.MissingSchedule,
      path: 'scheduleKind',
      message: 'the customer has not chosen Now or a scheduled slot',
    });
    return null;
  }

  if (draft.scheduleKind === 'now') return context.now ?? new Date();

  if (draft.at === null) {
    problems.push({
      code: DraftProblemCode.MissingSchedule,
      path: 'at',
      message: 'a scheduled booking has no chosen slot',
    });
    return null;
  }
  return new Date(draft.at);
}

/**
 * Which truck this job goes on — the customer's answer, or the load's.
 *
 * A named class is checked, not taken. The base fare is looked up by this id
 * alone, so an unchecked one is a customer setting their own price: an open
 * 2.5m³ pickup carries a whole flat's worth of furniture on paper and prices
 * ₪300 under the van the crew actually sends, and the business is then locked
 * to that number.
 *
 * The check is the same function that produces the recommendation, run against
 * a fleet of one, so there is no second opinion about what "fits" means — the
 * 25% headroom that keeps a job off a second trip applies to a truck the
 * customer picked exactly as it applies to the one we would have picked. Bigger
 * than recommended always passes: choosing up is the customer's to make, and
 * they are paying for it.
 */
function resolveVehicleClass(
  draft: BookingDraft,
  totals: ReturnType<typeof summariseManifest> | null,
  problems: DraftProblem[],
): VehicleClassId | null {
  if (!totals) return null;

  // Volume and weight only. A crane is a third party's call-out priced on its
  // own bands, not a reason to put the job on a crane truck and charge that
  // truck's base fare as well.
  const recommended = recommendVehicleClass(totals, VEHICLE_CLASSES);
  if (!recommended) {
    problems.push({
      code: DraftProblemCode.NoVehicleClassFits,
      path: 'basket',
      message: `no vehicle class carries ${totals.totalVolumeM3}m³ / ${totals.totalWeightKg}kg — this job needs a human`,
    });
    return null;
  }

  const chosen = draft.vehicleClassId;
  if (chosen === null) return recommended.id;

  const inFleet = VEHICLE_CLASS_BY_ID.get(chosen);
  if (inFleet && recommendVehicleClass(totals, [inFleet])) return chosen;

  // Reported rather than silently upgraded. The customer chose this truck off a
  // screen of real dimensions, and the class decides the base fare — swapping it
  // behind them would change the price they are about to accept without saying
  // so. `detail` is the smallest class that does carry it, so the client can
  // offer that swap as the answer instead of an error.
  problems.push({
    code: DraftProblemCode.VehicleClassTooSmall,
    path: 'vehicleClassId',
    message: `vehicle class "${chosen}" does not carry ${totals.totalVolumeM3}m³ / ${totals.totalWeightKg}kg — the smallest that does is "${recommended.id}"`,
    detail: recommended.id,
  });
  return null;
}

// --- the public conversions -------------------------------------------------

/**
 * Everything still standing between this draft and a price.
 *
 * The non-throwing half of `toQuoteInput`, sharing its implementation so the
 * "what's left" indicator on the customer's screen and the server's refusal to
 * quote cannot disagree. Pass the same context to both, or the server will see
 * a problem the client never showed.
 *
 * An empty array means the draft prices. It does not mean the customer will
 * like the price, or that a driver exists — those are later questions.
 */
export function draftProblems(
  draft: BookingDraft,
  city: CityConfig,
  card: RateCard,
  context: QuoteInputContext = {},
): readonly DraftProblem[] {
  return assemble(draft, city, card, context).problems;
}

/**
 * The only place a draft becomes a `QuoteInput`.
 *
 * Fails loudly — `DraftIncompleteError`, carrying the problem list — because
 * the alternative failure is silent: a missing floor defaulting to zero and a
 * missing lift defaulting to "there is one" produce a perfectly well-formed
 * quote for a sixth-floor walk-up, which reconciles, prices, books, and is
 * discovered by a crew standing in a stairwell.
 *
 * Everything the customer cannot be trusted to set — the promo's value, the
 * demand ratio, the crane thresholds — arrives in `context` rather than off the
 * draft, and the clock for a `now` booking arrives there too so that the
 * preview and the authority price the same instant.
 */
export function toQuoteInput(
  draft: BookingDraft,
  city: CityConfig,
  card: RateCard,
  context: QuoteInputContext = {},
): QuoteInput {
  const { problems, input } = assemble(draft, city, card, context);
  if (!input) throw new DraftIncompleteError(problems);
  return input;
}

/**
 * The draft's stops as domain `Stop`s, in array order.
 *
 * The companion to `toQuoteInput` on the booking path: a price needs the access
 * details, a job needs the addresses and the person to call. Array position
 * becomes `index`, which is why the draft carries no index of its own, and the
 * contact number is normalised to E.164 here — the one boundary where a
 * half-typed number becomes a real one or nothing.
 */
export function toStops(draft: BookingDraft): Stop[] {
  const problems: DraftProblem[] = [];
  const stops: Stop[] = [];

  draft.stops.forEach((stop, index) => {
    const address = toAddress(stop.address, `stops.${index}.address`, problems);
    const access = toAccess(stop.access, `stops.${index}.access`, problems);
    if (!address || !access) return;
    stops.push(
      StopSchema.parse({
        index,
        kind: stop.kind,
        address,
        access,
        contactName: stop.contactName,
        contactPhone: stop.contactPhone,
      }),
    );
  });

  if (problems.length > 0) throw new DraftIncompleteError(problems);
  return stops;
}
