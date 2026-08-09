import { colorCssNames, colorThemes, type ColorToken, type ThemeName } from './color.js';
import { durationMs, easingCurves, sheetSpring, type MotionDurationToken } from './motion.js';
import { radius, type RadiusToken } from './radius.js';
import {
  MIN_TAP_TARGET,
  controlHeights,
  iconSizes,
  type ControlSize,
  type IconSize,
} from './size.js';
import { space, type SpaceToken } from './space.js';
import {
  ROOT_FONT_SIZE_PX,
  fontFamilies,
  fontSizes,
  fontWeights,
  lineHeights,
  moneyFontFamily,
  tabularNumerals,
  type FontFamilyToken,
  type FontSizeStep,
  type FontWeightToken,
} from './type.js';

/**
 * ---------------------------------------------------------------------------
 * Native theme
 * ---------------------------------------------------------------------------
 * The customer app and the driver app are React Native, and the cheapest way for
 * a brand to come apart is for someone to open a native stylesheet and type the
 * green in by hand. It will be close. It will not be the same green, and the two
 * products drift another shade apart with every screen that gets built. So the
 * native side is given no occasion to type a value at all: this module is the
 * only door between the token modules and anything that runs on a phone, and
 * everything that passes through it was imported rather than written down. There
 * is not one colour literal in this file, and a test fails if one appears.
 *
 * ## Why this is data rather than a config
 *
 * NativeWind is mid-migration and its two halves want different Tailwinds.
 * Checked while writing this: `nativewind@latest` is 4.2.6, which reads a
 * Tailwind **v3** JavaScript config — `theme.extend.colors`, the whole
 * `tailwind.config.js` shape. The `preview` tag is 5.0.0-preview.4, and v5
 * follows Tailwind **v4**, which is CSS-first and takes its tokens from an
 * `@theme` block. This package's web build is already on Tailwind 4.3.3, so the
 * native apps are either a major version behind the web or on a preview release,
 * and which of those is true will change underneath us.
 *
 * That is a scheduling problem and this module declines to have an opinion about
 * it. It returns plain data. A v4 setup spreads `tailwind` into `theme.extend`;
 * a v5 setup emits the same object into an `@theme` block. Neither path asks
 * this file to change, and the brand stays defined once either way.
 *
 * ## Why it does not import react-native
 *
 * `@haul/ui` is consumed by the Next.js web build. A single import of
 * `react-native` or `nativewind` anywhere in this package's graph puts a native
 * module in front of the web bundler, and the failure arrives as an unresolved
 * import in an app that has nothing to do with phones. So this is a pure
 * transform over data: no `StyleSheet.create`, no `Easing.bezier`, no NativeWind.
 * The apps bring the plumbing; this brings the numbers.
 *
 * ## What genuinely differs between the platforms
 *
 * Colour does not — a hex triplet is a hex triplet. Three other things do.
 *
 * **rem does not exist on a phone.** The web scales in rem so a user who enlarges
 * their text gets a layout that grows with it. React Native has no root font size
 * to scale against, and NativeWind resolves `rem` against a constant of its own
 * choosing rather than against a document — so leaving rem in the native theme
 * means the same token is one size on the web and whatever that setting says on
 * native. Every length is therefore converted here, once, through
 * `pxFromLength`, and the conversion is exact at every step on every scale
 * because the ramps were built on a factor of sixteen in the first place. Native
 * type still responds to the OS text-size setting; that is a platform multiplier
 * applied on top, which is a different mechanism from the one rem provides.
 *
 * **Line height is a multiplier on the web and a measurement in React Native.**
 * A unitless 1.6 is ordinary CSS and meaningless to RN, which wants points. The
 * multiplier is resolved against its own step here, and that is also the only
 * arithmetic in this file needing a rounding pass: binary floating point turns
 * 20.8 by 1.45 into a number with sixteen digits, none of which after the third
 * describes anything a screen can draw.
 *
 * **A font stack is a web idea.** CSS walks a list until a family resolves; React
 * Native takes a single family name and, when it does not match a registered
 * font, quietly substitutes the platform's own. So the native theme carries the
 * first concrete family out of each stack, and that name is a contract: it is the
 * name the app must register the font file under. Registering the display face
 * under any other key is the bug where every heading in the product is silently
 * the system sans.
 *
 * ## Two shapes, and why there are two
 *
 * `tailwind` is keyed the way the *utilities* are keyed, so `bg-hivis-fill` and
 * `text-step-4` mean the same thing in both apps. That is the entire point of
 * sharing a token file; camelCase keys here would hand native a different class
 * name for the same colour and the shared vocabulary would be gone. `style` is
 * keyed the way the *tokens* are keyed, because it is read by hand-written
 * TypeScript rather than by a class parser, and it carries what NativeWind has no
 * utility for: spring physics, bezier control points, the tap-target floor.
 * Anything reaching for Reanimated or a raw `StyleSheet` reads from there instead
 * of inventing a number.
 * ---------------------------------------------------------------------------
 */

