import { describe, expect, it } from 'vitest';
import {
  colorCssNames,
  colorThemes,
  darkColors,
  lightColors,
  type ColorScale,
  type ColorToken,
  type ThemeName,
} from '../tokens/color.js';
import {
  WCAG,
  contrastRatio,
  darkerLuminanceFor,
  lighterLuminanceFor,
  luminanceRatio,
  meetsAA,
  meetsAAA,
  meetsNonText,
  relativeLuminance,
} from '../tokens/contrast.js';
import { fontSizeSteps, fontWeights, isLargeText, type FontSizeStep } from '../tokens/type.js';

/**
 * Contrast is asserted here, never claimed in a comment. Two things are being
 * tested and they are different things:
 *
 *   1. That the WCAG maths is right. Checked against the canonical reference
 *      values before anything else, because every figure below is downstream of
 *      it and a subtly wrong transfer function would make the whole file agree
 *      with itself and disagree with reality.
 *   2. That every real pairing in the product clears its requirement, in *both*
 *      themes — and that the handful which cannot are named, measured, and
 *      pointed at the substitute the system uses instead. A failing pairing that
 *      is quietly omitted from a contrast test is worse than no test: it reads
 *      as coverage.
 *
 * The `expected` figures are the researched values. They are cross-checks, not
 * sources — the assertions that matter run against the computed ratio.
 */

const THEMES: readonly ThemeName[] = ['light', 'dark'];

/** `body` is 4.5:1. `large` and `nonText` are both 3:1, for different reasons. */
type Requirement = 'body' | 'large' | 'nonText';

interface Pairing {
  readonly name: string;
  readonly fg: ColorToken;
  readonly bg: ColorToken;
  readonly need: Requirement;
  readonly expected: Readonly<Record<ThemeName, number>>;
}

function scaleFor(theme: ThemeName): ColorScale {
  return colorThemes[theme];
}

function ratioIn(theme: ThemeName, fg: ColorToken, bg: ColorToken): number {
  const scale = scaleFor(theme);
  return contrastRatio(scale[fg], scale[bg]);
}

function clears(ratio: number, need: Requirement): boolean {
  if (need === 'body') return meetsAA(ratio);
  if (need === 'large') return meetsAA(ratio, { large: true });
  return meetsNonText(ratio);
}

function luminanceIn(theme: ThemeName, token: ColorToken): number {
  return relativeLuminance(scaleFor(theme)[token]);
}

/** Both themes must clear the requirement. There is no theme-conditional component. */
const PAIRINGS: readonly Pairing[] = [
  {
    name: 'ink on paper',
    fg: 'ink',
    bg: 'paper',
    need: 'body',
    expected: { light: 15.74, dark: 14.51 },
  },
  {
    name: 'ink on card',
    fg: 'ink',
    bg: 'card',
    need: 'body',
    expected: { light: 17.22, dark: 13.2 },
  },
  {
    name: 'ink on paper-2',
    fg: 'ink',
    bg: 'paper2',
    need: 'body',
    expected: { light: 14.46, dark: 15.59 },
  },
  {
    name: 'ink-2 on paper',
    fg: 'ink2',
    bg: 'paper',
    need: 'body',
    expected: { light: 8.34, dark: 8.27 },
  },
  {
    name: 'ink-2 on card',
    fg: 'ink2',
    bg: 'card',
    need: 'body',
    expected: { light: 9.13, dark: 7.53 },
  },
  {
    name: 'ink-2 on paper-2',
    fg: 'ink2',
    bg: 'paper2',
    need: 'body',
    expected: { light: 7.66, dark: 8.89 },
  },
  {
    name: 'ink-3 on card',
    fg: 'ink3',
    bg: 'card',
    need: 'body',
    expected: { light: 4.63, dark: 4.6 },
  },
  {
    name: 'ink-3 on paper, as a control boundary or large text',
    fg: 'ink3',
    bg: 'paper',
    need: 'large',
    expected: { light: 4.23, dark: 5.05 },
  },
  {
    name: 'on-route on route',
    fg: 'onRoute',
    bg: 'route',
    need: 'body',
    expected: { light: 7.63, dark: 6.62 },
  },
  {
    name: 'on-route on route-deep (pressed)',
    fg: 'onRoute',
    bg: 'routeDeep',
    need: 'body',
    expected: { light: 10.23, dark: 8.45 },
  },
  {
    name: 'route on paper',
    fg: 'route',
    bg: 'paper',
    need: 'body',
    expected: { light: 7.45, dark: 6.14 },
  },
  {
    name: 'route on card',
    fg: 'route',
    bg: 'card',
    need: 'body',
    expected: { light: 8.15, dark: 5.58 },
  },
  {
    name: 'route on paper-2',
    fg: 'route',
    bg: 'paper2',
    need: 'body',
    expected: { light: 6.84, dark: 6.6 },
  },
  {
    name: 'hivis on paper',
    fg: 'hivis',
    bg: 'paper',
    need: 'body',
    expected: { light: 4.73, dark: 8.42 },
  },
  {
    name: 'hivis on card',
    fg: 'hivis',
    bg: 'card',
    need: 'body',
    expected: { light: 5.18, dark: 7.67 },
  },
  {
    name: 'ink on hivis-fill',
    fg: 'ink',
    bg: 'hivisFill',
    need: 'body',
    expected: { light: 9.31, dark: 5.29 },
  },
  {
    name: 'rust on paper',
    fg: 'rust',
    bg: 'paper',
    need: 'body',
    expected: { light: 5.2, dark: 6.61 },
  },
  {
    name: 'rust on card',
    fg: 'rust',
    bg: 'card',
    need: 'body',
    expected: { light: 5.69, dark: 6.02 },
  },
  {
    name: 'rust on rust-soft',
    fg: 'rust',
    bg: 'rustSoft',
    need: 'body',
    expected: { light: 4.54, dark: 5.78 },
  },
  {
    name: 'ink on rust-soft',
    fg: 'ink',
    bg: 'rustSoft',
    need: 'body',
    expected: { light: 13.74, dark: 12.68 },
  },
];

