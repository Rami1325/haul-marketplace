/**
 * Turns the raw workflow output into the shipped catalog, applying the fixes the
 * adversarial audit found. Run once; the emitted TypeScript is what ships.
 *
 * The audit's verdict was "not shippable as a pricing source of truth", and it
 * was right: two independently authored lists were merged without
 * reconciliation. The three defects that actually cost money:
 *
 *   1. craneCandidate was hand-set per row, so a 42kg mattress needed a crane
 *      and an 80kg two-door fridge did not. Crane is the largest single line on
 *      an Israeli move; this flag being noise is the most expensive defect here.
 *      Fixed by DERIVING it from a rule.
 *   2. Eight physical objects existed twice with divergent numbers, so the same
 *      sofa priced differently depending which button the customer tapped.
 *   3. Four of fifteen preset ids did not resolve, so a quarter of the default
 *      inventory silently vanished from every preset quote.
 */
import fs from 'node:fs';

const raw = JSON.parse(fs.readFileSync(new URL('./raw-workflow-output.json', import.meta.url), 'utf8'));
const notes = [];

// ---------------------------------------------------------------------------
// 1. Deduplicate
// ---------------------------------------------------------------------------
// Keep the id on the left, drop the id on the right. Chosen to keep the id the
// presets and other authors were most likely to reference.
const DROP_IN_FAVOUR_OF = {
  coffee_table: 'living_coffee_table',
  bookcase: 'living_bookshelf',
  china_cabinet: 'living_display_cabinet',
  mirror_full_length: 'living_mirror_large',
  bedroom_shoe_cabinet: 'living_shoe_cabinet',
  bedroom_safe: 'safe_home',
  box_wardrobe: 'wardrobe_box_hanging',
  plant_pot_xl: 'plant_potted_large',
  desk_study: 'desk_computer',
  bench_dining: 'bedroom_bench',
};

// A composite bundle whose volume is the sum of four separately selectable
// items. Any customer who ticks it plus their desk double-counts the same goods.
const REMOVE = new Set([
  'gaming_setup',
  // LPG cylinders are dangerous goods. Most movers and, more to the point, most
  // goods-in-transit insurers will not carry them. Offering it as a routine
  // 5-minute line item invites an uninsured loss — the plan's single biggest
  // existential risk. Surfaced instead on a "things we can't move" screen.
  'gas_balloon',
]);

const byId = new Map();
for (const item of raw.items) {
  if (REMOVE.has(item.id)) continue;
  if (DROP_IN_FAVOUR_OF[item.id]) continue;
  if (byId.has(item.id)) continue;
  byId.set(item.id, { ...item });
}

// Catch any remaining same-object pairs the audit did not name, by Hebrew name.
const seenHebrew = new Map();
for (const [id, item] of [...byId]) {
  const key = item.nameHe.replace(/[\s\-־]/g, '');
  if (seenHebrew.has(key)) {
    notes.push(`dropped ${id} — duplicate Hebrew name of ${seenHebrew.get(key)}`);
    byId.delete(id);
    continue;
  }
  seenHebrew.set(key, id);
}

// ---------------------------------------------------------------------------
// 2. Corrections the audit found, applied before the derived rules
// ---------------------------------------------------------------------------
const CORRECTIONS = {
  // 1 min for a 6kg unstackable wrap-required chair, against a 12kg stackable
  // box at 1.5. Chairs are selected in sixes and eights, so this was the
  // highest-volume line in the catalog underpriced by ~40% against its anchor.
  dining_chair: { handlingMinutes: 2 },
  // Worst kg/min ratio in the catalog, and cheapest within its own family —
  // a split indoor dismount is the most labour-intensive AC job, not the least.
  ac_split_indoor: { handlingMinutes: 20 },
  // Marked common alongside boxes and fridges. A treadmill is in a small
  // minority of flats; surfacing it by default inflates the baseline manifest.
  treadmill: { isCommon: false },
};

for (const [id, patch] of Object.entries(CORRECTIONS)) {
  const item = byId.get(id);
  if (!item) {
    notes.push(`WARN correction target missing: ${id}`);
    continue;
  }
  Object.assign(item, patch);
}

// ---------------------------------------------------------------------------
// 3. Derive craneCandidate from a rule instead of per-row judgement
// ---------------------------------------------------------------------------
// A crane candidate is something that realistically will not go down an Israeli
// stairwell: bulky OR heavy, and rigid.
const CRANE_VOLUME_M3 = 0.8;
const CRANE_WEIGHT_KG = 70;

