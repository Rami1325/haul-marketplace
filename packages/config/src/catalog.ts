import {
  CatalogItemSchema,
  ManifestPresetSchema,
  VehicleClassSchema,
  type ManifestPreset,
  type VehicleClass,
} from '@haul/types';
import { z } from 'zod';
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

/**
 * A catalog row as this package ships it: the domain shape from @haul/types plus
 * the one field that is a decision about *our* first screen rather than a fact
 * about the object.
 *
 * `isFirstScreen` lives here and not on `CatalogItemSchema` deliberately. How
 * many tiles fit above the fold, and which twenty-four earn them, is a product
 * decision that changes with the design; how much a fridge weighs is not. A
 * package that only prices a manifest never needs to know the difference.
 */
export const ShippedCatalogItemSchema = CatalogItemSchema.extend({
  /**
   * In the first-screen grid, shown before the customer searches for anything.
   *
   * DERIVED in `scripts/build-catalog.mjs` from preset frequency, not hand-set —
   * see the derivation there for why, and `isCommon` below for what the older
   * flag now means.
   */
  isFirstScreen: z.boolean().default(false),
});
export type ShippedCatalogItem = z.infer<typeof ShippedCatalogItemSchema>;

export const CATALOG: readonly ShippedCatalogItem[] =
  ShippedCatalogItemSchema.array().parse(catalogData);

export const CATALOG_BY_ID: ReadonlyMap<string, ShippedCatalogItem> = new Map(
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
 * The first-screen grid, in catalog order.
 *
 * The plan's third differentiator: open with what's in the customer's head —
 * a fridge and eleven boxes — rather than "where from?". Twenty-four tiles is
 * what fits above the fold on a phone without becoming a list, and the twenty-
 * four are derived rather than chosen: see `scripts/build-catalog.mjs`.
 */
export const FIRST_SCREEN_ITEMS: readonly ShippedCatalogItem[] = CATALOG.filter(
  (item) => item.isFirstScreen,
);

/**
 * The search-boost pool: items a person would recognise without a photo.
 *
 * This used to be the grid, and 57 tiles is four screens on a phone. It is now
 * the *candidate* set the grid is derived from and the tiebreak that makes a
 * search for "ספה" surface the sofa people actually own before the modular
 * sofa section. Being common is a claim about recognisability; being on the
 * first screen is a claim about frequency, and they are not the same claim.
 */
export const COMMON_ITEMS: readonly ShippedCatalogItem[] = CATALOG.filter((item) => item.isCommon);

/** One thing HAUL will not carry, and what to tell the customer who asked. */
export interface RefusedItem {
  id: string;
  nameHe: string;
  nameEn: string;
  reasonHe: string;
  reasonEn: string;
  /**
   * Spellings a customer might actually type into the free-text field, both
   * languages, including transliterations. Not search sugar — every one of
   * these is a string that must reach the refusal instead of a quote.
   */
  aliases: readonly string[];
  /**
   * Words that mean the customer is describing the empty container, which we do
   * carry, rather than its contents, which we do not.
   *
   * Only `live_animals` has one, because only there does the catalog sell the
   * container: `pet_carrier` (כלוב הובלה לחיית מחמד) is a real row. There is
   * deliberately no equivalent for the gas cylinder — "בלון גז לגריל" is still
   * an LPG cylinder, and a guard that let it through would be the exact
   * uninsured load this list exists to stop.
   */
  unless: readonly string[];
}

/**
 * Things HAUL will not carry.
 *
 * LPG cylinders (בלון גז) are dangerous goods, and goods-in-transit insurers
 * generally exclude them. Carrying one uninsured is the plan's single biggest
 * existential risk in miniature, so it is refused explicitly and visibly rather
 * than left as a catalog row nobody thought about.
 *
 * Ordered most-dangerous first: `isRefusedLabel` returns the first match, so a
 * string that could be read two ways gets the answer that costs least to be
 * wrong about.
 */
export const REFUSED_ITEMS: readonly RefusedItem[] = [
  {
    id: 'gas_balloon',
    nameHe: 'בלון גז',
    nameEn: 'LPG gas cylinder',
    reasonHe: 'חומר מסוכן — לא מבוטח בהובלה. יש לתאם החלפה מול חברת הגז.',
    reasonEn:
      'Dangerous goods — not covered by goods-in-transit insurance. Arrange a swap with your gas supplier.',
    aliases: [
      'בלון',
      'בלוני גז',
      'בלון גז ביתי',
      'בלון גז 12 קג',
      'מיכל גז',
      'גז ביתי',
      'gas balloon',
      'gas cylinder',
      'gas bottle',
      'lpg cylinder',
      'lpg',
      'propane tank',
      'propane cylinder',
      'balon gaz',
    ],
    unless: [],
  },
  {
    id: 'hazardous_chemicals',
    nameHe: 'חומרים דליקים או מסוכנים',
    nameEn: 'Flammable or hazardous materials',
    reasonHe: 'דלק, ממסים וחומרי הדברה אינם מכוסים בביטוח מטענים.',
    reasonEn: 'Fuel, solvents and pesticides are excluded from cargo insurance.',
    aliases: [
      'חומרים מסוכנים',
      'חומר מסוכן',
      'חומרים דליקים',
      'חומרי נפץ',
      'חומרי הדברה',
      'ג׳ריקן דלק',
      'דלק',
      'בנזין',
      'סולר',
      'נפט',
      'ממסים',
      'טרפנטין',
      'אצטון',
      'חומצה',
      'זיקוקים',
      'fuel',
      'petrol',
      'gasoline',
      'diesel',
      'kerosene',
      'jerrycan',
      'solvent',
      'turpentine',
      'acetone',
      'paint thinner',
      'pesticide',
      'flammable',
      'explosives',
      'fireworks',
      'hazardous materials',
    ],
    unless: [],
  },
  {
    id: 'live_animals',
    nameHe: 'בעלי חיים',
    nameEn: 'Live animals',
    reasonHe: 'לא ניתן להוביל בעלי חיים במשאית הובלה.',
    reasonEn: 'Live animals cannot travel in a removals truck.',
    aliases: [
      'בעל חיים',
      'חיית מחמד',
      'חיות מחמד',
      'כלב',
      'חתול',
      'תוכי',
      'ציפור',
      'אוגר',
      'ארנב',
      'live animal',
      'live animals',
      'pet',
      'pets',
      'dog',
      'cat',
      'parrot',
      'hamster',
      'rabbit',
    ],
    unless: [
      'כלוב',
      'סלקל',
      'ריק',
      'carrier',
      'crate',
      'cage',
      'kennel',
      'empty',
      'אקווריום',
      'aquarium',
    ],
  },
];

const FINAL_LETTERS: Readonly<Record<string, string>> = {
  ם: 'מ',
  ן: 'נ',
  ץ: 'צ',
  ף: 'פ',
  ך: 'כ',
};

/** Hebrew clitics that attach to a noun with no space: הבלון, ובלון, לבלון. */
const HEBREW_CLITICS = 'הובלכשמ';

/**
 * Fold a customer-typed string into comparable tokens.
 *
 * Three things happen here and each one is a real string somebody typed:
 *
 *   · Niqqud and cantillation are stripped. A keyboard that emits בָּלוֹן must
 *     compare equal to one that emits בלון.
 *   · Final letters are folded (ם ן ץ ף ך → מ נ צ פ כ). Without it "בלונים"
 *     does not begin with "בלון", because ן and נ are different characters —
 *     so every Hebrew plural would walk straight past the refusal.
 *   · Punctuation, geresh and maqaf become spaces, so "בלון־גז" and "בלון גז"
 *     are one string.
 */
function refusalTokens(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[֑-ׇ]/g, '')
    .replace(/[םןץףך]/g, (final) => FINAL_LETTERS[final] ?? final)
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((token) => token.length > 0);
}