interface KnownException extends Pairing {
  /** Themes in which this pairing genuinely does not reach its requirement. */
  readonly failsIn: readonly ThemeName[];
  /** What the system does instead. Every one of these is asserted below. */
  readonly instead: string;
}

const KNOWN_EXCEPTIONS: readonly KnownException[] = [
  {
    name: 'ink-3 on paper as body text',
    fg: 'ink3',
    bg: 'paper',
    need: 'body',
    failsIn: ['light'],
    expected: { light: 4.23, dark: 5.05 },
    instead:
      'ink-2 carries secondary running text. The light palette is fixed, so this is a usage rule rather than a hex change: ink-3 is for large text, non-text, or control boundaries only. Dark clears 4.5:1 and is still governed by the light figure, because a component must not be AA in one theme and not the other.',
  },
  {
    name: 'hivis on hivis-fill (amber text on amber fill)',
    fg: 'hivis',
    bg: 'hivisFill',
    need: 'body',
    failsIn: ['light', 'dark'],
    expected: { light: 2.8, dark: 3.07 },
    instead:
      'The money figure inside an amber chip is set in ink, which clears AA on the fill in both themes. This is the pairing most likely to be reached for by instinct when building the Price Card, so it is named here.',
  },
  {
    name: 'hivis-fill on paper, as a boundary',
    fg: 'hivisFill',
    bg: 'paper',
    need: 'nonText',
    failsIn: ['light', 'dark'],
    expected: { light: 1.69, dark: 2.74 },
    instead:
      'Every amber chip carries a 1px hivis hairline, and the hairline clears 3:1 in both themes. A bare amber fill with no text and no hairline is not a permitted construction.',
  },
  {
    name: 'hivis-fill on card, as a boundary',
    fg: 'hivisFill',
    bg: 'card',
    need: 'nonText',
    failsIn: ['light', 'dark'],
    expected: { light: 1.85, dark: 2.49 },
    instead:
      'The same hivis hairline. In dark mode this failure is provably unfixable — see the empty-window proof.',
  },
  {
    name: 'rust-soft on paper, as a boundary',
    fg: 'rustSoft',
    bg: 'paper',
    need: 'nonText',
    failsIn: ['light', 'dark'],
    expected: { light: 1.15, dark: 1.14 },
    instead:
      'An error ground is a tint, not a boundary. The error state is identified by rust text plus a rust border, both well past 3:1, plus an icon or wording. Colour alone never carries the state.',
  },
  {
    name: 'line on paper (hairline)',
    fg: 'line',
    bg: 'paper',
    need: 'nonText',
    failsIn: ['light', 'dark'],
    expected: { light: 1.29, dark: 1.23 },
    instead:
      'ink-3 draws any border that identifies a control. line and line-2 are for dividers, table rules and card edges, where a 3:1 border stops looking like a rule and starts looking like a frame.',
  },
  {
    name: 'line-2 on paper',
    fg: 'line2',
    bg: 'paper',
    need: 'nonText',
    failsIn: ['light', 'dark'],
    expected: { light: 1.57, dark: 1.59 },
    instead:
      'ink-3 again. line-2 is the stronger of the two hairlines and it is still a hairline — its job is to separate two regions of the same surface, not to identify a control.',
  },
  {
    name: 'line-2 on card',
    fg: 'line2',
    bg: 'card',
    need: 'nonText',
    failsIn: ['light', 'dark'],
    expected: { light: 1.71, dark: 1.44 },
    instead:
      'ink-3 again. Note the ratio moves in opposite directions across the themes, which is expected: these values were calibrated to reproduce the light theme’s relationships, not to chase a threshold they were never meant to meet.',
  },
  {
    name: 'card on paper (surface separation)',
    fg: 'card',
    bg: 'paper',
    need: 'nonText',
    failsIn: ['light', 'dark'],
    expected: { light: 1.09, dark: 1.1 },
    instead:
      'A raised surface is identified by a line edge and by elevation, not by a 3:1 step against the page — at 3:1 it would stop being a surface and start being a block.',
  },
  {
    name: 'paper-2 on paper (surface separation)',
    fg: 'paper2',
    bg: 'paper',
    need: 'nonText',
    failsIn: ['light', 'dark'],
    expected: { light: 1.09, dark: 1.07 },
    instead:
      'A recessed well must also carry a line hairline. The inset is drawn, not merely tinted — 1.07:1 is below the threshold for identifying a recessed field by luminance alone across a large area.',
  },
];

