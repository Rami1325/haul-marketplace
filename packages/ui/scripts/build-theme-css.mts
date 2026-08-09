import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { colorCssNames, colorThemes, colorTokens, type ThemeName } from '../src/tokens/color.js';
import { durationTokens, durations, easings } from '../src/tokens/motion.js';
import { radius, radiusTokens } from '../src/tokens/radius.js';
import { MIN_TAP_TARGET, controlHeights, controlSizes, iconSizes } from '../src/tokens/size.js';
import { space, spaceTokens } from '../src/tokens/space.js';
import {
  fontFamilies,
  fontSizeSteps,
  fontSizes,
  fontWeights,
  lineHeights,
  moneyFontFamily,
  tabularNumerals,
} from '../src/tokens/type.js';

/**
 * ---------------------------------------------------------------------------
 * build-theme-css
 * ---------------------------------------------------------------------------
 * Tailwind v4 is CSS-first: tokens live in an `@theme` block and the utilities
 * are derived from the custom-property names inside it. Taken at face value that
 * makes the stylesheet the source of truth — and this product also ships a React
 * Native app, which cannot read a stylesheet at all. Two sources would mean a
 * primary green that differs between web and native by a few percent, found by a
 * customer comparing the receipt on their phone against the one in their browser.
 *
 * So `src/tokens/*.ts` stays authoritative and `src/styles/theme.css` is an
 * artefact. This script is the whole of that translation: deterministic, the only
 * thing permitted to write that file, and guarded by a test that regenerates it
 * in memory and fails on a single differing byte. A generated file allowed to
 * drift from its source is worse than no generator at all, because it goes on
 * looking authoritative long after it has stopped being true.
 *
 * Two Tailwind facts are encoded here rather than discovered later at a
 * component author's expense. Durations live under `--transition-duration-*`,
 * not the `--duration-*` name the utility suggests; declaring the obvious one
 * produces no error and no utility, which is the worst possible failure mode.
 * And a control height has no theme namespace at all, so those are emitted as
 * plain variables and read as `h-(--control-lg)`.
 * ---------------------------------------------------------------------------
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** The one file this script owns. Exported so the test cannot guess it wrong. */
export const THEME_CSS_PATH = resolve(HERE, '../src/styles/theme.css');

/** Every generated line is joined with this, and the file ends with one. */
const NL = '\n';

function decl(name: string, value: string): string {
  return `  --${name}: ${value};`;
}

/** One theme's fifteen colour tokens, indented for whichever block holds them. */
function colorDeclarations(theme: ThemeName, indent: string): string[] {
  const scale = colorThemes[theme];
  return colorTokens.map((token) => `${indent}--color-${colorCssNames[token]}: ${scale[token]};`);
}

const BANNER = `/* ---------------------------------------------------------------------------
 * theme.css
 * ---------------------------------------------------------------------------
 * GENERATED FILE — DO NOT EDIT.
 *
 * Written by \`scripts/build-theme-css.mts\` from \`src/tokens/*.ts\`, which are the
 * single source of truth for this design system. Regenerate with:
 *
 *     pnpm --filter @haul/ui build:theme
 *
 * An edit made here survives exactly until the next build. It does not even
 * survive CI: \`src/__tests__/theme-css.test.ts\` regenerates this file in memory
 * and fails on one differing byte, so a hand edit — and, more usefully, a token
 * change committed without a rebuild — stops the pipeline instead of shipping a
 * stylesheet that disagrees with the tokens it claims to come from.
 * --------------------------------------------------------------------------- */`;

const THEME_INTRO = `/* ---------------------------------------------------------------------------
 * The light palette is the default theme rather than a \`light:\` variant, because
 * a moving company's daytime screen is the ordinary case and the dark one is the
 * exception. Tailwind derives its utilities from these names — \`--color-route\`
 * is what makes \`bg-route\`, \`text-route\` and \`border-route\` exist at all — so
 * this block is the variable table and the utility surface at once.
 *
 * \`static\` rather than a bare \`@theme\`: Tailwind otherwise emits only the
 * variables it saw used, and much of this system is read through \`var()\` from
 * places its scanner never looks. The dark block below redeclares \`--color-*\` by
 * name; control heights are consumed as \`h-(--control-lg)\`; the money utility
 * reaches for the display family directly. A variable dropped for looking unused
 * takes a working rule down with it, silently, in one theme only.
 * --------------------------------------------------------------------------- */`;

