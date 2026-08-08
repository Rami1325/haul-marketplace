import {
  CatalogItemSchema,
  ManifestPresetSchema,
  VehicleClassSchema,
  type CatalogItem,
  type ManifestPreset,
  type VehicleClass,
} from '@haul/types';
import catalogData from './data/catalog.json' with { type: 'json' };
import presetData from './data/presets.json' with { type: 'json' };
import vehicleData from './data/vehicles.json' with { type: 'json' };

/**
 * ---------------------------------------------------------------------------
 * The item catalog
 * ---------------------------------------------------------------------------
 * Every item HAUL knows how to price, in Hebrew first.
 *
 * Parsed through the Zod schemas at module load rather than trusted. The data
 * is authored and edited by people, and a catalog row with a missing volume is
 * a quote that is silently wrong rather than a crash — which is the worse
 * failure for a product whose promise is that the number is right.
 *
 * `craneCandidate` is DERIVED, not hand-set. An adversarial audit of the first
 * draft found the flag had been set per-row by different authors, producing a
 * 42kg mattress that needed a crane and an 80kg two-door fridge that did not.
 * The crane is the largest single line on an Israeli move, so that flag being
 * noise was the most expensive defect in the catalog. The rule is now:
 *
 *   volume ≥ 0.8 m³ OR weight ≥ 70 kg, unless the item is flexible
 *   (mattresses, rugs — they bend around a stairwell at any size),
 *   plus an explicit include for facade-mounted items (AC compressors,
 *   solar collectors and tanks) which are reached by rope regardless of size.
 * ---------------------------------------------------------------------------
 */

export const CATALOG: readonly CatalogItem[] = CatalogItemSchema.array().parse(catalogData);

export const CATALOG_BY_ID: ReadonlyMap<string, CatalogItem> = new Map(
  CATALOG.map((item) => [item.id, item]),
);

export const MANIFEST_PRESETS: readonly ManifestPreset[] =
  ManifestPresetSchema.array().parse(presetData);

export const VEHICLE_CLASSES: readonly VehicleClass[] =
  VehicleClassSchema.array().parse(vehicleData);

export const VEHICLE_CLASS_BY_ID: ReadonlyMap<string, VehicleClass> = new Map(
  VEHICLE_CLASSES.map((v) => [v.id, v]),
);

/**
 * Items surfaced in the first-screen grid without searching.
 *
 * The plan's third differentiator: open with what's in the customer's head —
 * a fridge and eleven boxes — rather than "where from?".
 */
export const COMMON_ITEMS: readonly CatalogItem[] = CATALOG.filter((item) => item.isCommon);

/**
 * Things HAUL will not carry.
 *
 * LPG cylinders (בלון גז) are dangerous goods, and goods-in-transit insurers
 * generally exclude them. Carrying one uninsured is the plan's single biggest
 * existential risk in miniature, so it is refused explicitly and visibly rather
 * than left as a catalog row nobody thought about.
 */
export const REFUSED_ITEMS: ReadonlyArray<{ id: string; nameHe: string; reasonHe: string }> = [
  {
    id: 'gas_balloon',
    nameHe: 'בלון גז',
    reasonHe: 'חומר מסוכן — לא מבוטח בהובלה. יש לתאם החלפה מול חברת הגז.',
  },
  {
    id: 'hazardous_chemicals',
    nameHe: 'חומרים דליקים או מסוכנים',
    reasonHe: 'דלק, ממסים וחומרי הדברה אינם מכוסים בביטוח מטענים.',
  },
  {
    id: 'live_animals',
    nameHe: 'בעלי חיים',
    reasonHe: 'לא ניתן להוביל בעלי חיים במשאית הובלה.',
  },
];

/** Free-text search across Hebrew, English and aliases. */
export function searchCatalog(query: string, limit = 20): CatalogItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...COMMON_ITEMS].slice(0, limit);

  const scored: Array<{ item: CatalogItem; score: number }> = [];
  for (const item of CATALOG) {
    const haystacks = [item.nameHe, item.nameEn, ...item.aliases];
    let best = 0;
    for (const hay of haystacks) {
      const text = hay.toLowerCase();
      if (text === needle) best = Math.max(best, 100);
      else if (text.startsWith(needle)) best = Math.max(best, 70);
      else if (text.includes(needle)) best = Math.max(best, 40);
    }
    // Common items win ties, so a search for "ספה" surfaces the sofa people
    // actually own before the modular sofa section.
    if (best > 0) scored.push({ item, score: best + (item.isCommon ? 5 : 0) });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.item.nameHe.localeCompare(b.item.nameHe))
    .slice(0, limit)
    .map((s) => s.item);
}

export function catalogItemsByCategory(category: CatalogItem['category']): CatalogItem[] {
  return CATALOG.filter((item) => item.category === category);
}
