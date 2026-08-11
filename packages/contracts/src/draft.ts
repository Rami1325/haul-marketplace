import {
  CraneNeedSchema,
  ElevatorKindSchema,
  LatLngSchema,
  LocaleSchema,
  ParkingSituationSchema,
  ScheduleKindSchema,
  StopKind,
  StopKindSchema,
  VehicleClassIdSchema,
  isIsraeliMobile,
} from '@haul/types';
import { z } from 'zod';

/**
 * ---------------------------------------------------------------------------
 * The booking draft — a form in progress
 * ---------------------------------------------------------------------------
 * A draft is partial by definition. A customer three taps into the flow has an
 * empty basket, no address and no date, and the domain schemas cannot say that:
 * `ManifestSchema` demands at least one line, `AddressSchema` demands a street
 * and a house number and a coordinate, `AccessDetailsSchema` demands a floor
 * and a lift and a parking situation. Every one of those refusals is correct —
 * they describe a job, and half a job is not a job — which is exactly why the
 * thing a customer is holding halfway through cannot be one of them.
 *
 * So this is a separate shape, and every answer on it is nullable. `null` means
 * "not answered yet". It is `toQuoteInput` in `to-quote-input.ts` that turns a
 * complete draft into a real, branded, fully-defaulted `QuoteInput`, or refuses
 * with a list of what is still missing. That conversion is the only place the
 * two vocabularies meet.
 *
 * THE RULE THIS SCHEMA FOLLOWS: **a draft relaxes presence, never validity.**
 * Where a domain field is bounded, the draft field carries the identical bound.
 * A draft that can hold a 400-character street name is a draft that saves
 * cleanly for a week and then fails at the moment the customer taps Book, with
 * a Zod path instead of a sentence. Absence is the only thing this schema is
 * more permissive about, because absence is the only thing a half-filled form
 * legitimately has.
 *
 * The draft is also written against the INPUT side of those schemas rather than
 * their output. `z.coerce.date()` yields a `Date`, `AgorotSchema` yields a
 * branded integer, `IsraeliMobileSchema` yields a normalised E.164 string and
 * throws on anything else — none of which survives a round trip through a jsonb
 * column, and the last of which would make a half-typed phone number a save
 * failure. What is stored here is what a JSON document can hold: strings,
 * numbers, booleans, nulls.
 *
 * `version` is a literal because this blob outlives the commit that wrote it.
 * A row written today gets read by code that has moved on, and a draft with no
 * version stamp is a migration nobody can write.
 * ---------------------------------------------------------------------------
 */

export const BOOKING_DRAFT_VERSION = 1;

/**
 * A free-text answer on a draft: trimmed, length-bounded exactly as the domain
 * field is, and blank collapsed to null.
 *
 * The collapse is the load-bearing part. A form posts `''` for a field the
 * customer tabbed through, and without this the draft holds an empty string —
 * which reads as "answered" to every `!== null` check, and then fails the
 * domain's `.min(1)` at quote time as a validation error rather than as an
 * unanswered question. Those two states have completely different copy.
 */
function draftText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((value) => (value === null || value.length === 0 ? null : value));
}

/**
 * Where the driver is going, as far as the customer has got.
 *
 * Mirrors `AddressSchema` field for field so that a complete draft address is
 * assignable to that schema's input. `postalCode` keeps the domain's own regex
 * rather than accepting any string: it is optional in the domain and never
 * affects a price, so a malformed one would sit in the draft unnoticed and then
 * throw from inside the conversion, which is the one place a draft problem is
 * supposed to arrive as a listed problem instead of an exception.
 */