// Flexible or foldable — bends around a stairwell however big it is. Mattresses
// are the classic false positive and the audit caught one.
const NEVER_CRANE = new Set([
  'mattress_single',
  'mattress_double',
  'mattress_king',
  'mattress_baby',
  'living_rug',
  'living_rug_large',
]);

// Mounted on an exterior facade or roof. Small and light, but reached by rope
// or crane regardless — the classic Israeli access job.
const ALWAYS_CRANE = new Set([
  'ac_outdoor_compressor',
  'solar_panel_collector',
  'solar_water_heater_tank',
]);

let craneChanged = 0;
for (const item of byId.values()) {
  const derived = ALWAYS_CRANE.has(item.id)
    ? true
    : NEVER_CRANE.has(item.id)
      ? false
      : item.volumeM3 >= CRANE_VOLUME_M3 || item.weightKg >= CRANE_WEIGHT_KG;
  if (derived !== item.craneCandidate) craneChanged++;
  item.craneCandidate = derived;
}

// ---------------------------------------------------------------------------
// 4. Items the audit found missing, several of them Israel-specific
// ---------------------------------------------------------------------------
const ADDITIONS = [
  ['stroller_single', 'other', 'עגלת תינוק', 'Baby stroller', ['עגלה', 'עגלת תינוק', 'עגלות', 'stroller', 'pram', 'buggy'], 0.25, 12, 3, false, false, null, 'stroller', true],
  ['stroller_double', 'other', 'עגלת תאומים', 'Double stroller', ['עגלה כפולה', 'עגלת תאומים', 'double stroller', 'twin stroller'], 0.4, 18, 4, false, false, null, 'stroller', false],
  ['fan_standing', 'appliance', 'מאוורר עומד', 'Standing fan', ['מאוורר', 'מאווררים', 'מאוורר עומד', 'fan', 'standing fan', 'pedestal fan'], 0.12, 6, 2, false, false, null, 'fan', true],
  ['hotplate_shabbat', 'appliance', 'פלטה חשמלית', 'Shabbat hotplate', ['פלטה', 'פלטת שבת', 'plata', 'hotplate', 'shabbat hotplate'], 0.05, 4, 1.5, false, false, null, 'appliance', true],
  ['sukkah_kit', 'outdoor', 'סוכה (קורות, דפנות וסכך)', 'Sukkah kit', ['סוכה', 'קורות סוכה', 'דפנות', 'סכך', 'sukkah', 'succah'], 0.9, 60, 14, true, false, null, 'sukkah', false],
  ['bed_three_quarter_frame', 'furniture', 'מיטה וחצי (מסגרת)', 'Three-quarter bed frame', ['מיטה וחצי', 'מיטת יחיד וחצי', 'מיטה 120', 'three quarter bed', 'small double bed'], 0.75, 45, 12, true, false, null, 'bed', true],
  ['mattress_three_quarter', 'furniture', 'מזרן וחצי', 'Three-quarter mattress', ['מזרן וחצי', 'מזרן 120', 'three quarter mattress'], 0.5, 34, 6, true, false, null, 'mattress', true],
  ['utility_cabinet_balcony', 'furniture', 'ארון שירות (מרפסת שירות)', 'Service-balcony cabinet', ['ארון שירות', 'ארון מרפסת', 'ארונית שירות', 'utility cabinet', 'service cabinet'], 0.7, 45, 10, true, false, null, 'cabinet', true],
  ['bed_folding_guest', 'furniture', 'מיטה מתקפלת (מיטת אורח)', 'Folding guest bed', ['מיטה מתקפלת', 'מיטת אורח', 'מיטה נפתחת לאורחים', 'folding bed', 'rollaway bed', 'guest bed'], 0.35, 25, 5, false, false, null, 'bed', false],
  ['curtains_and_rods', 'other', 'וילונות ומוטות', 'Curtains and rods', ['וילון', 'וילונות', 'מוט וילון', 'curtains', 'curtain rods', 'blinds'], 0.15, 10, 4, false, false, null, 'curtains', false],
  ['drum_kit', 'other', 'מערכת תופים', 'Drum kit', ['תופים', 'מערכת תופים', 'drums', 'drum kit'], 0.7, 45, 20, true, false, null, 'music', false],
  ['instrument_case', 'other', 'נרתיק כלי נגינה', 'Instrument case', ['גיטרה', 'כינור', 'נרתיק', 'guitar', 'violin', 'instrument case'], 0.1, 6, 2, false, true, null, 'music', false],
  ['car_seat_baby', 'other', 'כיסא בטיחות לרכב', 'Baby car seat', ['כיסא בטיחות', 'סלקל', 'car seat', 'baby seat'], 0.12, 8, 2, false, false, null, 'car-seat', false],
  ['playpen_travel_cot', 'other', 'לול / מיטת נסיעות', 'Playpen / travel cot', ['לול', 'מיטת נסיעות', 'playpen', 'travel cot', 'pack n play'], 0.2, 12, 3, false, false, null, 'cot', false],
  ['bathroom_vanity', 'furniture', 'ארון אמבטיה', 'Bathroom vanity', ['ארון אמבטיה', 'ארונית אמבטיה', 'bathroom vanity', 'bathroom cabinet'], 0.4, 35, 8, true, false, null, 'cabinet', false],
  ['awning_markiza', 'outdoor', 'מרקיזה / סוכך', 'Awning', ['מרקיזה', 'סוכך', 'awning', 'markiza'], 0.5, 40, 18, true, false, null, 'awning', false],
  ['kitchen_small_appliances', 'appliance', 'מכשירי מטבח קטנים (קומקום, בלנדר, מיקסר)', 'Small kitchen appliances', ['קומקום', 'בלנדר', 'מיקסר', 'מעבד מזון', 'kettle', 'blender', 'mixer', 'food processor'], 0.12, 10, 2, false, false, null, 'appliance', true],
  // The escape hatch. Without it, anything not in the catalog is silently
  // omitted from the quote — and every one of these is a signal about what the
  // catalog is missing, so they are worth mining.
  ['other_item', 'other', 'פריט אחר', 'Something else', ['אחר', 'פריט אחר', 'משהו אחר', 'other', 'something else', 'not listed'], 0.3, 20, 5, false, false, null, 'question', true],
];

