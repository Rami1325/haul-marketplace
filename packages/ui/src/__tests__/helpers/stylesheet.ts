import { compile } from 'tailwindcss';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/**
 * ---------------------------------------------------------------------------
 * Asking the stylesheet, not the class attribute
 * ---------------------------------------------------------------------------
 * jsdom parses no CSS, so `getComputedStyle` on a rendered component reports
 * nothing useful and a test that wants to know how tall a button is has to get
 * that number from somewhere else. The tempting shortcut is to read it back out
 * of the class name with a regex — and this package briefly did, which is how a
 * suite of green tap-target tests sat on top of buttons that had no height rule
 * at all. The regex was asserting that a string had been written, not that a
 * control had a size.
 *
 * This helper closes that gap by compiling the class through the real Tailwind
 * compiler with the real `theme.css`, then resolving whatever custom property
 * the declaration lands on against the theme's own value. What comes back is
 * the number a browser would use.
 * ---------------------------------------------------------------------------
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '..', '..', '..');
const THEME_CSS = path.join(PACKAGE_ROOT, 'src', 'styles', 'theme.css');

const require = createRequire(import.meta.url);
const TAILWIND_DIR = path.dirname(require.resolve('tailwindcss/package.json'));

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

const compiler = await compile(fs.readFileSync(THEME_CSS, 'utf8'), {
  base: PACKAGE_ROOT,
  loadStylesheet,
});

/** The compiled CSS for a set of classes, as a browser would receive it. */
export function cssFor(classNames: readonly string[]): string {
  return compiler.build([...classNames]);
}

/**
 * The declared value of a `--custom-property`, read out of a compiled sheet.
 *
 * It has to be *that* sheet rather than a theme dump taken once up front:
 * Tailwind only emits the custom properties a build's candidates actually
 * reference, so `compiler.build([])` contains no variables at all and every
 * lookup against it silently returns null.
 */
export function themeValue(property: string, css: string): string | null {
  const match = new RegExp(`${property}:\\s*([^;]+);`).exec(css);
  return match?.[1]?.trim() ?? null;
}

function toPx(value: string, css: string): number | null {
  const direct = /^(-?[\d.]+)px$/.exec(value.trim());
  if (direct?.[1]) return Number(direct[1]);

  const variable = /^var\((--[\w-]+)\)$/.exec(value.trim());
  if (variable?.[1]) {
    const resolved = themeValue(variable[1], css);
    return resolved ? toPx(resolved, css) : null;
  }
  return null;
}

const NEEDS_ESCAPE = /[[\]().:!/%,#'"+*>~^$|=]/g;
const asSelector = (className: string) => className.replace(NEEDS_ESCAPE, (ch) => '\\' + ch);

/**
 * The declarations inside one class's own rule.
 *
 * Scoped deliberately. Searching the whole sheet for a property finds
 * Tailwind's preflight first — its `min-height: 1lh` on form controls sits
 * above every utility — so an unscoped match reads a reset value and concludes
 * the utility is missing.
 */
function ownDeclarations(className: string, css: string): string | null {
  const start = css.indexOf(`.${asSelector(className)} {`);
  if (start === -1) return null;
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  if (open === -1 || close === -1) return null;
  return css.slice(open + 1, close);
}

/**
 * The resolved `min-height` in CSS pixels for whichever class on an element
 * declares one. Returns null when no class on the element produces the property
 * at all — which is the case worth failing on, not a detail to paper over.
 */
export function resolvedMinHeightPx(className: string): number | null {
  for (const token of className.split(/\s+/).filter(Boolean)) {
    const css = compiler.build([token]);
    const block = ownDeclarations(token, css);
    if (!block) continue;
    const declaration = /min-height:\s*([^;}]+)/.exec(block);
    if (!declaration?.[1]) continue;
    const px = toPx(declaration[1], css);
    if (px !== null) return px;
  }
  return null;
}

/**
 * Whether any class in a list declares a fixed `height`, which would cap a
 * control instead of flooring it and clip its label under enlarged type.
 */
export function declaresFixedHeightPx(className: string): boolean {
  return className
    .split(/\s+/)
    .filter(Boolean)
    .some((token) => {
      const block = ownDeclarations(token, compiler.build([token]));
      return block ? /(?:^|[;\s])height:\s*[\d.]+px/.test(block) : false;
    });
}

/** Whether a class compiles to any rule at all. */
export function compilesToARule(className: string): boolean {
  return compiler.build([className]).includes(asSelector(className));
}