const DARK_INTRO = `/* ---------------------------------------------------------------------------
 * Dark mode — selectable, not merely detected
 * ---------------------------------------------------------------------------
 * A media query on its own cannot ship here. The driver app is read in a truck
 * cab at night by someone whose phone is still on whatever the platform
 * defaulted to, and the setting they actually need — *make this dark, now* — is
 * one the operating system was never asked about. So the theme is a choice:
 * \`data-theme="dark"\` forces dark, \`data-theme="light"\` forces light, and an
 * absent attribute follows the system.
 *
 * That is three states and it takes two blocks to say. The media block excludes
 * an explicit light choice, so a user who asked for light on a dark phone gets
 * light; the attribute block comes after it, so a user who asked for dark on a
 * light phone gets dark. Both are deliberately unlayered, which puts them above
 * \`@layer theme\` no matter how the specificity works out.
 *
 * Only the fifteen colour tokens are redeclared. Spacing, type, radii and motion
 * have no dark counterpart, and repeating them here would create a second place
 * to change them — the precise failure this generated file exists to prevent.
 *
 * \`color-scheme\` rides along because it is not decoration: without it the
 * scrollbars, the form controls and the flash before first paint all stay light,
 * which is a white rectangle in a dark cab.
 * --------------------------------------------------------------------------- */`;

const DARK_VARIANT_INTRO = `/* Tailwind's built-in \`dark:\` variant is the media query alone. Left as it is,
 * a hand-written \`dark:\` exception would ignore the manual override: the tokens
 * would flip and that one rule would not. Redefining the variant keeps the two
 * mechanisms describing the same three states. */`;

const BASE_INTRO = `/* ---------------------------------------------------------------------------
 * Base
 * ---------------------------------------------------------------------------
 * Hebrew is the reference implementation, so RTL is what you get when nobody
 * says otherwise. The \`:not([dir])\` guard is load-bearing rather than tidy: the
 * HTML specification puts \`[dir="ltr"] { direction: ltr }\` in the *user-agent*
 * stylesheet, and any author rule outranks a user-agent one — so a bare
 * \`html { direction: rtl }\` here would quietly reverse the English build no
 * matter what \`<html dir="ltr">\` said.
 * --------------------------------------------------------------------------- */`;

const TABULAR_INTRO = `/* ---------------------------------------------------------------------------
 * The money utility
 * ---------------------------------------------------------------------------
 * \`Money\` is the only component that turns agorot into characters, and this is
 * the class it wears, so every price, payout and receipt line in HAUL carries
 * it. That is what the utility is for: the family, the figures and the feature
 * reset are one decision, and three declarations written out at a call site are
 * three places that have to be kept in step with \`moneyFontFamily\` — where two
 * of them will not be. Anything else that sets a figure the eye has to read down
 * a column should reach for \`tabular\` rather than respell it.
 *
 * It sets the family as well as the figures on purpose. The alignment guarantee
 * is a property of the *face*, not of the declaration: the display face was
 * chosen because all ten digits already share one advance width at every weight
 * on its axis, with no OpenType feature applied. React Native on Android, canvas
 * rendering and PDF receipt generators all drop features silently, so a rule
 * that only asked for a feature would come apart in exactly the three places a
 * receipt has to be trusted. Splitting the family off into a second class would
 * make it possible to write the figures rule alone and believe money was safe.
 *
 * \`font-variant-numeric\` is still declared, and it is a no-op on the face we
 * ship. It earns its line on the day the webfont fails to load, by promoting the
 * fallback stack — whose digits are proportional — to tabular.
 *
 * \`font-feature-settings: normal\` blocks inheritance. The low-level property
 * beats \`font-variant-numeric\` for the same feature, so an ancestor that set
 * \`'pnum'\` for its own reasons would otherwise un-align a price several levels
 * below it, and nothing in the price's own class list would explain why.
 * --------------------------------------------------------------------------- */`;

/**
 * The whole stylesheet, as a string. Pure: same tokens in, same bytes out, which
 * is what lets the test assert the committed file rather than describe it.
 */
