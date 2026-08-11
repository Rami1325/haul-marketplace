import { describe, expect, it } from 'vitest';
import catalogData from '../data/catalog.json' with { type: 'json' };
import {
  CATALOG,
  CATALOG_BY_ID,
  COMMON_ITEMS,
  FIRST_SCREEN_ITEMS,
  MANIFEST_PRESETS,
  searchCatalog,
} from '../catalog.js';

/**
 * ---------------------------------------------------------------------------
 * The first-screen grid
 * ---------------------------------------------------------------------------
 * `isCommon` was hand-set per row by the same authors whose hand-set
 * `craneCandidate` turned out to be noise, and it flagged 57 of 169 items —
 * four screens on a phone. The grid is now derived in
 * `scripts/build-catalog.mjs` from preset frequency, and these tests hold the
 * derivation to the properties that made it worth deriving rather than to the
 * 24 ids it happens to produce today. A better preset set should be free to
 * change the membership without touching this file.
 * ---------------------------------------------------------------------------
 */

const presetItemIds = new Set(
  MANIFEST_PRESETS.flatMap((preset) => preset.lines.map((line) => line.catalogItemId)),
);

describe('the size of the grid', () => {
  it('fits on one screen without becoming a list', () => {
    // Twenty-four is the target. The band is what a change to the presets is
    // allowed to move it by before somebody has to look at the layout again.
    expect(
      FIRST_SCREEN_ITEMS.length,
      `${FIRST_SCREEN_ITEMS.length} tiles: ${FIRST_SCREEN_ITEMS.map((i) => i.id).join(', ')}`,
    ).toBeGreaterThanOrEqual(20);
    expect(FIRST_SCREEN_ITEMS.length).toBeLessThanOrEqual(28);
  });

  it('is much smaller than the pool it was chosen from', () => {
    // The whole point of splitting the two flags. If they converge, the grid has
    // stopped being a decision.
    expect(FIRST_SCREEN_ITEMS.length).toBeLessThan(COMMON_ITEMS.length / 2);
  });
});

describe('what the grid is made of', () => {
  it('contains every item a preset says a real flat has in it', () => {
    // Round one of the derivation: the presets are the only evidence in the repo
    // about what a Tel Aviv home contains, and none of it is thrown away.
    for (const id of presetItemIds) {
      expect(CATALOG_BY_ID.get(id)?.isFirstScreen, id).toBe(true);
    }
  });

  it('represents every category a preset touches', () => {
    const presetCategories = new Set(
      [...presetItemIds].map((id) => CATALOG_BY_ID.get(id)!.category),
    );
    const gridCategories = new Set(FIRST_SCREEN_ITEMS.map((item) => item.category));
    for (const category of presetCategories) {
      expect(gridCategories.has(category), category).toBe(true);
    }
  });

  it('is a subset of the searchable-common pool', () => {
    // A tile nobody flagged as recognisable would be a tile with no label a
    // customer could match against when they search instead of tapping.
    for (const item of FIRST_SCREEN_ITEMS) {
      expect(item.isCommon, item.id).toBe(true);
    }
  });

  it('is not six sofas', () => {
    // The failure the category tiebreak exists to prevent: furniture is the
    // biggest category in the catalog, so an unweighted ranking fills the grid
    // with variants of one thing.
    const perFamily = new Map<string, number>();
    for (const item of FIRST_SCREEN_ITEMS) {
      perFamily.set(item.icon, (perFamily.get(item.icon) ?? 0) + 1);
    }
    for (const [icon, count] of perFamily) {
      expect(
        count,
        `${icon} takes ${count} of ${FIRST_SCREEN_ITEMS.length} tiles`,
      ).toBeLessThanOrEqual(3);
    }
    // And more than one family in play beyond the preset representatives.
    expect(perFamily.size).toBeGreaterThanOrEqual(12);
  });

  it('offers a second size for the families a preset only named once', () => {
    // Round two. A customer with a single bed and small boxes must not have to
    // search for something the grid implies we do not handle.
    const gridByFamily = new Map<string, number>();
    for (const item of FIRST_SCREEN_ITEMS) {
      gridByFamily.set(item.icon, (gridByFamily.get(item.icon) ?? 0) + 1);
    }
    for (const icon of ['box', 'bed', 'sofa', 'mattress', 'wardrobe']) {
      expect(gridByFamily.get(icon) ?? 0, icon).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('the two flags mean different things', () => {
  it('keeps items that are recognisable but not frequent off the grid', () => {
    const commonOnly = COMMON_ITEMS.filter((item) => !item.isFirstScreen);
    expect(commonOnly.length).toBeGreaterThan(0);
  });

  it('still boosts common items in search', () => {
    // `isCommon` earns its keep as a tiebreak, not as a grid flag.
    const results = searchCatalog('ספה');
    expect(results.length).toBeGreaterThan(1);
    expect(results[0]!.isCommon).toBe(true);
  });

  it('opens an empty search on the grid rather than on the pool', () => {
    const empty = searchCatalog('', 24);
    expect(empty.map((item) => item.id)).toEqual(FIRST_SCREEN_ITEMS.map((item) => item.id));
  });
});

describe('the shipped data came from the script', () => {
  it('carries the flag explicitly on every row', () => {
    // The schema defaults `isFirstScreen` to false, so a hand-edited or
    // stale catalog.json would parse cleanly and quietly empty the grid. This
    // reads the file rather than the parsed objects, which is the only way to
    // tell a missing key from a deliberate false.
    const rows = catalogData as ReadonlyArray<Record<string, unknown>>;
    expect(rows.length).toBe(CATALOG.length);
    for (const row of rows) {
      expect(Object.hasOwn(row, 'isFirstScreen'), String(row['id'])).toBe(true);
    }
  });
});
