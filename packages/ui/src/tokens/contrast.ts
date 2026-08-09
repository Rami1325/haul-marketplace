/**
 * ---------------------------------------------------------------------------
 * Contrast
 * ---------------------------------------------------------------------------
 * The palette above this module is a set of claims: that `ink3` is a tertiary
 * tone and not body copy, that the amber chip's figure is set in ink, that a
 * focus ring cannot be one colour. This module exists so those claims are
 * *computed* rather than believed, and so the tests can compute them too.
 *
 * Contrast is the one part of a design system where intuition is reliably
 * wrong. Two colours that look plainly different can measure 1.9:1, and the eye
 * is worst at exactly the judgement that matters — a mid-tone on a mid-tone,
 * viewed on a good monitor indoors, by a person who already knows what the text
 * says. `PLAN.html` asks for a contrast check done outdoors in sunlight because
 * that is where the driver app is used; this is the part of that check a machine
 * can do, and a machine should do all of it that it can.
 *
 * The maths is WCAG 2.1 and is implemented exactly as specified, including the
 * piecewise sRGB transfer with its 0.03928 knee. Approximating that with a
 * plain `pow(c, 2.2)` is the common shortcut and it moves ratios by a few
 * percent near the dark end — which is precisely the region where the dark
 * theme's grounds live, and precisely where a pairing sits close enough to 4.5
 * for a few percent to decide it. The implementation is validated against the
 * canonical boundary greys: #FFF on #000 is exactly 21, #767676 on white is
 * 4.54 (the darkest grey that passes AA body text) and #949494 on white is 3.03.
 *
 * `darkerLuminanceFor` and `lighterLuminanceFor` are here because two of this
 * system's design decisions rest on a pair of constraints having *no* solution,
 * not on a value being hard to find. In dark mode the amber fill would need to
 * be darker than luminance 0.13972 to carry AA text and lighter than 0.14404 to
 * draw a 3:1 boundary; the window is empty, so the boundary is drawn by an amber
 * hairline instead. The focus ring contradicts itself the same way in both
 * themes, which is why it is two-tone. Those are proofs, and a proof written as
 * a comment is a rumour — solving them explicitly lets the test assert the
 * window is empty rather than assert a hex value someone once chose.
 * ---------------------------------------------------------------------------
 */

/** The thresholds, named. `nonText` is WCAG 1.4.11 — UI boundaries and graphics. */
export const WCAG = {
  aaBody: 4.5,
  aaLarge: 3,
  aaaBody: 7,
  aaaLarge: 4.5,
  nonText: 3,
} as const;

export interface TextSizeOptions {
  /** At least 24px, or 18.66px bold. See `isLargeText` in `type.ts`. */
  large?: boolean;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** sRGB 0–255 channels. */
interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function parseHex(hex: string): Rgb {
  if (!HEX.test(hex)) {
    throw new TypeError(`contrast: expected a 6-digit hex colour like #14181A, got ${hex}`);
  }
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

/**
 * Undo the sRGB transfer for one channel. The knee at 0.03928 is a linear
 * segment, not a curve — sRGB is not a pure power function and the difference
 * lives entirely in the darkest few percent, which is where this product's dark
 * grounds are.
 */
function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 relative luminance: 0 for black, 1 for white. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Symmetric by construction — WCAG defines the ratio on the lighter and darker
 * of the two, not on foreground and background, so a caller cannot get a wrong
 * answer by passing them in the other order.
 */
export function contrastRatio(a: string, b: string): number {
  return luminanceRatio(relativeLuminance(a), relativeLuminance(b));
}

/** The same ratio, for callers already holding luminances. */
export function luminanceRatio(a: number, b: number): number {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsAA(ratio: number, options: TextSizeOptions = {}): boolean {
  return ratio >= (options.large ? WCAG.aaLarge : WCAG.aaBody);
}

export function meetsAAA(ratio: number, options: TextSizeOptions = {}): boolean {
  return ratio >= (options.large ? WCAG.aaaLarge : WCAG.aaaBody);
}

/** Non-text contrast (WCAG 1.4.11): control boundaries, focus indicators, icons. */
export function meetsNonText(ratio: number): boolean {
  return ratio >= WCAG.nonText;
}

/**
 * Given the lighter colour, the *ceiling* on the darker one: the highest
 * luminance it may have and still reach `ratio`. Solving for a fill that has to
 * carry known text. The result may be negative when the ratio is unreachable
 * against that lighter colour at all; that is a meaningful answer, so it is
 * returned rather than clamped.
 */
export function darkerLuminanceFor(lighter: number, ratio: number): number {
  return (lighter + 0.05) / ratio - 0.05;
}

/**
 * Given the darker colour, the *floor* on the lighter one. The other half of the
 * same solve — used to ask what a fill must be to separate from its ground.
 */
export function lighterLuminanceFor(darker: number, ratio: number): number {
  return ratio * (darker + 0.05) - 0.05;
}
