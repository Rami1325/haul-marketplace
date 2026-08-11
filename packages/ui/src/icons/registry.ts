/**
 * ---------------------------------------------------------------------------
 * The glyph registry
 * ---------------------------------------------------------------------------
 * `CatalogItem.icon` and `ManifestPreset.icon` are free strings — the catalog
 * carries 169 rows keyed to 96 of them and the presets add seven more — and
 * until this module existed every one of those keys resolved to nothing. That is
 * the shape of the bug worth naming: not a missing image, but a *string* that
 * names a picture nobody ever drew, in data that validates perfectly.
 *
 * So the registry is a closed set with a name type derived from it, and the
 * bridge from the catalog's open string to that closed set is `resolveIconName`,
 * which is the only place a key is allowed to be unknown. Everything downstream
 * of it holds an `IconName`, which means a glyph that was renamed is a
 * compile error at every call site rather than an empty square on the flagship
 * screen.
 *
 * ## Why the drawings are data rather than components
 *
 * A glyph per module is the conventional layout and it is the wrong one here.
 * Directional glyphs have to be chosen at render time from the reading
 * direction, unknown keys have to fall back to a real drawing, and both of those
 * are lookups — they need a table. Path data in a table also lets a test walk
 * every glyph and assert the properties that matter (that no two paths inside
 * one glyph collide, that a mirrored pair really is a mirrored pair, that
 * nothing carries a `transform`), which a directory of 39 components cannot be
 * made to do.
 *
 * ## Mirrored twins, never a flipped glyph
 *
 * An arrow means "onward". Onward is to the left in Hebrew and to the right in
 * English, so an arrow is not one drawing shown two ways — it is two drawings,
 * and this table holds both. The tempting one-liner is a negative horizontal
 * scale under an `rtl:` variant, and `__tests__/rtl.test.ts` bans that outright,
 * correctly: it mirrors the stroke geometry too, so joins and caps land on the
 * wrong side, an asymmetric glyph comes back subtly deformed, and any text or
 * numeral inside it renders backwards. Worse, it is a *rendering* trick applied
 * to a *semantic* fact, so it silently mirrors glyphs that should never move —
 * the day someone flips a whole icon row, the clock face reads counter-clockwise.
 *
 * The names say direction logically for the same reason the stylesheet does.
 * `chevron-end` points toward the inline end — left in Hebrew, right in English —
 * and `chevron-start` is its twin. There is no `chevron-right`, because the
 * component that wanted one wanted "forward" and would have got it wrong for
 * most of this product's users.
 *
 * ## What is here, and what is deliberately not
 *
 * A starter set: every preset key, the catalog keys that account for about half
 * of its rows, the seven pieces of interface furniture the components need, and
 * the four directional twins. The rest of the catalog's long tail resolves to
 * `question` through `resolveIconName` — a neutral placeholder rather than a
 * plausible-looking wrong object, because the tile beside it already carries the
 * item's name and a box drawn for a piano is the icon actively lying.
 * ---------------------------------------------------------------------------
 */

/**
 * Every glyph is drawn in this box and stroked rather than filled, so one set of
 * stroke attributes on the `<svg>` covers the whole registry and every drawing
 * inherits `currentColor` from whatever it sits inside.
 */
export const ICON_VIEWBOX = '0 0 24 24';

/** The stroke width every glyph is drawn at. Uniform, or the set reads as mixed. */
export const ICON_STROKE_WIDTH = 1.6;

/** One drawing: `d` attributes, painted in order. */
export interface IconGlyph {
  readonly paths: readonly string[];
}

/**
 * A glyph whose meaning depends on which way the page reads, held as the two
 * drawings it actually is. See the header on why this is not one drawing and a
 * transform.
 */
export interface DirectionalGlyph {
  readonly rtl: IconGlyph;
  readonly ltr: IconGlyph;
}

export type IconDefinition = IconGlyph | DirectionalGlyph;

export function isDirectionalGlyph(definition: IconDefinition): definition is DirectionalGlyph {
  return 'rtl' in definition;
}

/**
 * The drawing to paint, resolved against the direction the page is reading in.
 * A symmetric glyph ignores the argument, which is the point: the caller asks
 * once and does not have to know which kind of glyph it is holding.
 */
export function glyphFor(definition: IconDefinition, isRtl: boolean): IconGlyph {
  if (!isDirectionalGlyph(definition)) return definition;
  return isRtl ? definition.rtl : definition.ltr;
}