const everyThemedPairing = [...PAIRINGS, ...KNOWN_EXCEPTIONS].flatMap((pairing) =>
  THEMES.map((theme) => ({ ...pairing, theme })),
);

describe('the WCAG 2.1 maths', () => {
  it('puts white at luminance 1 and black at 0', () => {
    expect(relativeLuminance('#FFFFFF')).toBe(1);
    expect(relativeLuminance('#000000')).toBe(0);
  });

  it('gives white on black exactly 21:1', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBe(21);
  });

  it('gives a colour against itself exactly 1:1', () => {
    for (const token of Object.keys(lightColors) as ColorToken[]) {
      expect(contrastRatio(lightColors[token], lightColors[token])).toBe(1);
      expect(contrastRatio(darkColors[token], darkColors[token])).toBe(1);
    }
  });

  it('is symmetric — the ratio does not know which colour is the foreground', () => {
    expect(contrastRatio(lightColors.ink, lightColors.paper)).toBe(
      contrastRatio(lightColors.paper, lightColors.ink),
    );
  });

  it('matches the canonical AA boundary greys on white', () => {
    // #767676 is the darkest grey that passes AA body text on white; #949494 is
    // the darkest that passes the 3:1 bar. If the transfer function were a plain
    // gamma 2.2 approximation, both of these would drift.
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#949494', '#FFFFFF')).toBeCloseTo(3.03, 2);
    expect(meetsAA(contrastRatio('#767676', '#FFFFFF'))).toBe(true);
    expect(meetsAA(contrastRatio('#949494', '#FFFFFF'), { large: true })).toBe(true);
  });

  it('implements the piecewise transfer, not a pure power curve', () => {
    // 10/255 sits below the 0.03928 knee and must take the linear branch
    // exactly; 11/255 sits above it and must not.
    expect(relativeLuminance('#0A0A0A')).toBeCloseTo(10 / 255 / 12.92, 12);
    expect(relativeLuminance('#0B0B0B')).not.toBeCloseTo(11 / 255 / 12.92, 6);
  });

  it('refuses anything that is not a 6-digit hex', () => {
    expect(() => relativeLuminance('#FFF')).toThrow(TypeError);
    expect(() => relativeLuminance('FFFFFF')).toThrow(TypeError);
    expect(() => relativeLuminance('#GGGGGG')).toThrow(TypeError);
    expect(() => relativeLuminance('')).toThrow(TypeError);
  });

  it('solves the luminance constraints in both directions', () => {
    const ground = relativeLuminance('#121917');
    const needed = lighterLuminanceFor(ground, 4.5);
    expect(luminanceRatio(needed, ground)).toBeCloseTo(4.5, 10);

    const foreground = relativeLuminance('#E4E9E4');
    const ceiling = darkerLuminanceFor(foreground, 4.5);
    expect(luminanceRatio(foreground, ceiling)).toBeCloseTo(4.5, 10);
  });
});

