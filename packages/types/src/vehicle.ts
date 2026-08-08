import { z } from 'zod';

/**
 * ---------------------------------------------------------------------------
 * Vehicle classes
 * ---------------------------------------------------------------------------
 * Show real dimensions
 * and payload, not a cartoon van. "Will it fit?" is the anxiety, and a number
 * answers it better than an illustration does.
 *
 * Class names follow what Israeli drivers actually call these vehicles, because
 * the driver-side copy has to read as native or supply won't sign up.
 * ---------------------------------------------------------------------------
 */

export const VehicleClassId = {
  /** טנדר — open pickup. Cheap, fast, weather-exposed. */
  Pickup: 'pickup',
  /** מסחרית קטנה — small closed van, Berlingo/Partner class. */
  SmallVan: 'small_van',
  /** מסחרית — full panel van, Transit/Sprinter class. The workhorse. */
  Van: 'van',
  /** משאית 4 טון — 4-tonne box truck. Standard for a whole-apartment move. */
  BoxTruck4t: 'box_truck_4t',
  /** משאית 8 טון — 8-tonne box truck. Large apartments and small commercial. */
  BoxTruck8t: 'box_truck_8t',
  /** משאית עם מנוף — truck with a hydraulic furniture crane. */
  CraneTruck: 'crane_truck',
} as const;
export type VehicleClassId = (typeof VehicleClassId)[keyof typeof VehicleClassId];
export const VehicleClassIdSchema = z.enum([
  VehicleClassId.Pickup,
  VehicleClassId.SmallVan,
  VehicleClassId.Van,
  VehicleClassId.BoxTruck4t,
  VehicleClassId.BoxTruck8t,
  VehicleClassId.CraneTruck,
]);

export const VehicleClassSchema = z.object({
  id: VehicleClassIdSchema,

  nameHe: z.string().min(1).max(80),
  nameEn: z.string().min(1).max(80),

  /**
   * Plain-language capacity:
   * "מתאים לדירת 2 חדרים" beats "18 m³" for a nervous first-time customer.
   * Both are shown — this one first.
   */
  capacityCopyHe: z.string().max(200),
  capacityCopyEn: z.string().max(200),

  /** Usable cargo volume in m³. */
  cargoVolumeM3: z.number().min(0).max(120),
  /** Usable payload in kg. */
  payloadKg: z.number().min(0).max(20000),

  /** Internal cargo bay dimensions in cm — answers "will the wardrobe fit?". */
  cargoLengthCm: z.number().int().min(0).max(1500),
  cargoWidthCm: z.number().int().min(0).max(400),
  cargoHeightCm: z.number().int().min(0).max(400),

  /** Enclosed body. An open pickup in Israeli winter is a real constraint. */
  isEnclosed: z.boolean(),

  /** Carries a hydraulic crane for balcony hoists. */
  hasCrane: z.boolean().default(false),

  /**
   * Total vehicle height in cm. Underground car parks in Israel are commonly
   * capped around 200cm, which silently rules out every box truck.
   */
  vehicleHeightCm: z.number().int().min(0).max(500),

  /** Minimum crew this vehicle is dispatched with, driver included. */
  minCrew: z.number().int().min(1).max(6).default(1),

  /** Israeli licence category required to drive it. Gates driver eligibility. */
  requiredLicenceCategory: z.enum(['B', 'C1', 'C']).default('B'),

  sortOrder: z.number().int().default(0),
});
export type VehicleClass = z.infer<typeof VehicleClassSchema>;

/**
 * Pick the smallest class that fits, with headroom. Under-trucking is the more
 * expensive mistake: a second trip destroys the locked price and the driver's
 * day, whereas a slightly larger truck costs a few shekels.
 */
export function recommendVehicleClass(
  totals: { totalVolumeM3: number; totalWeightKg: number },
  classes: readonly VehicleClass[],
  options: { headroom?: number; requireEnclosed?: boolean; requireCrane?: boolean } = {},
): VehicleClass | null {
  const { headroom = 1.25, requireEnclosed = false, requireCrane = false } = options;

  const neededVolume = totals.totalVolumeM3 * headroom;
  const neededWeight = totals.totalWeightKg * headroom;

  const eligible = classes
    .filter((c) => (requireEnclosed ? c.isEnclosed : true))
    .filter((c) => (requireCrane ? c.hasCrane : true))
    .filter((c) => c.cargoVolumeM3 >= neededVolume && c.payloadKg >= neededWeight)
    .sort((a, b) => a.cargoVolumeM3 - b.cargoVolumeM3);

  return eligible[0] ?? null;
}
