/**
 * ---------------------------------------------------------------------------
 * Tokens
 * ---------------------------------------------------------------------------
 * The single source. Tailwind v4 is CSS-first, so its `@theme` block *looks*
 * like the place tokens live — and if it were, the native app would need a
 * second copy and the two would diverge within a release. Instead this module is
 * authoritative and every other representation is generated from it: the
 * stylesheet, the NativeWind config, and any documentation that quotes a value.
 *
 * `tokens` is the grouped view for code that walks the system — a theme
 * generator, a token table in Storybook — while the flat named exports are what
 * components import. Both are the same objects, so there is nothing to keep in
 * step.
 * ---------------------------------------------------------------------------
 */

export * from './color.js';
export * from './contrast.js';
export * from './motion.js';
export * from './radius.js';
export * from './size.js';
export * from './space.js';
export * from './type.js';

import { darkColors, lightColors } from './color.js';
import {
  durationMs,
  durations,
  easingCurves,
  easings,
  indeterminateSweep,
  sheetSpring,
} from './motion.js';
import { radius, radiusPx } from './radius.js';
import {
  MIN_TAP_TARGET_PX,
  controlHeights,
  controlHeightsPx,
  iconSizes,
  iconSizesPx,
  tileSizes,
  tileSizesPx,
} from './size.js';
import { space, spacePx } from './space.js';
import {
  fontFamilies,
  fontSizePx,
  fontSizes,
  fontWeights,
  lineHeights,
  moneyFontFamily,
  tabularNumerals,
} from './type.js';

export const tokens = {
  color: {
    light: lightColors,
    dark: darkColors,
  },
  font: {
    families: fontFamilies,
    sizes: fontSizes,
    sizesPx: fontSizePx,
    lineHeights,
    weights: fontWeights,
    money: moneyFontFamily,
    tabularNumerals,
  },
  space,
  spacePx,
  radius,
  radiusPx,
  motion: {
    durations,
    durationMs,
    easings,
    easingCurves,
    sheetSpring,
    indeterminateSweep,
  },
  size: {
    minTapTargetPx: MIN_TAP_TARGET_PX,
    control: controlHeights,
    controlPx: controlHeightsPx,
    icon: iconSizes,
    iconPx: iconSizesPx,
    tile: tileSizes,
    tilePx: tileSizesPx,
  },
} as const;