describe('the AA and AAA thresholds', () => {
  it('places AA at 4.5 for body and 3 for large', () => {
    expect(meetsAA(4.5)).toBe(true);
    expect(meetsAA(4.4999)).toBe(false);
    expect(meetsAA(3, { large: true })).toBe(true);
    expect(meetsAA(2.9999, { large: true })).toBe(false);
  });

  it('places AAA at 7 for body and 4.5 for large', () => {
    expect(meetsAAA(7)).toBe(true);
    expect(meetsAAA(6.9999)).toBe(false);
    expect(meetsAAA(4.5, { large: true })).toBe(true);
    expect(meetsAAA(4.4999, { large: true })).toBe(false);
  });

  it('places non-text contrast at 3', () => {
    expect(meetsNonText(WCAG.nonText)).toBe(true);
    expect(meetsNonText(2.9999)).toBe(false);
  });
});

describe('the implementation agrees with the research it was given', () => {
  it.each(everyThemedPairing)('$theme — $name', ({ theme, fg, bg, expected }) => {
    // The researched figures are quoted to two decimals, so anything under 0.01
    // is rounding. Anything over it is a disagreement worth stopping for.
    expect(Math.abs(ratioIn(theme, fg, bg) - expected[theme])).toBeLessThan(0.01);
  });
});

describe('every real UI pairing clears its requirement, in both themes', () => {
  it.each(PAIRINGS.flatMap((pairing) => THEMES.map((theme) => ({ ...pairing, theme }))))(
    '$theme — $name',
    ({ theme, fg, bg, need }) => {
      expect(clears(ratioIn(theme, fg, bg), need)).toBe(true);
    },
  );
});

describe('known exceptions — asserted by name, never quietly omitted', () => {
  it.each(KNOWN_EXCEPTIONS)('$name', ({ fg, bg, need, failsIn }) => {
    for (const theme of THEMES) {
      const fails = failsIn.includes(theme);
      expect(clears(ratioIn(theme, fg, bg), need)).toBe(!fails);
    }
    // An "exception" that passes everywhere is a stale entry, not an exception.
    expect(failsIn.length).toBeGreaterThan(0);
  });

  it('names a substitute for every exception, and the substitute is a real token', () => {
    // The prose is documentation; the assertion is that it points at something
    // this palette actually contains, so "use something else" cannot be the
    // answer on file.
    for (const exception of KNOWN_EXCEPTIONS) {
      const named = (Object.keys(lightColors) as ColorToken[]).filter((token) =>
        exception.instead.includes(colorCssNames[token]),
      );
      expect(named.length, exception.name).toBeGreaterThan(0);
    }
  });

  describe('and each substitute is itself asserted', () => {
    it.each(THEMES)('%s — ink-2 carries secondary running text where ink-3 cannot', (theme) => {
      expect(meetsAA(ratioIn(theme, 'ink2', 'paper'))).toBe(true);
      expect(meetsAA(ratioIn(theme, 'ink2', 'card'))).toBe(true);
      expect(meetsAA(ratioIn(theme, 'ink2', 'paper2'))).toBe(true);
    });

    it.each(THEMES)('%s — ink sets the figure inside an amber chip', (theme) => {
      expect(meetsAA(ratioIn(theme, 'ink', 'hivisFill'))).toBe(true);
    });

    it.each(THEMES)('%s — a hivis hairline draws the boundary the fill cannot', (theme) => {
      expect(meetsNonText(ratioIn(theme, 'hivis', 'paper'))).toBe(true);
      expect(meetsNonText(ratioIn(theme, 'hivis', 'card'))).toBe(true);
    });

    it.each(THEMES)('%s — the error state is carried by rust text and a rust border', (theme) => {
      expect(meetsAA(ratioIn(theme, 'rust', 'rustSoft'))).toBe(true);
      expect(meetsNonText(ratioIn(theme, 'rust', 'paper'))).toBe(true);
      expect(meetsNonText(ratioIn(theme, 'rust', 'card'))).toBe(true);
    });

    it.each(THEMES)('%s — ink-3 draws any border that identifies a control', (theme) => {
      expect(meetsNonText(ratioIn(theme, 'ink3', 'paper'))).toBe(true);
      expect(meetsNonText(ratioIn(theme, 'ink3', 'card'))).toBe(true);
      expect(meetsNonText(ratioIn(theme, 'ink3', 'paper2'))).toBe(true);
    });
  });
});

