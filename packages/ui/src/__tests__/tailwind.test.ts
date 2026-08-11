import { describe, expect, it } from 'vitest';
import { compile } from 'tailwindcss';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { buttonVariants } from '../components/button.js';
import { cardVariants } from '../components/card.js';
import { chipVariants } from '../components/chip.js';
import { gridVariants } from '../components/grid.js';
import { iconSizeClasses } from '../components/icon.js';
import { moneyVariants } from '../components/money.js';
import { priceCardVariants } from '../components/price-card.js';
import { progressVariants } from '../components/progress.js';
import { stackVariants } from '../components/stack.js';

/**
 * ---------------------------------------------------------------------------
 * Every class this package renders must have CSS behind it
 * ---------------------------------------------------------------------------
 * Tailwind does not read this package's TypeScript. It scans source *text* for
 * things that look like class names and compiles the ones it finds, which means
 * a class assembled at runtime is a class that never reaches the stylesheet.
 *
 * That failure is invisible in every other kind of test. `min-h-[${height}]`
 * renders a `class` attribute containing `min-h-[44px]`, so a test that reads
 * `element.className` and matches a regex passes happily — while the compiled
 * CSS contains no such rule and the control has no height at all. This package
 * shipped exactly that bug on Button and Chip: the string was asserted, the
 * stylesheet was never consulted, and the primary action on every screen of the
 * booking flow had collapsed to its line box.
 *
 * It takes two checks to close that hole, because neither one closes it alone.
 *
 * **The matrix walk** compiles every class the recipes can produce — the full
 * cartesian product, read off the recipes themselves rather than a list written
 * here, so a variant added tomorrow is covered tomorrow. What it proves is that
 * each class is a real utility that resolves against the real `theme.css`: it
 * catches a typo, a renamed token, and a colour dropped from `@theme` while a
 * component still asks for it.
 *
 * **The source scan** is what actually catches interpolation, and it has to
 * exist separately for a reason worth stating plainly: `compiler.build([cls])`
 * *supplies* the class as a candidate, so `min-h-[44px]` compiles perfectly well
 * when handed over directly. The compiler can tell you a class is well-formed.
 * It cannot tell you the scanner never found it in your source — and that, not
 * malformedness, is the entire bug. So the rule is enforced on the text.
 *
 * A dead class is not always a missing rule: `group` and `peer` are markers that
 * legitimately emit no CSS of their own. Those are named explicitly below rather
 * than pattern-matched away, because the whole value of this test is that
 * nothing gets to be silently exempt.
 * ---------------------------------------------------------------------------
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '..', '..');
const THEME_CSS = path.join(PACKAGE_ROOT, 'src', 'styles', 'theme.css');

const require = createRequire(import.meta.url);
const TAILWIND_DIR = path.dirname(require.resolve('tailwindcss/package.json'));

/**
 * Tailwind's own `@import` resolution, reproduced so the compiler is loaded with
 * its real preflight and utility layers. Stubbing this out is the easy mistake:
 * with an empty `tailwindcss` import every core utility silently vanishes and
 * the test reports the entire package as broken.
 */
async function loadStylesheet(id: string, base: string) {
  let file: string;
  if (id === 'tailwindcss') {
    file = path.join(TAILWIND_DIR, 'index.css');
  } else if (id.startsWith('tailwindcss/')) {
    file = path.join(TAILWIND_DIR, id.slice('tailwindcss/'.length));
  } else {
    file = path.resolve(base, id);
  }
  if (!file.endsWith('.css')) file += '.css';
  return { path: file, base: path.dirname(file), content: fs.readFileSync(file, 'utf8') };
}

/** Characters CSS requires escaped when a class name becomes a selector. */
const NEEDS_ESCAPE = /[[\]().:!/%,#'"+*>~^$|=]/g;
const asSelector = (className: string) => className.replace(NEEDS_ESCAPE, (ch) => '\\' + ch);

/** Markers that carry no declarations of their own. Named, never inferred. */
const EMITS_NO_CSS_BY_DESIGN = new Set(['group', 'peer']);

/**
 * Only what this file needs from a recipe: call it with a combination, and read
 * the variant matrix back off it. Each `VariantFn` is generic over its own
 * variant shape and no two are the same type, so they are widened to this common
 * one rather than joined under `any` — the properties below are real, and the
 * cast says which ones are being relied on.
 */
type IntrospectableRecipe = {
  (props?: Record<string, string>): string;
  readonly recipe: { readonly variants: Record<string, Record<string, string> | undefined> };
};

/** Requires a `recipe` to exist, then widens; it cannot be handed a plain function. */
const introspect = (fn: { readonly recipe: unknown }): IntrospectableRecipe =>
  fn as unknown as IntrospectableRecipe;

const RECIPES: Readonly<Record<string, IntrospectableRecipe>> = {
  button: introspect(buttonVariants),
  card: introspect(cardVariants),
  chip: introspect(chipVariants),
  grid: introspect(gridVariants),
  money: introspect(moneyVariants),
  priceCard: introspect(priceCardVariants),
  progress: introspect(progressVariants),
  stack: introspect(stackVariants),
};

/**
 * Class tables that are not recipes and still have to compile. `Icon` picks a
 * size class by key rather than through `variants`, which puts it outside the
 * matrix walk above and inside exactly the same hazard: a renamed `--icon-*`
 * token leaves a glyph at whatever size an untouched `<svg>` happens to be.
 */
const CLASS_TABLES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  icon: iconSizeClasses,
};