/** One scale's worth of values, in whichever unit the consuming platform takes. */
export type NativeScale<K extends string, V> = Readonly<Record<K, V>>;

/** `Easing.bezier(x1, y1, x2, y2)` — the four control points, in that order. */
export type BezierPoints = readonly [number, number, number, number];

/** The bezier-backed easings. `sheet` is a spring and is published as physics. */
export type NativeEasingToken = keyof typeof easingCurves;

/**
 * The Tailwind utility suffix for each colour, as a type. `bg-hivis-fill` on
 * native has to be the same string it is on the web or the two platforms stop
 * sharing a vocabulary.
 */
export type ColorUtilityName = (typeof colorCssNames)[ColorToken];

/** Tailwind's JS config pairs a size with its leading. v4 reads both halves out. */
export type FontSizeEntry = readonly [string, { readonly lineHeight: string }];

export interface NativeTailwindTheme {
  readonly colors: NativeScale<ColorUtilityName, string>;
  readonly fontFamily: NativeScale<FontFamilyToken, string>;
  readonly fontSize: NativeScale<FontSizeStep, FontSizeEntry>;
  readonly spacing: NativeScale<SpaceToken, string>;
  readonly borderRadius: NativeScale<RadiusToken, string>;
}

export interface NativeStyleTokens {
  readonly color: NativeScale<ColorToken, string>;
  readonly fontFamily: NativeScale<FontFamilyToken, string>;
  readonly fontSize: NativeScale<FontSizeStep, number>;
  readonly lineHeight: NativeScale<FontSizeStep, number>;
  /** RN's `fontWeight` has always taken the string form; numbers are newer. */
  readonly fontWeight: NativeScale<FontWeightToken, string>;
  readonly space: NativeScale<SpaceToken, number>;
  readonly radius: NativeScale<RadiusToken, number>;
  readonly controlHeight: NativeScale<ControlSize, number>;
  readonly iconSize: NativeScale<IconSize, number>;
  readonly minTapTarget: number;
  /** Carried across so a native Price Card cannot set a figure in the body face. */
  readonly money: {
    readonly fontFamily: string;
    readonly fontVariant: readonly string[];
  };
  readonly motion: {
    readonly duration: NativeScale<MotionDurationToken, number>;
    readonly easing: NativeScale<NativeEasingToken, BezierPoints>;
    readonly spring: {
      readonly stiffness: number;
      readonly damping: number;
      readonly mass: number;
    };
  };
}

export interface NativeTheme {
  readonly name: ThemeName;
  readonly tailwind: NativeTailwindTheme;
  readonly style: NativeStyleTokens;
}

/** Generic family keywords, which name no file and cannot be registered. */
const GENERIC_FAMILIES: ReadonlySet<string> = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
]);

const LENGTH = /^(-?(?:\d+\.?\d*|\.\d+))(rem|px)?$/;

/**
 * Three decimals is finer than any device pixel at any pixel ratio we will meet
 * and coarse enough to drop the binary dust that a decimal multiplier leaves
 * behind. It is a display precision, not a rounding of the design.
 */
function toDrawablePrecision(px: number): number {
  return Math.round(px * 1000) / 1000;
}

/**
 * The single door every length in this file passes through. A unit it does not
 * recognise throws rather than being guessed at, because the guess would be a
 * number that renders — just not the one the token meant.
 */
export function pxFromLength(value: string): number {
  const match = LENGTH.exec(value.trim());
  const amount = match?.[1];
  const unit = match?.[2];
  if (amount === undefined) {
    throw new TypeError(`native-theme: cannot express "${value}" as a React Native length`);
  }
  const magnitude = Number(amount);
  if (unit === undefined && magnitude !== 0) {
    throw new TypeError(
      `native-theme: "${value}" carries no unit, and only zero may go without one`,
    );
  }
  return toDrawablePrecision(unit === 'rem' ? magnitude * ROOT_FONT_SIZE_PX : magnitude);
}

