import { z } from 'zod';

/**
 * ---------------------------------------------------------------------------
 * Access details — the four taps that make the price honest
 * ---------------------------------------------------------------------------
 * Two jobs with identical addresses can differ by four hours and ₪400 based on
 * what is between the truck and the door. This is the cheapest signal we will
 * ever collect and the highest-leverage input to estimated working minutes.
 *
 * Israel-specific, and easy to miss in a generic moving app:
 *
 *  - Elevator size is not a boolean. A great many Israeli buildings have a
 *    מעלית קטנה that takes four people and no sofa. "Has elevator: yes" is a
 *    lie that costs an hour of stair-carrying.
 *  - The crane (מנוף) is standard practice, not an exotic add-on. Stairwells in
 *    older Tel Aviv buildings will not pass a double bed, so it goes over the
 *    balcony. Generic moving apps do not model this at all.
 *  - Blocking a street for a truck or crane needs a municipal permit in most
 *    Israeli cities. Discovering that on the morning of the move is how a
 *    locked price gets broken.
 * ---------------------------------------------------------------------------
 */

export const ElevatorKind = {
  /** No lift. Everything walks. */
  None: 'none',
  /** מעלית קטנה — people fit, furniture doesn't. Treated as None for large items. */
  Small: 'small',
  /** Standard residential lift — most furniture fits, a wardrobe might not. */
  Standard: 'standard',
  /** מעלית שירות / goods lift — fits essentially anything. */
  Service: 'service',
} as const;
export type ElevatorKind = (typeof ElevatorKind)[keyof typeof ElevatorKind];
export const ElevatorKindSchema = z.enum([
  ElevatorKind.None,
  ElevatorKind.Small,
  ElevatorKind.Standard,
  ElevatorKind.Service,
]);

export const ParkingSituation = {
  /** Private driveway or yard — truck parks at the door. */
  Driveway: 'driveway',
  /** Street parking normally available within a few metres. */
  StreetEasy: 'street_easy',
  /** Contested street parking — the Tel Aviv default. Expect a walk. */
  StreetHard: 'street_hard',
  /** Underground or paid lot, often with a height limit that excludes a box truck. */
  PaidLot: 'paid_lot',
  /** Nowhere legal to stop. Needs a permit or a plan. */
  None: 'none',
} as const;
export type ParkingSituation = (typeof ParkingSituation)[keyof typeof ParkingSituation];
export const ParkingSituationSchema = z.enum([
  ParkingSituation.Driveway,
  ParkingSituation.StreetEasy,
  ParkingSituation.StreetHard,
  ParkingSituation.PaidLot,
  ParkingSituation.None,
]);

export const CraneNeed = {
  NotNeeded: 'not_needed',
  /** We think it's needed from the manifest and access; customer can decline. */
  Recommended: 'recommended',
  /** Customer or ops confirmed it. Priced in and dispatched to a crane-equipped truck. */
  Required: 'required',
  /** Not yet assessed. Blocks a locked quote above a size threshold. */
  Unknown: 'unknown',
} as const;
export type CraneNeed = (typeof CraneNeed)[keyof typeof CraneNeed];
export const CraneNeedSchema = z.enum([
  CraneNeed.NotNeeded,
  CraneNeed.Recommended,
  CraneNeed.Required,
  CraneNeed.Unknown,
]);

export const AccessDetailsSchema = z.object({
  /** 0 = קומת קרקע. Negative for basement levels. */
  floor: z.number().int().min(-5).max(60),

  elevator: ElevatorKindSchema,

  /**
   * Flights of stairs that must actually be walked. Usually derived from floor
   * and elevator, but kept explicit because split-levels and buildings with a
   * lift that starts on floor 1 are common and the derivation gets them wrong.
   */
  stairFlights: z.number().int().min(0).max(60),

  /** Truck to door, in metres. Beyond ~25m this starts costing real minutes. */
  carryDistanceMeters: z.number().int().min(0).max(1000).default(0),

  parking: ParkingSituationSchema,

  /** Stairwell too tight for a double bed or a three-seater. Drives crane need. */
  narrowStairwell: z.boolean().default(false),

  crane: CraneNeedSchema.default(CraneNeed.Unknown),

  /**
   * Municipal street-closure / crane permit. True means someone must file it —
   * a real dependency on the job, and an ops task, not a surcharge line.
   */
  permitRequired: z.boolean().default(false),

  /** Free text the driver reads before arriving. */
  notes: z.string().max(500).nullable().default(null),
});
export type AccessDetails = z.infer<typeof AccessDetailsSchema>;

/**
 * Whether the lift can be relied on for furniture. A `small` lift is worse than
 * useless for planning: it tempts the customer to answer "yes, there's an
 * elevator" and then the crew carries a wardrobe down six flights.
 */
export function elevatorTakesFurniture(kind: ElevatorKind): boolean {
  return kind === ElevatorKind.Standard || kind === ElevatorKind.Service;
}

/**
 * Effective flights to carry. An elevator that doesn't take furniture doesn't
 * reduce the walk for the items that matter.
 */
export function effectiveStairFlights(access: AccessDetails): number {
  if (elevatorTakesFurniture(access.elevator)) return 0;
  return access.stairFlights;
}

/** Convenience default for the ground-floor, easy-parking best case. */
export function groundFloorAccess(overrides: Partial<AccessDetails> = {}): AccessDetails {
  return AccessDetailsSchema.parse({
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
  });
}
