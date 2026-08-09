import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  colorCssNames,
  colorThemes,
  colorTokens,
  lightColors,
  type ColorToken,
} from '../tokens/color.js';
import { durationMs, durationTokens, easingCurves, sheetSpring } from '../tokens/motion.js';
import {
  createNativeTheme,
  nativeFontFamily,
  pxFromLength,
  type ColorUtilityName,
  type NativeTheme,
} from '../tokens/native-theme.js';
import { radius, radiusPx, radiusTokens } from '../tokens/radius.js';
import {
  MIN_TAP_TARGET_PX,
  controlHeightsPx,
  controlSizes,
  iconSizes,
  iconSizesPx,
} from '../tokens/size.js';
import { space, spacePx, spaceTokens } from '../tokens/space.js';
import {
  ROOT_FONT_SIZE_PX,
  fontFamilies,
  fontSizePx,
  fontSizeRem,
  fontSizeSteps,
  fontSizes,
  fontWeights,
  lineHeights,
  moneyFontFamily,
  tabularNumerals,
  type FontFamilyToken,
} from '../tokens/type.js';

/**
 * The native theme is the one file in this package whose mistakes are invisible
 * on the machine that writes them. Everything here runs on the web, in jsdom,
 * where a colour dropped in translation still renders and a rem left unconverted
 * still lays out. On a phone the first costs you a control the exact shade of its
 * own ground, and the second costs you a layout at the wrong scale. Neither one
 * announces itself, so both are computed here instead.
 */

const THEMES = ['light', 'dark'] as const;

const SOURCE_PATH = resolve(process.cwd(), 'src/tokens/native-theme.ts');
if (!existsSync(SOURCE_PATH)) {
  throw new Error(
    `native-theme.test: expected the module at ${SOURCE_PATH}. If it moved, this test must follow it.`,
  );
}
const SOURCE = readFileSync(SOURCE_PATH, 'utf8');

const light: NativeTheme = createNativeTheme('light');

function themeOf(name: (typeof THEMES)[number]): NativeTheme {
  return name === 'light' ? light : createNativeTheme('dark');
}

