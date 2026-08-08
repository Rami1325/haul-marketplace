import { z } from 'zod';

/**
 * ---------------------------------------------------------------------------
 * Item catalog & manifest
 * ---------------------------------------------------------------------------
 * The manifest is what separates HAUL from the "instant estimate" apps. They
 * ask how big a truck you want; we ask what you own. A quote built from a real
 * inventory can be held. A quote built from a dropdown cannot.
 *
 * Volumes are cubic metres and weights are kilograms — Israel is metric, and
 * the plan's cubic-feet framing is a US artefact.
 * ---------------------------------------------------------------------------
 */

export const ItemCategory = {
  Furniture: 'furniture',
  Appliance: 'appliance',
  Boxes: 'boxes',
  Electronics: 'electronics',
  Outdoor: 'outdoor',
  Fitness: 'fitness',
  Special: 'special',
  Other: 'other',
} as const;
export type ItemCategory = (typeof ItemCategory)[keyof typeof ItemCategory];
export const ItemCategorySchema = z.enum([
  ItemCategory.Furniture,
  ItemCategory.Appliance,
  ItemCategory.Boxes,
  ItemCategory.Electronics,
  ItemCategory.Outdoor,
  ItemCategory.Fitness,
  ItemCategory.Special,
  ItemCategory.Other,
]);

export const CatalogItemSchema = z.object({
  id: z.string().min(1).max(64),
  category: ItemCategorySchema,

  /** Hebrew is the primary label — this is a Hebrew-first product. */
  nameHe: z.string().min(1).max(120),
  nameEn: z.string().min(1).max(120),

  /** Search aliases, both languages. "ספה", "sofa", "couch", "מזרן". */
  aliases: z.array(z.string().max(60)).max(30).default([]),

  /** Packed volume in m³. The primary driver of which truck is recommended. */
  volumeM3: z.number().min(0).max(50),

  /** Typical weight in kg. Drives crew size and whether one person can lift it. */
  weightKg: z.number().min(0).max(2000),

  /**
   * Baseline minutes for a two-person crew to carry this item on the flat, with
   * no stairs. Access multipliers are applied on top in the pricing engine.
   * Calibrate from Phase 0 data — these start as informed estimates.
   */
  handlingMinutes: z.number().min(0).max(240),

  /** Cannot be moved safely by one person. Forces a minimum crew size. */
  requiresTwoPeople: z.boolean().default(false),

  /**
   * Realistically will not go down an Israeli stairwell — a three-seater, a
   * double bed base, a full-height wardrobe. Presence of these plus a narrow
   * stairwell is what triggers a crane recommendation.
   */
  craneCandidate: z.boolean().default(false),

  /** Glass, screens, art. Drives packing time and protection-tier messaging. */
  fragile: z.boolean().default(false),

  /**
   * Priced as a named surcharge rather than by volume — piano, safe, treadmill.
   * These are the items that turn a normal job into a specialist one.
   */
  heavyItemSurchargeKey: z.string().max(64).nullable().default(null),

  /** Icon key for the visual picker. */
  icon: z.string().max(64).default('box'),

  /** Shown in the first-screen grid without searching. */
  isCommon: z.boolean().default(false),
});
export type CatalogItem = z.infer<typeof CatalogItemSchema>;

export const ManifestLineSchema = z.object({
  catalogItemId: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(999),

  /**
   * Customer-typed description for an item not in the catalog. Present only for
   * the `other` catalog entry. Every one of these is a signal about what the
   * catalog is missing — mine them.
   */
  customLabel: z.string().max(200).nullable().default(null),

  /** Which end of the job this item belongs to, for multi-stop manifests. */
  stopIndex: z.number().int().min(0).max(20).default(0),

  /** Set by the driver during the job when an item wasn't on the original list. */
  addedDuringJob: z.boolean().default(false),

  /** Ticked off as loaded. Drives the customer's live checklist. */
  loadedAt: z.coerce.date().nullable().default(null),
  unloadedAt: z.coerce.date().nullable().default(null),
});
export type ManifestLine = z.infer<typeof ManifestLineSchema>;