/** Every label the catalog answers to, folded the same way a customer's typing is. */
const CATALOG_LABEL_KEYS: ReadonlySet<string> = new Set(
  CATALOG.flatMap((item) => [item.nameHe, item.nameEn, ...item.aliases]).map((label) =>
    refusalTokens(label).join(' '),
  ),
);

function tokenMatches(token: string, pattern: string): boolean {
  if (token === pattern) return true;
  // Short patterns match whole tokens only. "גז" as a prefix would refuse the
  // gas hob and the Weber, both of which we carry.
  if (pattern.length < 3) return false;
  if (token.startsWith(pattern)) return true;
  const head = token[0];
  return head !== undefined && HEBREW_CLITICS.includes(head) && token.slice(1).startsWith(pattern);
}

/**
 * Is this free-text item something we refuse to carry?
 *
 * The booking flow's "other item" field is the one place a customer can name
 * anything at all, and `REFUSED_ITEMS` is otherwise decorative — a screen the
 * customer has to go looking for. This is the check that makes it binding, and
 * it must be tolerant: a person typing בלוני גז at 23:00 on a phone will not
 * match a canonical string.
 *
 * Two rules keep it from refusing work we want:
 *
 *   1. A string that IS a catalog label wins outright. "גריל גז" is a Weber and
 *      "כלוב הובלה לחיית מחמד" is an empty crate; both are rows we price.
 *   2. Every token of a pattern must be present, so a match is "בלון גז" rather
 *      than "גז" appearing somewhere in a sentence about the hob.
 *
 * Returns the matched item — whose `reasonHe` is the sentence to show — plus
 * the spelling that matched, which is worth logging: it says what customers
 * actually call the thing.
 */
export function isRefusedLabel(text: string): { item: RefusedItem; matchedOn: string } | null {
  const tokens = refusalTokens(text);
  if (tokens.length === 0) return null;
  if (CATALOG_LABEL_KEYS.has(tokens.join(' '))) return null;

  for (const item of REFUSED_ITEMS) {
    if (item.unless.some((word) => tokens.some((token) => tokenMatches(token, word)))) continue;
    for (const pattern of [item.nameHe, item.nameEn, ...item.aliases]) {
      const patternTokens = refusalTokens(pattern);
      if (patternTokens.length === 0) continue;
      if (patternTokens.every((p) => tokens.some((token) => tokenMatches(token, p)))) {
        return { item, matchedOn: pattern };
      }
    }
  }
  return null;
}

/** Free-text search across Hebrew, English and aliases. */
export function searchCatalog(query: string, limit = 20): ShippedCatalogItem[] {
  const needle = query.trim().toLowerCase();
  // An empty query is the first screen, not a truncated list of everything a
  // person might recognise.
  if (!needle) return [...FIRST_SCREEN_ITEMS].slice(0, limit);

  const scored: Array<{ item: ShippedCatalogItem; score: number }> = [];
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

export function catalogItemsByCategory(
  category: ShippedCatalogItem['category'],
): ShippedCatalogItem[] {
  return CATALOG.filter((item) => item.category === category);
}