export const DraftAddressSchema = z.object({
  street: draftText(200),
  houseNumber: draftText(20),
  entrance: draftText(20),
  apartment: draftText(20),
  city: draftText(120),
  postalCode: draftText(10).refine(
    (value) => value === null || /^\d{5}(\d{2})?$/.test(value),
    'Israeli postal codes are 5 or 7 digits',
  ),
  /**
   * Atomic: a pin is either resolved or it is not, so there is no partial form
   * of it and `LatLngSchema` is reused rather than restated.
   */
  coordinates: LatLngSchema.nullable().default(null),
  placeId: draftText(300),
  formatted: draftText(500),
  notes: draftText(500),
});
export type DraftAddress = z.infer<typeof DraftAddressSchema>;

/**
 * The four taps that make the price honest, before the customer has made them.
 *
 * Which nulls here are fatal is decided in `to-quote-input.ts` by one rule: a
 * field the domain schema defaults is an unanswered question with a safe answer
 * (`crane` defaults to `unknown`, which is precisely what an unanswered crane
 * question means), and a field the domain schema requires is a missing answer.
 */
export const DraftAccessSchema = z.object({
  floor: z.number().int().min(-5).max(60).nullable().default(null),
  elevator: ElevatorKindSchema.nullable().default(null),
  stairFlights: z.number().int().min(0).max(60).nullable().default(null),
  carryDistanceMeters: z.number().int().min(0).max(1000).nullable().default(null),
  parking: ParkingSituationSchema.nullable().default(null),
  narrowStairwell: z.boolean().nullable().default(null),
  crane: CraneNeedSchema.nullable().default(null),
  permitRequired: z.boolean().nullable().default(null),
  notes: draftText(500),
});
export type DraftAccess = z.infer<typeof DraftAccessSchema>;

/**
 * A phone number as typed, checked but not normalised.
 *
 * `IsraeliMobileSchema` is a transform that rejects anything it cannot turn
 * into E.164, so putting it on a draft would make a save fail. This checks the
 * same predicate without rewriting the value, and the normalisation happens
 * once, at the booking boundary, where the number is about to be used.
 */
function draftPhone() {
  return draftText(20).refine(
    (value) => value === null || isIsraeliMobile(value),
    'not a valid Israeli mobile number',
  );
}

/**
 * One end of the move.
 *
 * `kind` is the one field the customer never fills in — the flow creates a
 * pickup row and a dropoff row and the customer fills them — so it is the one
 * required field on a draft stop. There is deliberately no `index`: the array
 * position is the index, and carrying both invites them to disagree after a
 * reorder.
 */
export const DraftStopSchema = z.object({
  kind: StopKindSchema,
  address: DraftAddressSchema.default(() => DraftAddressSchema.parse({})),
  access: DraftAccessSchema.default(() => DraftAccessSchema.parse({})),
  /** Often not the booker — a partner, a parent, a shop assistant. */
  contactName: draftText(120),
  contactPhone: draftPhone(),
});
export type DraftStop = z.infer<typeof DraftStopSchema>;

/**
 * One row in the basket.
 *
 * Quantity may be zero. A stepper reaching zero is how a customer removes an
 * item, and a schema that refuses to store that state forces the client to
 * decide whether zero means "remove the row" or "reject the tap" — a decision
 * that would then be made differently on web and on mobile. `toManifest` drops
 * zero-quantity rows, so there is exactly one answer.
 */
export const DraftBasketLineSchema = z.object({
  catalogItemId: z.string().min(1).max(64),
  quantity: z.number().int().min(0).max(999),
  /** Typed by the customer for something the catalog does not have. */
  customLabel: draftText(200),
  /** Which stop this item belongs to, by array position in `stops`. */
  stopIndex: z.number().int().min(0).max(20).default(0),
});
export type DraftBasketLine = z.infer<typeof DraftBasketLineSchema>;

