import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  colorCssNames,
  colorThemes,
  colorTokens,
  darkColors,
  lightColors,
  type ColorToken,
} from '../tokens/color.js';
import { tokens } from '../tokens/index.js';
import {
  MOTION_BAND_MS,
  durationMs,
  durationTokens,
  durations,
  easingCurves,
  easings,
  sheetSpring,
  type MotionDurationToken,
} from '../tokens/motion.js';
import { radius, radiusPx, radiusTokens } from '../tokens/radius.js';
import {
  MIN_TAP_TARGET,
  MIN_TAP_TARGET_PX,
  atLeastTapTarget,
  controlHeights,
  controlHeightsPx,
  controlSizes,
  iconSizes,
  iconSizesPx,
} from '../tokens/size.js';
import { space, spacePx, spaceTokens, type SpaceToken } from '../tokens/space.js';
import {
  ROOT_FONT_SIZE_PX,
  SHEKEL_SIGN,
  fontFamilies,
  fontSizePx,
  fontSizeRem,
  fontSizeSteps,
  fontSizes,
  fontWeights,
  lineHeights,
  moneyFontFamily,
  remFromPx,
  tabularNumerals,
  typefaceFacts,
  type FontFamilyToken,
} from '../tokens/type.js';

/**
 * The token file is the one place in a design system where a typo is invisible.
 * A misnamed colour renders as nothing, a dark token that was never declared
 * renders as nothing, a duration renamed out from under tailwind-merge stops
 * de-conflicting and nothing about that is visible in a diff. So the structure
 * is asserted rather than reviewed.
 */

const EXPECTED_COLOR_TOKENS: readonly ColorToken[] = [
  'paper',
  'paper2',
  'card',
  'ink',
  'ink2',
  'ink3',
  'line',
  'line2',
  'route',
  'routeDeep',
  'onRoute',
  'hivis',
  'hivisFill',
  'rust',
  'rustSoft',
];

/**
 * `lib/cn.ts` declares two of this system's scales to tailwind-merge, as
 * literals, so that module stays free of the token graph. That is the correct
 * trade and it leaves exactly one hazard: the two lists can drift. Reading the
 * source means a rename in *either* file fails here, rather than silently
 * turning every `className` override into a coin flip.
 */
const CN_PATH = resolve(process.cwd(), 'src/lib/cn.ts');
if (!existsSync(CN_PATH)) {
  throw new Error(
    `tokens.test: expected lib/cn.ts at ${CN_PATH}. If it moved, this test must follow it.`,
  );
}
const CN_SOURCE = readFileSync(CN_PATH, 'utf8');

function scaleDeclaredInCn(name: string): readonly string[] {
  const match = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(CN_SOURCE);
  const body = match?.[1];
  if (body === undefined) {
    throw new Error(`tokens.test: could not find "const ${name} = [...]" in lib/cn.ts`);
  }
  return body
    .split(',')
    .map((entry) => entry.trim().replace(/^'|'$/g, ''))
    .filter((entry) => entry.length > 0);
}

/** camelCase → the kebab form used for CSS variables and Tailwind utilities. */
function kebab(token: string): string {
  return token.replace(/([A-Z]|\d+)/g, '-$1').toLowerCase();
}

function isStrictlyIncreasing(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || value > (values[index - 1] ?? Number.NaN));
}