export const ICON_GLYPHS = {
  // --- direction: mirrored twins ---------------------------------------------
  // `chevron-start.ltr` and `chevron-end.rtl` are the same drawing, and a test
  // asserts that rather than trusting it — a twin that stopped being a twin is
  // an arrow pointing back the way the customer came, in one language only.
  'chevron-end': {
    ltr: { paths: ['M9.5 5.5 16 12l-6.5 6.5'] },
    rtl: { paths: ['M14.5 5.5 8 12l6.5 6.5'] },
  },
  'chevron-start': {
    ltr: { paths: ['M14.5 5.5 8 12l6.5 6.5'] },
    rtl: { paths: ['M9.5 5.5 16 12l-6.5 6.5'] },
  },
  'arrow-end': {
    ltr: { paths: ['M3.75 12h16.5', 'M14 5.75 20.25 12 14 18.25'] },
    rtl: { paths: ['M20.25 12H3.75', 'M10 5.75 3.75 12 10 18.25'] },
  },
  'arrow-start': {
    ltr: { paths: ['M20.25 12H3.75', 'M10 5.75 3.75 12 10 18.25'] },
    rtl: { paths: ['M3.75 12h16.5', 'M14 5.75 20.25 12 14 18.25'] },
  },

  // --- interface furniture. Drawn symmetric, so direction never arises --------
  check: { paths: ['M4.75 12.5 9.5 17.25 19.25 6.75'] },
  close: { paths: ['M6 6 18 18', 'M18 6 6 18'] },
  plus: { paths: ['M12 4.75v14.5', 'M4.75 12h14.5'] },
  minus: { paths: ['M4.75 12h14.5'] },
  info: {
    paths: [
      'M12 3.25a8.75 8.75 0 1 1 0 17.5 8.75 8.75 0 0 1 0-17.5Z',
      'M12 11.25v5',
      'M12 7.75h.01',
    ],
  },
  warning: { paths: ['M12 3.5 21.5 19.5H2.5L12 3.5Z', 'M12 9.75v4.25', 'M12 16.75h.01'] },
  clock: {
    paths: ['M12 3.25a8.75 8.75 0 1 1 0 17.5 8.75 8.75 0 0 1 0-17.5Z', 'M12 7.25V12l3.25 2'],
  },

  // --- the presets, which are floor plans -------------------------------------
  // Counted in total rooms, the way every Israeli listing counts them — a
  // דירת 3 חדרים is three rooms including the living room, not three bedrooms.
  studio: { paths: ['M4.5 5.5h15v13h-15z', 'M8 10.5h8v4.5h-8z'] },
  'apartment-2': { paths: ['M3.5 5.5h17v13h-17z', 'M12 5.5v13'] },
  'apartment-3': { paths: ['M3.5 5.5h17v13h-17z', 'M12 5.5v13', 'M12 12h8.5'] },
  'apartment-4': { paths: ['M3.5 5.5h17v13h-17z', 'M12 5.5v13', 'M3.5 12h17'] },
  'apartment-5-plus': {
    paths: ['M3.5 5.5h17v13h-17z', 'M12 5.5v13', 'M3.5 12h17', 'M16.25 12v6.5'],
  },

  // --- the catalog ------------------------------------------------------------
  box: {
    paths: ['M3.75 8.25h16.5v11.5H3.75z', 'M3.75 8.25 6.25 4.5h11.5l2.5 3.75', 'M12 4.5v15.25'],
  },
  boxes: { paths: ['M3.5 12.5h7v7.25h-7z', 'M13.5 12.5h7v7.25h-7z', 'M8.5 4.25h7v7.25h-7z'] },
  sofa: {
    paths: [
      'M4.5 11.25V8.75A2.25 2.25 0 0 1 6.75 6.5h10.5a2.25 2.25 0 0 1 2.25 2.25v2.5',
      'M2.75 11.25h18.5v5.5H2.75z',
      'M5.5 16.75v2.25',
      'M18.5 16.75v2.25',
    ],
  },
  chair: {
    paths: [
      'M8.25 4h7.5v8.25h-7.5z',
      'M6.25 12.25h11.5v3h-11.5z',
      'M7.75 15.25v4.75',
      'M16.25 15.25v4.75',
    ],
  },
  bench: {
    paths: [
      'M3 11.25h18v2.5H3z',
      'M4 7.25h16',
      'M5.75 7.25v4',
      'M18.25 7.25v4',
      'M6 13.75v5',
      'M18 13.75v5',
    ],
  },
  table: { paths: ['M3 7.5h18v2.25H3z', 'M6 9.75v9.25', 'M18 9.75v9.25'] },
  desk: {
    paths: [
      'M3 7.5h18v2.25H3z',
      'M5.25 9.75h4.5v9.25h-4.5z',
      'M14.25 9.75h4.5v9.25h-4.5z',
      'M5.25 13.5h4.5',
      'M14.25 13.5h4.5',
    ],
  },
  bed: {
    paths: [
      'M2.75 10.75h18.5v6.5H2.75z',
      'M5.75 10.75V8.25h4.5v2.5',
      'M13.75 10.75V8.25h4.5v2.5',
      'M4.25 17.25v2.25',
      'M19.75 17.25v2.25',
    ],
  },
  mattress: {
    paths: [
      'M4 9h16a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2Z',
      'M8 12.25h.01',
      'M12 12.25h.01',
      'M16 12.25h.01',
    ],
  },
  wardrobe: {
    paths: ['M4.75 3.25h14.5v17.5H4.75z', 'M12 3.25v17.5', 'M10.5 11.25v2.25', 'M13.5 11.25v2.25'],
  },
  cabinet: {
    paths: [
      'M4 5.25h16v13.5H4z',
      'M4 12h16',
      'M10.75 8.75v1.75',
      'M13.25 8.75v1.75',
      'M10.75 14.5v1.75',
      'M13.25 14.5v1.75',
    ],
  },
  shelf: { paths: ['M4.5 3.75h15v16.5h-15z', 'M4.5 9.25h15', 'M4.5 14.75h15'] },
  fridge: {
    paths: ['M5.75 2.75h12.5v18.5H5.75z', 'M5.75 9.25h12.5', 'M12 5.5v2.25', 'M12 11.5v2.75'],
  },
  freezer: {
    paths: [
      'M3 8.5h18v9.75H3z',
      'M3 11h18',
      'M12 12.75v3.75',
      'M10.4 13.5 13.6 15.75',
      'M13.6 13.5 10.4 15.75',
    ],
  },
  washer: {
    paths: [
      'M4.5 3.5h15v17h-15z',
      'M4.5 8h15',
      'M12 10a3.75 3.75 0 1 1 0 7.5 3.75 3.75 0 0 1 0-7.5Z',
      'M8 5.75h.01',
      'M16 5.75h.01',
    ],
  },
  oven: {
    paths: [
      'M4.5 4.5h15v15h-15z',
      'M4.5 9.5h15',
      'M7.75 12.25h8.5v5h-8.5z',
      'M9 7h.01',
      'M15 7h.01',
    ],
  },
  ac: {
    paths: [
      'M3.25 6.5h17.5v5.5H3.25z',
      'M5.75 10h12.5',
      'M8 14.75v3.5',
      'M12 14.75v3.5',
      'M16 14.75v3.5',
    ],
  },
  tv: { paths: ['M3 4.5h18v11.5H3z', 'M12 16v2.5', 'M8 19h8'] },
  piano: {
    paths: [
      'M4 5h16v12H4z',
      'M4 12.5h16',
      'M8 12.5v4.5',
      'M12 12.5v4.5',
      'M16 12.5v4.5',
      'M6 17v2.25',
      'M18 17v2.25',
    ],
  },
  plant: {
    paths: [
      'M8 14.5h8l-1.25 5.25h-5.5z',
      'M12 14.5V9.25',
      'M12 11.5c-3 0-4.5-1.5-4.5-4.25 2.75 0 4.5 1.5 4.5 4.25Z',
      'M12 11.5c3 0 4.5-1.5 4.5-4.25-2.75 0-4.5 1.5-4.5 4.25Z',
    ],
  },
  rug: { paths: ['M3.5 7.5h17v9h-17z', 'M6 10h12', 'M6 14h12'] },
  suitcase: { paths: ['M3.75 8h16.5v11H3.75z', 'M9 8V5.75h6V8', 'M9.5 8v11', 'M14.5 8v11'] },

  /**
   * The placeholder every unresolved key lands on. A question mark is the same
   * character in Hebrew and in English, so this one glyph does not need a twin.
   */
  question: {
    paths: [
      'M12 3.25a8.75 8.75 0 1 1 0 17.5 8.75 8.75 0 0 1 0-17.5Z',
      'M9.6 9.5a2.5 2.5 0 1 1 3.4 2.35c-.8.3-1 .9-1 1.6v.55',
      'M12 16.6h.01',
    ],
  },
} as const satisfies Readonly<Record<string, IconDefinition>>;

export type IconName = keyof typeof ICON_GLYPHS;

/** Every drawn glyph, for a picker, a token table, or an exhaustive test. */
export const iconNames: readonly IconName[] = Object.keys(ICON_GLYPHS) as IconName[];

/**
 * The glyph an unresolved key becomes. Not `box`: a box drawn for a treadmill is
 * the icon telling the customer something untrue about what we are about to
 * carry, and the tile already names the item beside it.
 */
export const FALLBACK_ICON: IconName = 'question';

export function isIconName(key: string): key is IconName {
  return Object.hasOwn(ICON_GLYPHS, key);
}

/**
 * The one door between the catalog's open `icon` string and this closed set.
 *
 * It resolves rather than throws, because the catalog is data an operator edits
 * and a row naming a glyph nobody has drawn yet must not be able to take the
 * item picker down. The `fallback` is a parameter so a surface that has a better
 * neutral than a question mark — a category header, say — can say so.
 */
export function resolveIconName(key: string, fallback: IconName = FALLBACK_ICON): IconName {
  return isIconName(key) ? key : fallback;
}