export function buildThemeCss(): string {
  const lines: string[] = [];

  lines.push(BANNER, '');
  lines.push('@import "tailwindcss";', '');

  lines.push(THEME_INTRO);
  lines.push('@theme static {');

  lines.push('  /* Colour. Light is the default; the dark override lives below this block. */');
  lines.push(...colorDeclarations('light', '  '));
  lines.push('');

  lines.push(
    '  /* Type. `--font-*` yields font-display/body/mono; `--text-*` yields the steps. */',
  );
  for (const [name, stack] of Object.entries(fontFamilies)) {
    lines.push(decl(`font-${name}`, stack));
  }
  lines.push('');
  for (const [name, weight] of Object.entries(fontWeights)) {
    lines.push(decl(`font-weight-${name}`, String(weight)));
  }
  lines.push('');
  for (const step of fontSizeSteps) {
    lines.push(decl(`text-${step}`, fontSizes[step]));
    lines.push(decl(`text-${step}--line-height`, String(lineHeights[step])));
  }
  lines.push('');

  lines.push('  /* Space. A 4px grid in rem, so gutters grow with the text they separate. */');
  for (const token of spaceTokens) {
    lines.push(decl(`spacing-${token}`, space[token]));
  }
  lines.push('');

  lines.push('  /* Radius. Short on purpose — calm sits between the toy and the console. */');
  for (const token of radiusTokens) {
    lines.push(decl(`radius-${token}`, radius[token]));
  }
  lines.push('');

  lines.push('  /* Motion. Tailwind reads durations from `--transition-duration-*`, not the');
  lines.push(
    '     `--duration-*` the utility name suggests; the utility is still `duration-settle`. */',
  );
  for (const token of durationTokens) {
    lines.push(decl(`transition-duration-${token}`, durations[token]));
  }
  lines.push('');
  for (const [name, curve] of Object.entries(easings)) {
    lines.push(decl(`ease-${name}`, curve));
  }
  lines.push('');

  lines.push('  /* Controls. No Tailwind namespace owns a control height or an icon box, so');
  lines.push('     these stay plain variables and are read as `h-(--control-lg)`. The 44px');
  lines.push('     floor is a clamp in `tokens/size.ts`, never a convention restated here. */');
  lines.push(decl('tap-target-min', MIN_TAP_TARGET));
  for (const size of controlSizes) {
    lines.push(decl(`control-${size}`, controlHeights[size]));
  }
  for (const [name, value] of Object.entries(iconSizes)) {
    lines.push(decl(`icon-${name}`, value));
  }

  lines.push('}', '');

  lines.push(DARK_INTRO, '');
  lines.push(DARK_VARIANT_INTRO);
  lines.push('@custom-variant dark {');
  lines.push('  @media (prefers-color-scheme: dark) {');
  lines.push('    &:where(:root:not([data-theme="light"]), :root:not([data-theme="light"]) *) {');
  lines.push('      @slot;');
  lines.push('    }');
  lines.push('  }');
  lines.push('  &:where([data-theme="dark"], [data-theme="dark"] *) {');
  lines.push('    @slot;');
  lines.push('  }');
  lines.push('}', '');

  lines.push('@media (prefers-color-scheme: dark) {');
  lines.push('  :root:not([data-theme="light"]) {');
  lines.push('    color-scheme: dark;');
  lines.push(...colorDeclarations('dark', '    '));
  lines.push('  }');
  lines.push('}', '');

  lines.push(':root[data-theme="dark"] {');
  lines.push('  color-scheme: dark;');
  lines.push(...colorDeclarations('dark', '  '));
  lines.push('}', '');

  lines.push(BASE_INTRO);
  lines.push('@layer base {');
  lines.push('  html:not([dir]) {');
  lines.push('    direction: rtl;');
  lines.push('  }');
  lines.push('');
  lines.push('  html {');
  lines.push('    color-scheme: light;');
  lines.push('  }');
  lines.push('');
  lines.push('  body {');
  lines.push('    background-color: var(--color-paper);');
  lines.push('    color: var(--color-ink);');
  lines.push(`    font-family: var(--font-body);`);
  lines.push(`    font-size: var(--text-${fontSizeSteps[0]});`);
  lines.push(`    line-height: var(--text-${fontSizeSteps[0]}--line-height);`);
  lines.push('    /* Grayscale antialiasing: the display face carries its authority in mass,');
  lines.push('       and macOS subpixel rendering thickens 700–900 further against a light');
  lines.push('       ground until a price reads as shouted rather than measured. */');
  lines.push('    -webkit-font-smoothing: antialiased;');
  lines.push('    -moz-osx-font-smoothing: grayscale;');
  lines.push('  }');
  lines.push('}', '');

  lines.push(TABULAR_INTRO);
  lines.push('@utility tabular {');
  lines.push(`  font-family: var(--font-${moneyFontFamily});`);
  lines.push(`  font-variant-numeric: ${tabularNumerals};`);
  lines.push('  font-feature-settings: normal;');
  lines.push('}');

  return lines.join(NL) + NL;
}

export function writeThemeCss(): string {
  const css = buildThemeCss();
  mkdirSync(dirname(THEME_CSS_PATH), { recursive: true });
  writeFileSync(THEME_CSS_PATH, css, 'utf8');
  return css;
}

// Importing this module must not touch the filesystem — the test imports it to
// compare the committed file against a fresh build, and a generator that wrote
// on import would repair the drift it was meant to report.
const invokedAs = process.argv[1];
if (invokedAs !== undefined && resolve(invokedAs) === fileURLToPath(import.meta.url)) {
  writeThemeCss();
  process.stdout.write(`theme.css written from tokens → ${THEME_CSS_PATH}\n`);
}
