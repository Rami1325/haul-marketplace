import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import { THEME_CSS_PATH, buildThemeCss } from '../../scripts/build-theme-css.mjs';
import { colorCssNames, colorThemes, colorTokens } from '../tokens/color.js';
import { durationTokens } from '../tokens/motion.js';
import { fontSizeSteps } from '../tokens/type.js';

/**
 * A generated file that has drifted from its source is worse than no generator,
 * because it goes on looking authoritative. `src/styles/theme.css` is committed —
 * it has to be, the web app imports it — so nothing about reading it tells you
 * whether it still agrees with `src/tokens/*.ts`. The load-bearing test here is
 * the first one: rebuild the stylesheet in memory and compare bytes. A token
 * edited without a rebuild fails CI instead of shipping a green that only the
 * TypeScript half of the system believes in.
 *
 * The rest of the file guards the things byte-equality cannot see. That the
 * committed CSS is what *Tailwind* thinks it is, rather than what we hope: the
 * compiler is run over it against the utilities the components actually use, and
 * a stylesheet that parses cleanly while emitting nothing would pass every string
 * assertion in the world. And that the dark block redeclares colour and only
 * colour, because a spacing token repeated there is a second place to change it.
 */

const CSS = readFileSync(THEME_CSS_PATH, 'utf8');

const EXPECTED_COLOR_PROPERTIES = colorTokens.map((token) => `--color-${colorCssNames[token]}`);

/** The utilities WS-4's components are built from. The fixture is small on purpose. */
const FIXTURE = ['bg-paper', 'text-ink', 'text-step-2', 'duration-settle', 'font-display'] as const;

/**
 * The body of a block, brace-matched rather than regexed, because the dark media
 * query nests one level and a lazy `[^}]*` would stop at the inner brace and
 * quietly assert against half a block.
 */
function blockBody(opener: string): string {
  const start = CSS.indexOf(opener);
  if (start === -1) {
    throw new Error(`theme-css.test: no block opening with "${opener.trim()}" in theme.css`);
  }
  const from = CSS.indexOf('{', start) + 1;
  let depth = 1;
  let index = from;
  while (index < CSS.length && depth > 0) {
    const char = CSS[index];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    index += 1;
  }
  if (depth !== 0) throw new Error(`theme-css.test: unbalanced braces after "${opener.trim()}"`);
  return CSS.slice(from, index - 1);
}

/** Custom-property declarations in a block, by name. Comment lines cannot match. */
function customProperties(body: string): Map<string, string> {
  const declared = new Map<string, string>();
  for (const match of body.matchAll(/^\s*(--[a-z0-9-]+):\s*(.+);$/gm)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) declared.set(name, value);
  }
  return declared;
}

const THEME_BLOCK = customProperties(blockBody('@theme static {'));
const DARK_MEDIA_BLOCK = customProperties(blockBody('\n  :root:not([data-theme="light"]) {'));
const DARK_ATTRIBUTE_BLOCK = customProperties(blockBody('\n:root[data-theme="dark"] {'));

async function compileWith(candidates: readonly string[]): Promise<string> {
  const require = createRequire(import.meta.url);
  const entry = require.resolve('tailwindcss/index.css');
  const compiler = await compile(CSS, {
    base: dirname(THEME_CSS_PATH),
    loadStylesheet: async (id: string) => {
      if (id !== 'tailwindcss') {
        throw new Error(
          `theme-css.test: theme.css imports "${id}", which this test cannot resolve`,
        );
      }
      return { path: entry, base: dirname(entry), content: readFileSync(entry, 'utf8') };
    },
  });
  return compiler.build([...candidates]);
}