export const ManifestSchema = z.object({
  lines: z.array(ManifestLineSchema).min(1).max(500),
  /** Which preset seeded this manifest, if any. Purely analytical. */
  presetId: z.string().max(64).nullable().default(null),
  /**
   * How the manifest was built. Phase 1 is `picker` only; `scan` arrives in
   * Phase 2 and we want the accuracy of the two to be comparable from day one.
   */
  source: z.enum(['picker', 'preset', 'scan', 'ops']).default('picker'),
});
export type Manifest = z.infer<typeof ManifestSchema>;

/**
 * Preset bundles for the first screen.
 *
 * Named in Israeli convention: apartments here are counted by *total* rooms
 * including the living room, so a "2-bedroom" in the plan is a דירת 3 חדרים on
 * every listing site in the country. Getting this wrong makes the first screen
 * read as a foreign product.
 */
export const ManifestPresetSchema = z.object({
  id: z.string().min(1).max(64),
  nameHe: z.string().min(1).max(120),
  nameEn: z.string().min(1).max(120),
  descriptionHe: z.string().max(300),
  descriptionEn: z.string().max(300),
  icon: z.string().max(64),
  lines: z.array(z.object({ catalogItemId: z.string(), quantity: z.number().int().min(1) })),
  sortOrder: z.number().int().default(0),
});
export type ManifestPreset = z.infer<typeof ManifestPresetSchema>;

// --- derived totals ---------------------------------------------------------

export interface ManifestTotals {
  readonly totalVolumeM3: number;
  readonly totalWeightKg: number;
  readonly itemCount: number;
  readonly distinctItemCount: number;
  readonly baseHandlingMinutes: number;
  readonly heaviestItemKg: number;
  readonly requiresTwoPeople: boolean;
  readonly hasCraneCandidate: boolean;
  /**
   * Volume of items that realistically will not go down an Israeli stairwell.
   * This is what actually gets hoisted, and what the crane is priced against —
   * not the whole load.
   */
  readonly craneCandidateVolumeM3: number;
  readonly heavyItemKeys: readonly string[];
}

/**
 * Roll a manifest up against a catalog. Unknown item ids are skipped rather than
 * thrown on — a stale client should never be able to make the server refuse to
 * quote — but the caller gets them back so the mismatch can be logged.
 */
export function summariseManifest(
  manifest: Manifest,
  catalog: ReadonlyMap<string, CatalogItem>,
): ManifestTotals & { unknownItemIds: string[] } {
  let totalVolumeM3 = 0;
  let totalWeightKg = 0;
  let itemCount = 0;
  let baseHandlingMinutes = 0;
  let heaviestItemKg = 0;
  let requiresTwoPeople = false;
  let hasCraneCandidate = false;
  let craneCandidateVolumeM3 = 0;
  const heavyItemKeys: string[] = [];
  const unknownItemIds: string[] = [];
  const distinct = new Set<string>();

  for (const line of manifest.lines) {
    const item = catalog.get(line.catalogItemId);
    if (!item) {
      unknownItemIds.push(line.catalogItemId);
      continue;
    }
    distinct.add(item.id);
    itemCount += line.quantity;
    totalVolumeM3 += item.volumeM3 * line.quantity;
    totalWeightKg += item.weightKg * line.quantity;
    baseHandlingMinutes += item.handlingMinutes * line.quantity;
    if (item.weightKg > heaviestItemKg) heaviestItemKg = item.weightKg;
    if (item.requiresTwoPeople) requiresTwoPeople = true;
    if (item.craneCandidate) {
      hasCraneCandidate = true;
      craneCandidateVolumeM3 += item.volumeM3 * line.quantity;
    }
    if (item.heavyItemSurchargeKey) {
      for (let i = 0; i < line.quantity; i++) heavyItemKeys.push(item.heavyItemSurchargeKey);
    }
  }

  return {
    totalVolumeM3: round2(totalVolumeM3),
    totalWeightKg: Math.round(totalWeightKg),
    itemCount,
    distinctItemCount: distinct.size,
    baseHandlingMinutes: Math.round(baseHandlingMinutes),
    heaviestItemKg: Math.round(heaviestItemKg),
    requiresTwoPeople,
    hasCraneCandidate,
    craneCandidateVolumeM3: round2(craneCandidateVolumeM3),
    heavyItemKeys,
    unknownItemIds,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
