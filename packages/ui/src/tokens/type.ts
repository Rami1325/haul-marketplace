/**
 * ---------------------------------------------------------------------------
 * Type
 * ---------------------------------------------------------------------------
 * Two questions decide this module, and only one of them is aesthetic.
 *
 * The aesthetic one: Israeli road signage is not DIN. The Ministry of Transport
 * specifies Tamrurim and Narkiss Tam for Hebrew and Triumvirate — a Helvetica
 * derivative — for Latin and numerals, so the honest reference is an open-
 * countered neo-grotesque and the "condensed signage face" half of the original
 * plan has to go. Hebrew cannot be condensed the way Latin can: its letters are
 * square, carry almost no ascenders or descenders, and separate mainly by
 * counter shape, so narrowing them collapses ב against כ and ד against ר at
 * exactly the moment a sign has to be read fastest. Signage authority therefore
 * comes from weight and mass rather than width, which is Heebo at 700–900.
 *
 * The structural one, which actually picked the faces: **money has to line up
 * down a receipt, in every rendering path we ship.** Digits align either because
 * the font applies a `tnum` OpenType feature or because its digits already share
 * one advance width. The first mechanism is the one everybody cites and it is
 * the fragile one — React Native on Android, canvas rendering and PDF/receipt
 * generators all drop OpenType features silently, and a receipt whose columns
 * drift is a receipt a customer distrusts.
 *
 * So the faces were chosen by parsing the actual TTFs from google/fonts with
 * fontTools (GSUB feature list plus hmtx advance widths), not from specimens:
 *
 * - **Heebo** ships *no* `tnum` and does not need one — all ten digits already
 *   share a single advance at every point on the weight axis (1121 units at 100,
 *   1151 at 400, 1158 at 500, 1176 at 700, 1192 at 900). This is why every
 *   numeral in HAUL is Heebo rather than the body face. Oded Ezer's Hebrew over
 *   Roboto's DIN-adjacent Latin is also the closest open face to real Israeli
 *   sign practice in both scripts.
 * - **Rubik** has proportional digits by default but does ship `tnum`, and all
 *   ten resolve to one advance at every weight. Alignment therefore works and is
 *   feature-dependent, which is exactly why Rubik must never carry a price.
 *   Numbers inside a sentence are better proportional anyway.
 * - **Roboto Mono** is monospaced by construction. It also has **no ₪ glyph**,
 *   which is why mono never carries money; use `toDecimalString()` from
 *   `@haul/types`, which is symbol-free by design, for any mono context.
 *
 * Assistant is the most common Israeli UI face (gov.il uses it) and is
 * disqualified: no `tnum` *and* proportional digits, so its money can never be
 * aligned by any CSS at all. Alef and Karantina fail identically. Noto Sans
 * Hebrew is the only genuine open condensed Hebrew and it condenses the script
 * that must not be condensed.
 *
 * A serif body was dropped outright. Hebrew's serif tradition is Frank Ruehl,
 * whose stress runs horizontal rather than vertical, so it thins out at UI sizes
 * in sunlight and connotes newspaper and government form rather than warmth. The
 * warmth comes instead from the paper ground, from leading more generous than
 * Latin needs (Hebrew has no ascender rhythm to create texture) and from Rubik's
 * softened corners.
 *
 * `font-variant-numeric: tabular-nums` is still declared on money even though
 * Heebo ignores it. It is a no-op on the face we ship and it promotes the
 * *fallback* stack to tabular on the day Heebo fails to load, which is the only
 * day it matters.
 *
 * Self-hosted for WS-5, so no request leaves for a font CDN and the ₪ cannot
 * arrive late: `@fontsource-variable/heebo@5.3.0`,
 * `@fontsource-variable/rubik@5.3.0`, `@fontsource-variable/roboto-mono@5.3.0`.
 * ₪ (U+20AA) lives in Fontsource's `hebrew` and `latin-ext` subsets, so the
 * Hebrew subset must be loaded or the largest glyph on the Price Card falls back
 * to a system face.
 * ---------------------------------------------------------------------------
 */

/**
 * Every dimension in this system is expressed against this. Browsers default to
 * 16px and a user who changes it is telling us something we should obey, so
 * token values are stored in rem and this constant exists only to convert.
 */
export const ROOT_FONT_SIZE_PX = 16;

/** ₪ U+20AA. Kept as a named constant so the subset requirement is greppable. */
export const SHEKEL_SIGN = '₪';

export function remFromPx(px: number): string {
  return px === 0 ? '0' : `${px / ROOT_FONT_SIZE_PX}rem`;
}

export const fontFamilies = {
  display:
    "'Heebo Variable', Heebo, Bahnschrift, 'DIN Alternate', Roboto, 'Noto Sans Hebrew', 'Arial Hebrew', system-ui, sans-serif",
  body: "'Rubik Variable', Rubik, 'Noto Sans Hebrew', 'Arial Hebrew', 'Segoe UI', system-ui, sans-serif",
  mono: "'Roboto Mono Variable', 'Roboto Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
} as const;