describe('the invariants the palette was built around', () => {
  it.each(THEMES)(
    '%s — bg-hivis-fill takes ink in both themes, so no chip needs a theme switch',
    (theme) => {
      expect(meetsAA(ratioIn(theme, 'ink', 'hivisFill'))).toBe(true);
      // ...and the instinctive alternative is out of the question in both.
      expect(meetsAA(ratioIn(theme, 'hivis', 'hivisFill'))).toBe(false);
    },
  );

  it('proves the dark amber fill cannot also be a boundary — the window is empty', () => {
    const inkLuminance = relativeLuminance(darkColors.ink);
    const cardLuminance = relativeLuminance(darkColors.card);

    // To carry AA body text in ink, the fill must be no lighter than this.
    const ceiling = darkerLuminanceFor(inkLuminance, WCAG.aaBody);
    // To draw a 3:1 boundary against the raised surface, no darker than this.
    const floor = lighterLuminanceFor(cardLuminance, WCAG.nonText);

    expect(ceiling).toBeLessThan(floor);

    // And the window is empty *only* because ink is #E4E9E4 rather than white.
    // This is the direct, measurable price of the anti-halation decision, and it
    // is a price worth paying: text legibility beats a decorative boundary.
    expect(darkerLuminanceFor(relativeLuminance('#FFFFFF'), WCAG.aaBody)).toBeGreaterThan(floor);
  });

  it.each(THEMES)('%s — no single colour can be the focus ring', (theme) => {
    // Against a reference, the luminances reaching a ratio form two half-lines.
    // Clip them to the displayable range and intersect: an empty intersection is
    // a proof, not a failure to search hard enough.
    const admissible = (reference: number): ReadonlyArray<readonly [number, number]> => {
      const spans: Array<readonly [number, number]> = [];
      const below = darkerLuminanceFor(reference, WCAG.nonText);
      if (below >= 0) spans.push([0, below]);
      const above = lighterLuminanceFor(reference, WCAG.nonText);
      if (above <= 1) spans.push([above, 1]);
      return spans;
    };

    const againstFill = admissible(luminanceIn(theme, 'route'));
    const againstPage = admissible(luminanceIn(theme, 'paper'));

    const overlaps = againstFill.some(([a0, a1]) =>
      againstPage.some(([b0, b1]) => Math.max(a0, b0) <= Math.min(a1, b1)),
    );
    expect(overlaps).toBe(false);
  });

  it.each(THEMES)('%s — so the ring is two-tone, and both tones are asserted', (theme) => {
    // Inner hairline in paper, against the primary fill it sits on.
    expect(meetsNonText(ratioIn(theme, 'paper', 'route'))).toBe(true);
    // Outer ring in ink-2, against the page.
    expect(meetsNonText(ratioIn(theme, 'ink2', 'paper'))).toBe(true);
  });

  it.each(THEMES)('%s — hivis is not a candidate for the focus ring', (theme) => {
    // Invisible on the primary fill, and it would break the rule that amber
    // means money or attention and nothing else.
    expect(meetsNonText(ratioIn(theme, 'hivis', 'route'))).toBe(false);
  });

  it.each(THEMES)('%s — pressing the primary always raises the label contrast', (theme) => {
    expect(ratioIn(theme, 'onRoute', 'routeDeep')).toBeGreaterThan(
      ratioIn(theme, 'onRoute', 'route'),
    );
  });

  it('route-deep means further from the ground, which points opposite ways in the two themes', () => {
    expect(relativeLuminance(lightColors.routeDeep)).toBeLessThan(
      relativeLuminance(lightColors.route),
    );
    expect(relativeLuminance(darkColors.routeDeep)).toBeGreaterThan(
      relativeLuminance(darkColors.route),
    );

    for (const theme of THEMES) {
      const ground = luminanceIn(theme, 'paper');
      const rest = Math.abs(luminanceIn(theme, 'route') - ground);
      const pressed = Math.abs(luminanceIn(theme, 'routeDeep') - ground);
      expect(pressed).toBeGreaterThan(rest);
    }
  });

  it('keeps on-route as the opposite theme ground, so the polarity flip is principled', () => {
    // Light's on-route is a paper tone; dark's is an asphalt tone. Neither is an
    // invented value, which is why the flip does not need a third token.
    expect(relativeLuminance(lightColors.onRoute)).toBeGreaterThan(0.5);
    expect(relativeLuminance(darkColors.onRoute)).toBeLessThan(0.05);
  });

  it.each(THEMES)('%s — raised is lighter than the page and recessed is darker', (theme) => {
    expect(luminanceIn(theme, 'card')).toBeGreaterThan(luminanceIn(theme, 'paper'));
    expect(luminanceIn(theme, 'paper2')).toBeLessThan(luminanceIn(theme, 'paper'));
  });

  it('holds the secondary tier at parity across the two themes', () => {
    // Deliberate: the themes should feel like one product, and ink-2 is where
    // that is cheapest to guarantee.
    const light = ratioIn('light', 'ink2', 'paper');
    const dark = ratioIn('dark', 'ink2', 'paper');
    expect(Math.abs(light - dark)).toBeLessThan(0.15);
  });

  it('never lets a dark surface reach true black', () => {
    // Halation on OLED, and the dark adaptation of a driver about to drive.
    for (const token of ['paper', 'paper2', 'card'] as const) {
      expect(luminanceIn('dark', token)).toBeGreaterThan(0);
    }
  });

  it('keeps the full-screen dark ground above Material’s #121212 floor, not at it', () => {
    expect(luminanceIn('dark', 'paper')).toBeGreaterThan(relativeLuminance('#121212'));
    // paper-2 is allowed below that floor precisely because it is inset-only —
    // a progress track or a table stripe, never the ground behind a screen of
    // body text — which is what keeps the darkest token clear of the argument.
    expect(luminanceIn('dark', 'paper2')).toBeLessThan(luminanceIn('dark', 'paper'));
  });

  it.each(THEMES)('%s — error and money stay apart in hue', (theme) => {
    // Both are warm, both are read at a glance under stress. If they converge, a
    // driver reads a failure as a payout.
    const scale = scaleFor(theme);
    expect(hueDistance(scale.rust, scale.hivis)).toBeGreaterThan(25);
    expect(hueDistance(scale.rust, scale.hivisFill)).toBeGreaterThan(25);
  });
});