describe('the committed stylesheet', () => {
  it('is byte-identical to a fresh build from the tokens', () => {
    // The whole point. If this fails, nothing is broken yet — but a token has
    // moved and the stylesheet has not, so the two halves of the design system
    // now disagree and only one of them is visible in a browser.
    expect(
      CSS,
      'src/styles/theme.css is stale — run `pnpm --filter @haul/ui build:theme` and commit it',
    ).toBe(buildThemeCss());
  });

  it('builds deterministically, so a rebuild with no token change is an empty diff', () => {
    expect(buildThemeCss()).toBe(buildThemeCss());
  });

  it('says it is generated, at the top, where an editor will see it first', () => {
    expect(CSS.startsWith('/* ')).toBe(true);
    expect(CSS.slice(0, 1200)).toContain('GENERATED FILE — DO NOT EDIT.');
    expect(CSS.slice(0, 1200)).toContain('build:theme');
  });

  it('is LF-only and ends in exactly one newline', () => {
    // `.gitattributes` normalises to LF; a generator writing CRLF would make
    // every checkout on Windows produce a diff against itself.
    expect(CSS).not.toContain('\r');
    expect(CSS.endsWith('\n')).toBe(true);
    expect(CSS.endsWith('\n\n')).toBe(false);
  });

  it('imports Tailwind before declaring anything, which is the order v4 requires', () => {
    const theImport = CSS.indexOf('@import "tailwindcss";');
    expect(theImport).toBeGreaterThan(-1);
    expect(theImport).toBeLessThan(CSS.indexOf('@theme'));
  });
});

describe('colour', () => {
  it('declares all fifteen tokens in the light default', () => {
    for (const property of EXPECTED_COLOR_PROPERTIES) {
      expect(THEME_BLOCK.has(property), property).toBe(true);
    }
  });

  it.each([
    ['the media query', DARK_MEDIA_BLOCK],
    ['the manual override', DARK_ATTRIBUTE_BLOCK],
  ])('declares all fifteen tokens in %s', (_label, block) => {
    for (const property of EXPECTED_COLOR_PROPERTIES) {
      expect(block.has(property), property).toBe(true);
    }
  });

  it('quotes the light palette exactly as the tokens hold it', () => {
    for (const token of colorTokens) {
      expect(THEME_BLOCK.get(`--color-${colorCssNames[token]}`), token).toBe(
        colorThemes.light[token],
      );
    }
  });

  it.each([
    ['the media query', DARK_MEDIA_BLOCK],
    ['the manual override', DARK_ATTRIBUTE_BLOCK],
  ])('quotes the dark palette exactly as the tokens hold it, in %s', (_label, block) => {
    for (const token of colorTokens) {
      expect(block.get(`--color-${colorCssNames[token]}`), token).toBe(colorThemes.dark[token]);
    }
  });

  it.each([
    ['the media query', DARK_MEDIA_BLOCK],
    ['the manual override', DARK_ATTRIBUTE_BLOCK],
  ])('redeclares colour and nothing else in %s', (_label, block) => {
    // Spacing, type, radii and motion have no dark counterpart. Repeating one
    // here would create a second place to change it, which is the failure the
    // generator exists to prevent.
    expect([...block.keys()].filter((name) => !name.startsWith('--color-'))).toEqual([]);
    expect(block.size).toBe(EXPECTED_COLOR_PROPERTIES.length);
  });

  it('gives the two dark blocks identical contents, since they are one decision', () => {
    expect([...DARK_ATTRIBUTE_BLOCK]).toEqual([...DARK_MEDIA_BLOCK]);
  });

  it('lets an explicit light choice survive a dark system', () => {
    // Without the `:not`, a user who asked for light on a dark phone gets dark,
    // and the light-mode contrast work is unreachable for them.
    expect(CSS).toContain(':root:not([data-theme="light"])');
    // And the manual override must come last, or a dark choice on a light phone
    // is overruled by nothing at all.
    expect(CSS.lastIndexOf(':root[data-theme="dark"] {')).toBeGreaterThan(
      CSS.indexOf('\n  :root:not([data-theme="light"]) {'),
    );
  });

  it('switches `color-scheme` with the theme, so the chrome follows the page', () => {
    expect(CSS).toContain('color-scheme: light;');
    expect(CSS.match(/color-scheme: dark;/g)).toHaveLength(2);
  });
});