/**
 * The first family in a CSS stack that names an actual file. React Native has no
 * fallback mechanism, so this is not a preference — it is the only name that will
 * ever be asked for, and the name the app has to register.
 */
export function nativeFontFamily(stack: string): string {
  for (const entry of stack.split(',')) {
    const name = entry.trim().replace(/^["']|["']$/g, '');
    if (name.length > 0 && !GENERIC_FAMILIES.has(name)) {
      return name;
    }
  }
  throw new TypeError(
    `native-theme: font stack "${stack}" names no concrete family for React Native`,
  );
}

function cssPx(px: number): string {
  return `${px}px`;
}

function mapScale<K extends string, In, Out>(
  scale: NativeScale<K, In>,
  convert: (value: In, key: K) => Out,
): NativeScale<K, Out> {
  const mapped = {} as Record<K, Out>;
  for (const [key, value] of Object.entries(scale) as Array<[K, In]>) {
    mapped[key] = convert(value, key);
  }
  return mapped;
}

function colorsByToken(theme: ThemeName): NativeScale<ColorToken, string> {
  return mapScale(colorThemes[theme], (value: string) => value);
}

/**
 * The same palette re-keyed to the utility names the web already uses. Dropping a
 * token in this step would not raise anything — it would render a control the
 * exact colour of the ground it sits on, on one platform only, which is why the
 * correspondence is asserted rather than reviewed.
 */
function colorsByUtility(
  byToken: NativeScale<ColorToken, string>,
): NativeScale<ColorUtilityName, string> {
  const utilities = {} as Record<ColorUtilityName, string>;
  for (const [token, value] of Object.entries(byToken) as Array<[ColorToken, string]>) {
    utilities[colorCssNames[token]] = value;
  }
  return utilities;
}

function nativeFontSizes(): NativeScale<FontSizeStep, number> {
  return mapScale(fontSizes, (value: string) => pxFromLength(value));
}

function nativeLineHeights(
  sizes: NativeScale<FontSizeStep, number>,
): NativeScale<FontSizeStep, number> {
  return mapScale(sizes, (size, step) => toDrawablePrecision(size * lineHeights[step]));
}

/**
 * Builds both representations of one theme from the tokens, and nothing else.
 * Pure: same name in, structurally identical value out, on a fresh object each
 * call so a native app that mutates its own copy cannot reach the next caller's.
 */
export function createNativeTheme(name: ThemeName): NativeTheme {
  const color = colorsByToken(name);
  const fontFamily = mapScale(fontFamilies, (stack: string) => nativeFontFamily(stack));
  const fontSize = nativeFontSizes();
  const lineHeight = nativeLineHeights(fontSize);
  const nativeSpace = mapScale(space, (value: string) => pxFromLength(value));
  const nativeRadius = mapScale(radius, (value: string) => pxFromLength(value));

  return {
    name,
    tailwind: {
      colors: colorsByUtility(color),
      fontFamily: { ...fontFamily },
      fontSize: mapScale(
        fontSize,
        (size, step) => [cssPx(size), { lineHeight: cssPx(lineHeight[step]) }] as const,
      ),
      spacing: mapScale(nativeSpace, cssPx),
      borderRadius: mapScale(nativeRadius, cssPx),
    },
    style: {
      color,
      fontFamily,
      fontSize,
      lineHeight,
      fontWeight: mapScale(fontWeights, (weight: number) => String(weight)),
      space: nativeSpace,
      radius: nativeRadius,
      controlHeight: mapScale(controlHeights, (value: string) => pxFromLength(value)),
      iconSize: mapScale(iconSizes, (value: string) => pxFromLength(value)),
      minTapTarget: pxFromLength(MIN_TAP_TARGET),
      money: {
        fontFamily: nativeFontFamily(fontFamilies[moneyFontFamily]),
        fontVariant: [tabularNumerals],
      },
      motion: {
        duration: mapScale(durationMs, (ms: number) => ms),
        easing: mapScale(easingCurves, (curve): BezierPoints => [
          curve[0],
          curve[1],
          curve[2],
          curve[3],
        ]),
        spring: {
          stiffness: sheetSpring.stiffness,
          damping: sheetSpring.damping,
          mass: sheetSpring.mass,
        },
      },
    },
  };
}