describe('ink-3 is a tertiary tone, and the type ramp says where it may appear', () => {
  const weights = [fontWeights.regular, fontWeights.bold] as const;
  const cases = fontSizeSteps.flatMap((step) => weights.map((weight) => ({ step, weight })));

  /** Governed by the stricter theme: permitted only if it clears AA in both. */
  function permitted(step: FontSizeStep, weight: number): boolean {
    const large = isLargeText(step, weight);
    return THEMES.every((theme) => meetsAA(ratioIn(theme, 'ink3', 'paper'), { large }));
  }

  it.each(cases)('$step at weight $weight', ({ step, weight }) => {
    expect(permitted(step, weight)).toBe(isLargeText(step, weight));
  });

  it('never permits ink-3 at the body step, at any weight', () => {
    for (const weight of weights) {
      expect(permitted('step-0', weight)).toBe(false);
    }
  });

  it('permits ink-2 at every step in both themes, which is why it is the substitute', () => {
    for (const { step, weight } of cases) {
      const large = isLargeText(step, weight);
      for (const theme of THEMES) {
        expect(meetsAA(ratioIn(theme, 'ink2', 'paper'), { large })).toBe(true);
      }
    }
  });
});

/** Hue in degrees. Test-local: the palette does not ship a colour-space library. */
function hueOf(hex: string): number {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const high = Math.max(r, g, b);
  const low = Math.min(r, g, b);
  const chroma = high - low;
  if (chroma === 0) return 0;
  const sextant =
    high === r ? ((g - b) / chroma) % 6 : high === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
  return (sextant * 60 + 360) % 360;
}

function hueDistance(a: string, b: string): number {
  const delta = Math.abs(hueOf(a) - hueOf(b)) % 360;
  return Math.min(delta, 360 - delta);
}