describe('the rest of the scale', () => {
  it('pairs every type step with its leading, the way v4 expects', () => {
    for (const step of fontSizeSteps) {
      expect(THEME_BLOCK.has(`--text-${step}`), step).toBe(true);
      expect(THEME_BLOCK.has(`--text-${step}--line-height`), step).toBe(true);
    }
  });

  it('puts the durations in the namespace Tailwind actually reads', () => {
    // `--duration-*` is the obvious name and it is the wrong one: it produces no
    // error and no utility, so `duration-settle` would silently do nothing.
    for (const token of durationTokens) {
      expect(THEME_BLOCK.has(`--transition-duration-${token}`), token).toBe(true);
      expect(THEME_BLOCK.has(`--duration-${token}`), token).toBe(false);
    }
  });
});

describe('RTL purity', () => {
  it.each([
    ['padding-left', /padding-left/],
    ['padding-right', /padding-right/],
    ['margin-left', /margin-left/],
    ['margin-right', /margin-right/],
    ['border-left', /border-left/],
    ['border-right', /border-right/],
    ['a physical text-align', /text-align:\s*(?:left|right)/],
    ['a physical inset', /(?:^|[\s{;])(?:left|right):/m],
    ['a physical utility', /(?:^|[\s.])(?:pl|pr|ml|mr)-\d/],
  ])('contains no %s', (_label, banned) => {
    expect(banned.test(CSS)).toBe(false);
  });

  it('makes RTL the default without overruling an explicit dir', () => {
    expect(CSS).toContain('html:not([dir])');
    expect(CSS).toContain('direction: rtl;');
  });
});

describe('Tailwind can actually compile it', () => {
  it('emits a rule for every utility the components are built from', async () => {
    const output = await compileWith(FIXTURE);

    expect(output.length).toBeGreaterThan(0);
    for (const candidate of FIXTURE) {
      expect(output, candidate).toContain(`.${candidate} {`);
    }
    expect(output).toContain('background-color: var(--color-paper);');
    expect(output).toContain('color: var(--color-ink);');
    expect(output).toContain('transition-duration: var(--transition-duration-settle);');
    expect(output).toContain('font-family: var(--font-display);');
    expect(output).toContain('font-size: var(--text-step-2);');
  });

  it('emits the variables themselves, both themes', async () => {
    const output = await compileWith(FIXTURE);

    for (const token of colorTokens) {
      const property = `--color-${colorCssNames[token]}`;
      expect(output, `${property} (light)`).toContain(`${property}: ${colorThemes.light[token]};`);
      expect(output, `${property} (dark)`).toContain(`${property}: ${colorThemes.dark[token]};`);
    }
  });

  it('can tell an emitted rule from a silent nothing', () => {
    // Without this, every assertion above would also pass on a stylesheet that
    // parsed cleanly and produced no utilities whatsoever.
    return expect(compileWith(['bg-not-a-real-token'])).resolves.not.toContain(
      '.bg-not-a-real-token',
    );
  });

  it('gives money the display face and tabular figures in one class', async () => {
    const output = await compileWith(['tabular']);

    expect(output).toContain('.tabular {');
    expect(output).toContain('font-family: var(--font-display);');
    expect(output).toContain('font-variant-numeric: tabular-nums;');
    // Blocks an ancestor's `font-feature-settings` from un-aligning a price.
    expect(output).toContain('font-feature-settings: normal;');
  });

  it('teaches the `dark:` variant about the manual override too', async () => {
    const output = await compileWith(['dark:bg-card']);

    // Both halves of the three-state rule, or a hand-written dark exception
    // would apply on a dark phone and not on a manually darkened light one.
    expect(output).toContain('(prefers-color-scheme: dark)');
    expect(output).toContain('[data-theme="dark"]');
  });
});