export type FontFamilyToken = keyof typeof fontFamilies;

/**
 * What the shipped TTFs actually contain. These are measurements, not opinions,
 * and they are recorded as data so the rule "money is set in the display face"
 * can be *derived* from them by a test rather than trusted as a comment.
 */
export interface TypefaceFacts {
  /** All ten digits share one advance width with no feature applied. */
  readonly digitsAlreadyTabular: boolean;
  /** Ships a `tnum` feature — alignment that a silent feature drop can undo. */
  readonly hasTnumFeature: boolean;
  /** Contains ₪ U+20AA. */
  readonly hasShekelSign: boolean;
}

export const typefaceFacts = {
  display: { digitsAlreadyTabular: true, hasTnumFeature: false, hasShekelSign: true },
  body: { digitsAlreadyTabular: false, hasTnumFeature: true, hasShekelSign: true },
  mono: { digitsAlreadyTabular: true, hasTnumFeature: false, hasShekelSign: false },
} as const satisfies Readonly<Record<FontFamilyToken, TypefaceFacts>>;

/**
 * The face every price, payout and receipt line is set in. Not a style choice —
 * see `typefaceFacts`, and the test that re-derives this from them.
 */
export const moneyFontFamily: FontFamilyToken = 'display';

/**
 * Declared on money even though the chosen face ignores it. See the header:
 * it is insurance on the fallback stack, not on Heebo.
 */
export const tabularNumerals = 'tabular-nums';

/**
 * The generated utility that carries the whole figure treatment — the display
 * face, tabular numerals, and `font-feature-settings: normal` to stop an
 * ancestor's `pnum` from un-aligning a column.
 *
 * It lives here, in the token layer, because more than one component sets
 * figures: the locked total on the Price Card, the value inside a numeric
 * field, the quantity on a stepper. Each of those spelling the rule out for
 * itself is how two of them end up with the font but not the feature reset, and
 * a receipt whose digits stop lining up is the failure the face was chosen to
 * prevent. `scripts/build-theme-css.mts` emits the matching `@utility` from the
 * same tokens.
 */
export const tabularFiguresClass = 'tabular';

/**
 * The five steps, in rem, taken verbatim from `PLAN.html`'s own CSS. The plan
 * document is rendered in this system, so its ramp is the ramp.
 */
export const fontSizeRem = {
  'step-0': 1.0625,
  'step-1': 1.3,
  'step-2': 1.65,
  'step-3': 2.1,
  'step-4': 3.2,
} as const;

export type FontSizeStep = keyof typeof fontSizeRem;

/**
 * Names fixed by `lib/cn.ts`, which declares this scale to tailwind-merge so
 * that `text-step-2` and `text-step-3` de-conflict. Rename a step here and
 * className overrides stop resolving — silently, in every component.
 */
export const fontSizeSteps = ['step-0', 'step-1', 'step-2', 'step-3', 'step-4'] as const;

export const fontSizes = {
  'step-0': '1.0625rem',
  'step-1': '1.3rem',
  'step-2': '1.65rem',
  'step-3': '2.1rem',
  'step-4': '3.2rem',
} as const satisfies Readonly<Record<FontSizeStep, string>>;

/** For React Native, which takes numbers. Asserted against `fontSizes` by test. */
export const fontSizePx = {
  'step-0': 17,
  'step-1': 20.8,
  'step-2': 26.4,
  'step-3': 33.6,
  'step-4': 51.2,
} as const satisfies Readonly<Record<FontSizeStep, number>>;

/**
 * Unitless, and looser than a Latin-only system would set them. Hebrew has no
 * ascender rhythm to give a paragraph texture, so the space between lines is
 * doing work that descenders do in Latin. Leading tightens as size grows,
 * because a 3.2rem price does not need 1.6 lines of air around it.
 */
export const lineHeights = {
  'step-0': 1.6,
  'step-1': 1.45,
  'step-2': 1.3,
  'step-3': 1.2,
  'step-4': 1.05,
} as const satisfies Readonly<Record<FontSizeStep, number>>;

export const fontWeights = {
  regular: 400,
  medium: 500,
  semibold: 600,
  /** The floor for signage weight — authority here comes from mass, not width. */
  bold: 700,
  black: 900,
} as const;

export type FontWeightToken = keyof typeof fontWeights;

/**
 * WCAG's definition of large text, in rem. It is the hinge for the whole `ink3`
 * usage rule: that tone clears 3:1 but not 4.5:1 in the fixed light palette, so
 * whether a given step may use it is a computation, not a judgement call.
 */
export const largeTextThreshold = {
  /** 24px. */
  regularRem: 1.5,
  /** 18.66px. */
  boldRem: 1.16625,
  /** At or above this weight, the lower size threshold applies. */
  boldWeight: 700,
} as const;

export function isLargeText(step: FontSizeStep, weight: number): boolean {
  const rem = fontSizeRem[step];
  return weight >= largeTextThreshold.boldWeight
    ? rem >= largeTextThreshold.boldRem
    : rem >= largeTextThreshold.regularRem;
}