describe('colour survives the crossing', () => {
  it('keys the StyleSheet palette by exactly the token names, in the token order', () => {
    for (const name of THEMES) {
      expect(Object.keys(themeOf(name).style.color), name).toEqual(Object.keys(lightColors));
      expect(Object.keys(themeOf(name).style.color), name).toEqual([...colorTokens]);
    }
  });

  it('keys the Tailwind palette by exactly the utility names the web already uses', () => {
    // Not cosmetic: `bg-hivis-fill` has to be the same string in both apps, or
    // the shared className vocabulary that justifies one token file is gone.
    const expected: ColorUtilityName[] = colorTokens.map((token) => colorCssNames[token]);
    for (const name of THEMES) {
      expect(Object.keys(themeOf(name).tailwind.colors), name).toEqual(expected);
    }
  });

  it('drops nothing in either direction — the mapping is one to one, both ways', () => {
    for (const name of THEMES) {
      const theme = themeOf(name);
      const utilities = Object.keys(theme.tailwind.colors);
      expect(utilities.length, name).toBe(colorTokens.length);
      expect(new Set(utilities).size, name).toBe(colorTokens.length);
      for (const token of colorTokens) {
        expect(theme.style.color[token], `${name}.${token}`).toBeDefined();
        expect(
          theme.tailwind.colors[colorCssNames[token]],
          `${name}.${colorCssNames[token]}`,
        ).toBeDefined();
      }
    }
  });

  it('carries the palette through unaltered, value for value', () => {
    for (const name of THEMES) {
      const theme = themeOf(name);
      for (const token of colorTokens) {
        const source = colorThemes[name][token];
        expect(theme.style.color[token], `${name}.${token}`).toBe(source);
        expect(theme.tailwind.colors[colorCssNames[token]], `${name}.${token}`).toBe(source);
      }
    }
  });

  it('gives the two themes identical key sets, so nothing is theme-only on native', () => {
    expect(Object.keys(themeOf('dark').style.color)).toEqual(
      Object.keys(themeOf('light').style.color),
    );
    expect(Object.keys(themeOf('dark').tailwind.colors)).toEqual(
      Object.keys(themeOf('light').tailwind.colors),
    );
  });

  it('keeps every Tailwind colour key in kebab form, as a utility suffix must be', () => {
    for (const key of Object.keys(light.tailwind.colors)) {
      expect(key, key).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
});

describe('the module owns no values of its own', () => {
  it('contains no colour literal anywhere in its source', () => {
    // A hex here would be a second definition of a brand colour, and the copy
    // that drifts is always the one nobody is looking at.
    const literals = SOURCE.match(/#[0-9a-fA-F]{3,8}\b/g);
    expect(literals).toBeNull();
  });

  it('gets its colour by importing the palette, rather than by not having colour', () => {
    expect(SOURCE).toMatch(/import \{[^}]*colorThemes[^}]*\} from '\.\/color\.js';/s);
  });

  it('imports neither react-native nor nativewind, because the web build resolves this package', () => {
    expect(SOURCE).not.toMatch(/from\s+'(react-native|nativewind)/);
    expect(SOURCE).not.toMatch(/require\(\s*'(react-native|nativewind)/);
    for (const specifier of SOURCE.matchAll(/from\s+'([^']+)'/g)) {
      expect(specifier[1], 'native-theme may only import its sibling token modules').toMatch(
        /^\.\/[a-z-]+\.js$/,
      );
    }
  });
});

describe('rem becomes the number React Native takes, exactly', () => {
  it('converts every font step against the root size with nothing lost', () => {
    for (const step of fontSizeSteps) {
      expect(pxFromLength(fontSizes[step]), step).toBe(fontSizeRem[step] * ROOT_FONT_SIZE_PX);
      expect(pxFromLength(fontSizes[step]), step).toBe(fontSizePx[step]);
      expect(light.style.fontSize[step], step).toBe(fontSizePx[step]);
      expect(light.tailwind.fontSize[step][0], step).toBe(`${fontSizePx[step]}px`);
    }
  });

  it('converts every spacing step, staying on the 4px grid the tokens declare', () => {
    for (const token of spaceTokens) {
      expect(pxFromLength(space[token]), token).toBe(spacePx[token]);
      expect(light.style.space[token], token).toBe(spacePx[token]);
      expect(light.tailwind.spacing[token], token).toBe(`${spacePx[token]}px`);
    }
  });

  it('converts every radius, including the pill, which was absolute to begin with', () => {
    for (const token of radiusTokens) {
      expect(pxFromLength(radius[token]), token).toBe(radiusPx[token]);
      expect(light.style.radius[token], token).toBe(radiusPx[token]);
      expect(light.tailwind.borderRadius[token], token).toBe(`${radiusPx[token]}px`);
    }
  });

  it('carries the tap-target floor across as a number, still 44', () => {
    // 44 is a claim about a fingertip. It does not scale, and it does not survive
    // being expressed in rem — which is exactly why size.ts wrote it in px.
    expect(light.style.minTapTarget).toBe(MIN_TAP_TARGET_PX);
    for (const size of controlSizes) {
      expect(light.style.controlHeight[size], size).toBe(controlHeightsPx[size]);
      expect(light.style.controlHeight[size], size).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
    }
    for (const size of Object.keys(iconSizes) as Array<keyof typeof iconSizes>) {
      expect(light.style.iconSize[size], size).toBe(iconSizesPx[size]);
    }
  });

  it('resolves the unitless leading multiplier into points, which is what RN wants', () => {
    for (const step of fontSizeSteps) {
      const resolved = light.style.lineHeight[step];
      expect(resolved, step).toBeCloseTo(fontSizePx[step] * lineHeights[step], 10);
      expect(resolved, step).toBeGreaterThan(light.style.fontSize[step]);
      // And it arrives at a precision a screen can draw, not with sixteen digits
      // of binary residue trailing off the end of a decimal multiplication.
      expect(String(resolved), step).not.toMatch(/\.\d{4,}/);
      expect(light.tailwind.fontSize[step][1].lineHeight, step).toBe(`${resolved}px`);
    }
  });

  it('refuses a length it cannot convert rather than guessing a number that renders', () => {
    expect(pxFromLength('0')).toBe(0);
    expect(pxFromLength('1rem')).toBe(ROOT_FONT_SIZE_PX);
    expect(pxFromLength('44px')).toBe(44);
    expect(() => pxFromLength('12')).toThrow(/no unit/);
    expect(() => pxFromLength('50%')).toThrow(/React Native length/);
    expect(() => pxFromLength('2em')).toThrow(/React Native length/);
    expect(() => pxFromLength('calc(1rem + 2px)')).toThrow(/React Native length/);
  });
});

describe('the type ramp arrives whole', () => {
  it('declares every step and every family the tokens declare', () => {
    expect(Object.keys(light.tailwind.fontSize)).toEqual([...fontSizeSteps]);
    expect(Object.keys(light.style.fontSize)).toEqual([...fontSizeSteps]);
    expect(Object.keys(light.tailwind.fontFamily)).toEqual(Object.keys(fontFamilies));
    expect(Object.keys(light.style.fontWeight)).toEqual(Object.keys(fontWeights));
  });

  it('reduces each web stack to the one family name React Native will ask for', () => {
    for (const token of Object.keys(fontFamilies) as FontFamilyToken[]) {
      const family = light.style.fontFamily[token];
      expect(family, token).not.toContain(',');
      expect(family, token).not.toMatch(/["']/);
      expect(fontFamilies[token], token).toContain(family);
      // The first entry of the stack, not a generic keyword picked up further
      // down it — a generic names no file and can never be registered.
      expect(
        fontFamilies[token].startsWith(`'${family}'`) || fontFamilies[token].startsWith(family),
        token,
      ).toBe(true);
      expect(light.tailwind.fontFamily[token], token).toBe(family);
    }
  });

  it('throws on a stack with nothing registrable in it', () => {
    expect(() => nativeFontFamily('system-ui, sans-serif')).toThrow(/no concrete family/);
  });

  it('sends money to the display face, and asks for tabular figures on the fallback', () => {
    expect(light.style.money.fontFamily).toBe(light.style.fontFamily[moneyFontFamily]);
    expect(light.style.money.fontVariant).toEqual([tabularNumerals]);
  });

  it('keeps the weight ramp as strings, the form RN has always accepted', () => {
    for (const [token, weight] of Object.entries(fontWeights)) {
      expect(light.style.fontWeight[token as keyof typeof fontWeights], token).toBe(String(weight));
    }
  });
});

describe('motion crosses as physics, not as CSS', () => {
  it('hands over milliseconds, which is what an animation driver takes', () => {
    expect(Object.keys(light.style.motion.duration)).toEqual([...durationTokens]);
    for (const token of durationTokens) {
      expect(light.style.motion.duration[token], token).toBe(durationMs[token]);
    }
  });

  it('hands over bezier control points rather than a cubic-bezier string', () => {
    for (const token of Object.keys(easingCurves) as Array<keyof typeof easingCurves>) {
      expect(light.style.motion.easing[token], token).toEqual([...easingCurves[token]]);
      expect(light.style.motion.easing[token], token).toHaveLength(4);
    }
  });

  it('hands over the sheet spring as the oscillator it was sampled from', () => {
    expect(light.style.motion.spring).toEqual({
      stiffness: sheetSpring.stiffness,
      damping: sheetSpring.damping,
      mass: sheetSpring.mass,
    });
  });
});

describe('the transform is pure', () => {
  it('publishes exactly the five sections a Tailwind theme is assembled from', () => {
    expect(Object.keys(light.tailwind)).toEqual([
      'colors',
      'fontFamily',
      'fontSize',
      'spacing',
      'borderRadius',
    ]);
  });

  it('returns an equal but separate object every call, so one app cannot reach another', () => {
    const first = createNativeTheme('light');
    const second = createNativeTheme('light');
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.style.color).not.toBe(second.style.color);

    (first.style.color as Record<ColorToken, string>).route = 'mutated';
    expect(second.style.color.route).toBe(lightColors.route);
    expect(createNativeTheme('light').style.color.route).toBe(lightColors.route);
  });

  it('names the theme it was asked for', () => {
    for (const name of THEMES) {
      expect(createNativeTheme(name).name).toBe(name);
    }
  });
});