export const BookingDraftSchema = z.object({
  /**
   * Stored as jsonb and read back by code that has moved on. Bump this and
   * write the migration; do not quietly reinterpret a field.
   */
  version: z.literal(BOOKING_DRAFT_VERSION),

  /**
   * Which city's rate card and calendar this draft is being priced against.
   *
   * Kept on the draft even though `toQuoteInput` is handed the city, because a
   * stored blob has to be interpretable on its own — it is what selects the
   * city in the first place. The conversion refuses a mismatch rather than
   * trusting either side.
   */
  cityId: draftText(64),
  /** Which language the customer is booking in. Drives the copy on the way back. */
  locale: LocaleSchema.default('he'),

  basket: z
    .array(DraftBasketLineSchema)
    .max(500)
    .default(() => []),
  /** Which preset seeded the basket, if any. */
  presetId: draftText(64),
  /** How the basket was built. Null means the client did not say. */
  source: z.enum(['picker', 'preset', 'scan', 'ops']).nullable().default(null),

  stops: z
    .array(DraftStopSchema)
    .max(20)
    .default(() => []),

  /**
   * Now or Later, unset until the customer chooses.
   *
   * There is no default, and that is deliberate: roughly seven in ten moves are
   * planned rather than spontaneous, and defaulting an unanswered draft to
   * `now` would put a thumb on the scale in the schema as well as on the screen.
   */
  scheduleKind: ScheduleKindSchema.nullable().default(null),
  /**
   * Start of the chosen arrival window, ISO-8601 with an offset or a `Z`.
   *
   * A string rather than a `Date` because this is a jsonb document; the
   * conversion parses it once. Only the start is stored — the window's end is a
   * dispatch promise made at booking from the slot length, and a copy of it
   * here would be a second number free to disagree with the first.
   */
  at: z.iso.datetime({ offset: true }).nullable().default(null),

  /**
   * Routed metres between the stops, from `@haul/geo`. Never straight-line.
   *
   * On the draft because the client routes as the addresses are entered and the
   * customer sees the distance in the preview; the server re-routes and
   * re-prices from the stored draft, so this is a client's answer that the
   * server is free to overwrite, never a price input the server trusts.
   */
  routedDistanceMeters: z.number().int().min(0).max(1_000_000).nullable().default(null),

  /**
   * Set only when the customer overrode the recommendation, and only ever
   * upward — the conversion refuses a class that cannot carry the basket rather
   * than charging that class's base fare for it. Null means "pick the truck
   * that fits", which is what the conversion does.
   */
  vehicleClassId: VehicleClassIdSchema.nullable().default(null),
  /**
   * Set only when the customer asked for more hands than the job implies. The
   * "more" is enforced at conversion, not here: the number is floored by the
   * truck's minimum crew and by what the load cannot be carried without.
   */
  crewSize: z.number().int().min(1).max(6).nullable().default(null),

  protectionTierId: draftText(64),
  /**
   * The code the customer typed, and nothing else.
   *
   * What it is worth is a server fact — is it live, has this customer used it,
   * does it apply to this city — so the amount never appears on a draft. A
   * draft that could carry the discount would be a draft that could set it.
   */
  promoCode: draftText(64),

  /** Who to call on the day. Normalised to E.164 at booking, not here. */
  contactName: draftText(120),
  contactPhone: draftPhone(),
});
export type BookingDraft = z.infer<typeof BookingDraftSchema>;

/**
 * A stop with nothing answered yet.
 *
 * Exported because the flow adds stops — a second dropoff is a first-class
 * case, not an edge one — and every surface that adds one has to start from the
 * same empty shape or the drafts diverge by client.
 */
export function newDraftStop(kind: StopKind): DraftStop {
  return DraftStopSchema.parse({ kind });
}

/**
 * An empty draft, seeded with the two stops every move has.
 *
 * The pickup and the dropoff exist from the first render because they are the
 * shape of the form, not an answer to it. `stops` still defaults to empty in
 * the schema, so a blob written by something other than this function — an ops
 * console, a replayed row, a test — still parses.
 */
export function newBookingDraft(
  cityId: string,
  locale: BookingDraft['locale'] = 'he',
): BookingDraft {
  return BookingDraftSchema.parse({
    version: BOOKING_DRAFT_VERSION,
    cityId,
    locale,
    stops: [{ kind: StopKind.Pickup }, { kind: StopKind.Dropoff }],
  });
}