describe('colour', () => {
  it('declares exactly the fifteen tokens the system is built from', () => {
    expect(Object.keys(lightColors)).toEqual(EXPECTED_COLOR_TOKENS);
    expect(colorTokens).toEqual(EXPECTED_COLOR_TOKENS);
  });

  it('declares identical key sets in both themes', () => {
    // A token present in one theme and missing from the other is an element
    // that disappears — for half the users, on a screen nobody screenshots.
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());
  });

  it.each(['light', 'dark'] as const)('%s is a complete, valid, canonical palette', (theme) => {
    const scale = colorThemes[theme];
    for (const token of EXPECTED_COLOR_TOKENS) {
      const value = scale[token];
      expect(value, token).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it.each(['light', 'dark'] as const)('%s gives every token a distinct value', (theme) => {
    const values = EXPECTED_COLOR_TOKENS.map((token) => colorThemes[theme][token]);
    expect(new Set(values).size).toBe(values.length);
  });

  it('names every token in kebab form for CSS, uniquely', () => {
    for (const token of EXPECTED_COLOR_TOKENS) {
      expect(colorCssNames[token], token).toBe(kebab(token));
    }
    const names = EXPECTED_COLOR_TOKENS.map((token) => colorCssNames[token]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps the amber split — the text tone and the fill tone are never the same value', () => {
    expect(lightColors.hivis).not.toBe(lightColors.hivisFill);
    expect(darkColors.hivis).not.toBe(darkColors.hivisFill);
  });
});

describe('type', () => {
  it('names the five steps exactly as lib/cn.ts declares them to tailwind-merge', () => {
    expect([...fontSizeSteps]).toEqual([...scaleDeclaredInCn('FONT_SIZE_STEPS')]);
    expect(Object.keys(fontSizeRem)).toEqual([...fontSizeSteps]);
    expect(Object.keys(fontSizes)).toEqual([...fontSizeSteps]);
  });

  it('keeps the ramp strictly increasing', () => {
    expect(isStrictlyIncreasing(fontSizeSteps.map((step) => fontSizeRem[step]))).toBe(true);
    expect(isStrictlyIncreasing(fontSizeSteps.map((step) => fontSizePx[step]))).toBe(true);
  });

  it('keeps the rem strings, the rem numbers and the px numbers in agreement', () => {
    for (const step of fontSizeSteps) {
      expect(fontSizes[step]).toBe(`${fontSizeRem[step]}rem`);
      expect(fontSizePx[step]).toBeCloseTo(fontSizeRem[step] * ROOT_FONT_SIZE_PX, 6);
    }
  });

  it('loosens leading as the ramp climbs, because Hebrew has no ascender rhythm', () => {
    const leadings = fontSizeSteps.map((step) => lineHeights[step]);
    expect(isStrictlyIncreasing([...leadings].reverse())).toBe(true);
    expect(lineHeights['step-0']).toBeGreaterThanOrEqual(1.5);
  });

  it('keeps the weight scale ordered and inside the variable axis', () => {
    const weights = Object.values(fontWeights);
    expect(isStrictlyIncreasing(weights)).toBe(true);
    for (const weight of weights) {
      expect(weight).toBeGreaterThanOrEqual(100);
      expect(weight).toBeLessThanOrEqual(900);
      expect(weight % 100).toBe(0);
    }
  });

  it('ends every stack in a generic family and gives the text faces a Hebrew fallback', () => {
    expect(fontFamilies.display.endsWith('sans-serif')).toBe(true);
    expect(fontFamilies.body.endsWith('sans-serif')).toBe(true);
    expect(fontFamilies.mono.endsWith('monospace')).toBe(true);
    for (const family of ['display', 'body'] as const) {
      expect(fontFamilies[family], family).toContain('Hebrew');
    }
  });

  it('derives the money face from what the fonts measurably contain', () => {
    // Not a style choice: money is set in the only shipped face whose digits
    // already share one advance width AND which owns ₪. Everything else needs a
    // feature that React Native, canvas and PDF generators drop silently.
    const families = Object.keys(typefaceFacts) as FontFamilyToken[];
    const capable = families.filter(
      (family) => typefaceFacts[family].digitsAlreadyTabular && typefaceFacts[family].hasShekelSign,
    );
    expect(capable).toEqual([moneyFontFamily]);
  });

  it('keeps the body face away from prices, because its alignment is feature-dependent', () => {
    expect(typefaceFacts.body.digitsAlreadyTabular).toBe(false);
    expect(typefaceFacts.body.hasTnumFeature).toBe(true);
    expect(moneyFontFamily).not.toBe('body');
  });

  it('keeps mono away from money, because it has no ₪ glyph at all', () => {
    expect(typefaceFacts.mono.hasShekelSign).toBe(false);
    expect(moneyFontFamily).not.toBe('mono');
    expect(SHEKEL_SIGN).toBe('₪');
  });

  it('still declares tabular figures, as insurance on the fallback stack', () => {
    expect(tabularNumerals).toBe('tabular-nums');
  });

  it('converts px to rem against the root size', () => {
    expect(remFromPx(0)).toBe('0');
    expect(remFromPx(ROOT_FONT_SIZE_PX)).toBe('1rem');
    expect(remFromPx(4)).toBe('0.25rem');
  });
});

describe('space', () => {
  it('lists every token, in ascending order, from zero', () => {
    expect([...spaceTokens]).toEqual(Object.keys(space));
    expect(spacePx[spaceTokens[0] as SpaceToken]).toBe(0);
    expect(isStrictlyIncreasing(spaceTokens.map((token) => spacePx[token]))).toBe(true);
  });

  it('stays on the 4px grid', () => {
    for (const token of spaceTokens) {
      expect(spacePx[token] % 4, token).toBe(0);
    }
  });

  it('keeps the rem strings and the px numbers in agreement', () => {
    for (const token of spaceTokens) {
      expect(space[token], token).toBe(remFromPx(spacePx[token]));
    }
  });
});

describe('radius', () => {
  it('lists every token in ascending order', () => {
    expect([...radiusTokens]).toEqual(Object.keys(radius));
    expect(isStrictlyIncreasing(radiusTokens.map((token) => radiusPx[token]))).toBe(true);
  });

  it('keeps the rem values and the px numbers in agreement, except the pill', () => {
    for (const token of radiusTokens) {
      if (token === 'pill') continue;
      expect(radius[token], token).toBe(remFromPx(radiusPx[token]));
    }
    // A pill is a shape, not a measurement — it must survive any height without
    // being recomputed, so it is deliberately absolute.
    expect(radius.pill.endsWith('px')).toBe(true);
  });
});

describe('motion', () => {
  it('names the four durations exactly as lib/cn.ts declares them to tailwind-merge', () => {
    expect([...durationTokens]).toEqual([...scaleDeclaredInCn('MOTION_DURATIONS')]);
    expect(Object.keys(durations)).toEqual([...durationTokens]);
    expect(Object.keys(durationMs)).toEqual([...durationTokens]);
  });

  it.each(['quick', 'base', 'settle', 'sheet'] as const)(
    'declares %s in both units, in agreement',
    (token) => {
      expect(durations[token]).toBe(`${durationMs[token]}ms`);
    },
  );

  it('lands base and settle inside the 200–280ms band the plan specifies', () => {
    for (const token of ['base', 'settle'] as const) {
      expect(durationMs[token], token).toBeGreaterThanOrEqual(MOTION_BAND_MS.min);
      expect(durationMs[token], token).toBeLessThanOrEqual(MOTION_BAND_MS.max);
    }
  });

  it('keeps quick below the band, because feedback is not movement', () => {
    expect(durationMs.quick).toBeLessThan(MOTION_BAND_MS.min);
    // But not so fast that the interface stops having any weight at all.
    expect(durationMs.quick).toBeGreaterThanOrEqual(100);
  });

  it('orders the ladder', () => {
    expect(
      isStrictlyIncreasing(durationTokens.map((token: MotionDurationToken) => durationMs[token])),
    ).toBe(true);
  });

  it('keeps the bezier strings and their control points in agreement, inside the legal range', () => {
    for (const [token, curve] of Object.entries(easingCurves)) {
      expect(easings[token as keyof typeof easingCurves]).toBe(`cubic-bezier(${curve.join(', ')})`);
      const [x1, , x2] = curve;
      expect(x1, token).toBeGreaterThanOrEqual(0);
      expect(x1, token).toBeLessThanOrEqual(1);
      expect(x2, token).toBeGreaterThanOrEqual(0);
      expect(x2, token).toBeLessThanOrEqual(1);
    }
  });

  it('gives the default curve mass — not linear, not the browser default', () => {
    expect(easings.weighted).not.toBe('linear');
    expect(easings.weighted).not.toBe('cubic-bezier(0.42, 0, 0.58, 1)');

    const at = (x: number): number => bezierY(easingCurves.weighted, x);
    // Resists starting: the first tenth of the time covers less than a tenth of
    // the distance.
    expect(at(0.1)).toBeLessThan(0.1);
    // Commits through the middle.
    expect(at(0.5)).toBeGreaterThan(0.65);
    // And then spends the last quarter of the duration settling the last few
    // percent, which is what an object with momentum does.
    expect(1 - at(0.75)).toBeLessThan(0.1);
  });

  it('gives sheets a real spring: starts at rest, overshoots once, ends settled', () => {
    const stops = easings.sheet
      .slice('linear('.length, -1)
      .split(',')
      .map((stop) => Number(stop.trim()));

    expect(stops.length).toBeGreaterThan(8);
    expect(stops.every((stop) => Number.isFinite(stop))).toBe(true);
    expect(stops[0]).toBe(0);
    expect(stops.at(-1)).toBe(1);
    expect(Math.max(...stops)).toBeCloseTo(sheetSpring.overshoot, 4);
  });

  it('publishes the physics the sheet curve was sampled from', () => {
    const zeta = sheetSpring.damping / (2 * Math.sqrt(sheetSpring.stiffness * sheetSpring.mass));
    // Underdamped, so it arrives like an object rather than a drawn panel...
    expect(zeta).toBeLessThan(1);
    // ...but nowhere near bouncy, because the things in this app are heavy.
    expect(zeta).toBeGreaterThan(0.6);

    const theoretical = 1 + Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));
    expect(sheetSpring.overshoot).toBeCloseTo(theoretical, 3);
    expect(sheetSpring.overshoot - 1).toBeLessThan(0.05);
  });
});

describe('size', () => {
  it('sets the tap-target floor at 44px, in both units', () => {
    expect(MIN_TAP_TARGET_PX).toBe(44);
    expect(MIN_TAP_TARGET).toBe('44px');
  });

  it('makes the floor a clamp rather than a convention', () => {
    // The failure mode this defends against is a `size="xs"` added months from
    // now for one dense table row. It becomes 44 instead of shipping at 32.
    expect(atLeastTapTarget(20)).toBe(MIN_TAP_TARGET_PX);
    expect(atLeastTapTarget(MIN_TAP_TARGET_PX)).toBe(MIN_TAP_TARGET_PX);
    expect(atLeastTapTarget(64)).toBe(64);
  });

  it.each(['sm', 'md', 'lg', 'xl'] as const)('holds the floor for the %s control', (size) => {
    expect(controlHeightsPx[size]).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
    expect(controlHeights[size]).toBe(`${controlHeightsPx[size]}px`);
  });

  it('shows the clamp actually biting on the smallest control', () => {
    expect(controlHeightsPx.sm).toBe(MIN_TAP_TARGET_PX);
  });

  it('orders the control ladder', () => {
    expect(isStrictlyIncreasing(controlSizes.map((size) => controlHeightsPx[size]))).toBe(true);
  });

  it('keeps icons smaller than a target, because a glyph is not a hit area', () => {
    for (const size of Object.keys(iconSizesPx) as Array<keyof typeof iconSizesPx>) {
      expect(iconSizesPx[size], size).toBeLessThan(MIN_TAP_TARGET_PX);
      expect(iconSizes[size], size).toBe(`${iconSizesPx[size]}px`);
    }
  });
});

describe('the grouped tokens object', () => {
  it('exposes the same objects the flat exports do, so there is nothing to keep in step', () => {
    expect(tokens.color.light).toBe(lightColors);
    expect(tokens.color.dark).toBe(darkColors);
    expect(tokens.font.families).toBe(fontFamilies);
    expect(tokens.font.sizes).toBe(fontSizes);
    expect(tokens.font.weights).toBe(fontWeights);
    expect(tokens.font.money).toBe(moneyFontFamily);
    expect(tokens.space).toBe(space);
    expect(tokens.radius).toBe(radius);
    expect(tokens.motion.durations).toBe(durations);
    expect(tokens.motion.easings).toBe(easings);
    expect(tokens.size.control).toBe(controlHeights);
    expect(tokens.size.minTapTargetPx).toBe(MIN_TAP_TARGET_PX);
  });
});

/** Solve a CSS cubic-bezier for y at a given x. Test-local; components use CSS. */
function bezierY(curve: readonly [number, number, number, number], x: number): number {
  const [x1, y1, x2, y2] = curve;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  let t = x;
  for (let i = 0; i < 32; i += 1) {
    const error = ((ax * t + bx) * t + cx) * t - x;
    if (Math.abs(error) < 1e-9) break;
    const slope = (3 * ax * t + 2 * bx) * t + cx;
    if (slope === 0) break;
    t -= error / slope;
  }
  return ((ay * t + by) * t + cy) * t;
}