/** Every combination of every variant, so no branch of a recipe goes unchecked. */
function everyCombination(fn: IntrospectableRecipe): string[] {
  const keys = Object.keys(fn.recipe.variants);
  let combos: Array<Record<string, string>> = [{}];
  for (const key of keys) {
    const options = Object.keys(fn.recipe.variants[key] ?? {});
    combos = combos.flatMap((combo) => options.map((option) => ({ ...combo, [key]: option })));
  }
  return combos.map((combo) => fn(combo));
}

function classesFrom(fn: IntrospectableRecipe): Set<string> {
  const found = new Set<string>();
  for (const result of everyCombination(fn)) {
    for (const token of result.split(/\s+/)) if (token) found.add(token);
  }
  return found;
}

const compiler = await compile(fs.readFileSync(THEME_CSS, 'utf8'), {
  base: PACKAGE_ROOT,
  loadStylesheet,
});

function compilesToARule(className: string): boolean {
  return compiler.build([className]).includes(asSelector(className));
}

describe('the compiler, not the class attribute', () => {
  it('agrees that a known-good utility compiles and a nonsense one does not', () => {
    // Guards the harness itself. Without this, a broken `compilesToARule` would
    // report the entire package as passing.
    expect(compilesToARule('bg-route')).toBe(true);
    expect(compilesToARule('bg-not-a-real-token')).toBe(false);
    expect(compilesToARule('min-h-(--control-sm)')).toBe(true);
    // The exact shape of the bug this file exists to catch: an arbitrary value
    // that was interpolated at runtime is never a candidate the scanner saw.
    expect(compilesToARule('min-h-[${controlHeights.sm}]')).toBe(false);
  });

  for (const [name, fn] of Object.entries(RECIPES)) {
    it(`every class ${name} can render compiles to a rule`, () => {
      const dead = [...classesFrom(fn)]
        .filter((className) => !EMITS_NO_CSS_BY_DESIGN.has(className))
        .filter((className) => !compilesToARule(className));

      expect(dead, `${name} renders classes with no CSS behind them: ${dead.join(', ')}`).toEqual(
        [],
      );
    });
  }

  for (const [name, table] of Object.entries(CLASS_TABLES)) {
    it(`every class in the ${name} table compiles to a rule`, () => {
      const dead = Object.values(table)
        .flatMap((value) => value.split(/\s+/))
        .filter(Boolean)
        .filter((className) => !EMITS_NO_CSS_BY_DESIGN.has(className))
        .filter((className) => !compilesToARule(className));

      expect(dead, `${name} names classes with no CSS behind them: ${dead.join(', ')}`).toEqual([]);
    });
  }
});

describe('no class is built at runtime', () => {
  const sourceFiles = fs
    .readdirSync(path.join(PACKAGE_ROOT, 'src', 'components'))
    .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
    .map((f) => path.join('src', 'components', f));

  /**
   * The static half of the same rule. The matrix check above can only see
   * classes that flow through a recipe; a template literal inlined in JSX would
   * slip past it, so the source is held to the rule directly.
   */
  it('no component interpolates a value into a Tailwind class', () => {
    const offenders: string[] = [];

    for (const relative of sourceFiles) {
      const source = fs.readFileSync(path.join(PACKAGE_ROOT, relative), 'utf8');
      source.split('\n').forEach((line, index) => {
        if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;

        // A backtick string containing `${` that also contains something shaped
        // like a Tailwind utility with a bracket or paren value.
        const templates = line.match(/`[^`]*\$\{[^`]*`/g) ?? [];
        for (const template of templates) {
          if (/[a-z-]+-[[(]/.test(template)) {
            offenders.push(`${relative}:${index + 1}  ${template.trim()}`);
          }
        }
      });
    }

    expect(
      offenders,
      `classes assembled at runtime never reach Tailwind:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