for (const a of ADDITIONS) {
  const [id, category, nameHe, nameEn, aliases, volumeM3, weightKg, handlingMinutes, requiresTwoPeople, fragile, heavyItemSurchargeKey, icon, isCommon] = a;
  if (byId.has(id)) {
    notes.push(`WARN addition already present: ${id}`);
    continue;
  }
  byId.set(id, {
    id, category, nameHe, nameEn, aliases, volumeM3, weightKg, handlingMinutes,
    requiresTwoPeople,
    craneCandidate: ALWAYS_CRANE.has(id) ? true : NEVER_CRANE.has(id) ? false : volumeM3 >= CRANE_VOLUME_M3 || weightKg >= CRANE_WEIGHT_KG,
    fragile, heavyItemSurchargeKey, icon, isCommon,
  });
}

// ---------------------------------------------------------------------------
// 5. Reconcile preset ids against the real catalog
// ---------------------------------------------------------------------------
const PRESET_ID_FIXES = {
  bed_double: 'bed_double_frame',
  bookshelf: 'living_bookshelf',
  dining_table_6: 'dining_table_6_seat',
  office_desk: 'desk_office',
};

const presets = raw.presets.map((p) => ({
  ...p,
  lines: p.lines.map((l) => ({
    ...l,
    catalogItemId: PRESET_ID_FIXES[l.catalogItemId] ?? DROP_IN_FAVOUR_OF[l.catalogItemId] ?? l.catalogItemId,
  })),
}));

// Fail loudly rather than shipping a preset that silently drops items.
const unresolved = [];
for (const p of presets) {
  for (const l of p.lines) {
    if (!byId.has(l.catalogItemId)) unresolved.push(`${p.id} → ${l.catalogItemId}`);
  }
}
if (unresolved.length) {
  console.error('UNRESOLVED PRESET ITEMS:\n  ' + unresolved.join('\n  '));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 6. Emit
// ---------------------------------------------------------------------------
const items = [...byId.values()].sort((a, b) =>
  a.category === b.category ? a.id.localeCompare(b.id) : a.category.localeCompare(b.category),
);

const commonCount = items.filter((i) => i.isCommon).length;
const craneCount = items.filter((i) => i.craneCandidate).length;

fs.writeFileSync(
  new URL('../src/data/catalog.json', import.meta.url),
  JSON.stringify(items, null, 2),
);
fs.writeFileSync(
  new URL('../src/data/presets.json', import.meta.url),
  JSON.stringify(presets, null, 2),
);

console.log(`raw ${raw.items.length} → shipped ${items.length}`);
console.log(`  removed:        ${raw.items.length - items.length + ADDITIONS.length} (dupes + unsafe + composite)`);
console.log(`  added:          ${ADDITIONS.length}`);
console.log(`  crane flags changed by the derived rule: ${craneChanged}`);
console.log(`  crane candidates: ${craneCount}   common: ${commonCount}`);
console.log(`  presets: ${presets.length}, all item ids resolve`);
if (notes.length) console.log('\nnotes:\n  ' + notes.join('\n  '));
