import { Scanner } from '@tailwindcss/oxide';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';

/**
 * ---------------------------------------------------------------------------
 * The assertion `@haul/ui` cannot make about itself
 * ---------------------------------------------------------------------------
 * The design system's own `tailwind.test.ts` compiles every class its components
 * render and proves each one resolves to a rule. That test passes whether or not
 * the class ever reaches an application, because it hands the class to the
 * compiler as a candidate itself. From inside the package everything works.
 *
 * The failure this file exists for happens one directory up. Tailwind discovers
 * utilities by scanning source *text*, and its automatic detection deliberately
 * never walks `node_modules`. pnpm links `@haul/ui` into `node_modules` as a
 * symlink, so unless `globals.css` points an explicit `@source` at the real
 * workspace path, not one class the design system renders is ever a candidate.
 * The components still emit their full `class` attributes; there is simply no
 * CSS behind any of them. Every render test in this repo still passes, and the
 * page is unstyled.
 *
 * So this compiles the app's real stylesheet through the real Tailwind resolver
 * and the real Oxide scanner — the same two pieces `@tailwindcss/postcss` uses —
 * and asks whether utilities that exist *only* in `packages/ui` came out the
 * other end. Then it removes the glob and asks again, because a positive result
 * on its own does not prove the glob is what produced it.
 * ---------------------------------------------------------------------------
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..', '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..');
const GLOBALS_CSS = path.join(APP_ROOT, 'src', 'app', 'globals.css');
const UI_SRC = path.join(REPO_ROOT, 'packages', 'ui', 'src');

const require = createRequire(path.join(APP_ROOT, 'package.json'));
const TAILWIND_DIR = path.dirname(require.resolve('tailwindcss/package.json'));

const posix = (value: string): string => value.replaceAll('\\', '/');

/**
 * Utilities that exist in `packages/ui` and nowhere in this app.
 *
 * The list is small on purpose and each entry is checked from both directions
 * below — present in the design system's source, absent from the app's. A probe
 * that quietly stopped being ui-only would turn this whole file into a test that
 * the app can style itself, which it can, and which proves nothing.
 */
const UI_ONLY_UTILITIES = [
  // The track under a loading Button.
  'bg-current/20',
  // The indeterminate progress sweep — the banned spinner's replacement.
  'animate-sweep',
  // The bidi isolation on every rendered amount.
  '[unicode-bidi:isolate]',
] as const;

/** Characters CSS requires escaped when a class name becomes a selector. */
const NEEDS_ESCAPE = /[[\]().:!/%,#'"+*>~^$|=]/g;
const asSelector = (className: string): string =>
  `.${className.replace(NEEDS_ESCAPE, (character) => '\\' + character)}`;

interface Build {
  readonly css: string;
  readonly scannedFiles: readonly string[];
  readonly importedIds: readonly string[];
}

/**
 * Compile a stylesheet exactly the way the PostCSS plugin does: resolve every
 * `@import` through Node, hand the resulting `sources` to Oxide, scan, build.
 *
 * `loadStylesheet` reproduces Tailwind's own resolution rather than stubbing it.
 * The tempting shortcut — returning an empty string for `tailwindcss` — drops
 * preflight and the entire utility layer, and reports the app as comprehensively
 * broken.
 */
async function build(css: string): Promise<Build> {
  const importedIds: string[] = [];

  const compiler = await compile(css, {
    base: path.dirname(GLOBALS_CSS),
    async loadStylesheet(id: string, base: string) {
      importedIds.push(id);
      let file: string;
      if (id === 'tailwindcss') {
        file = path.join(TAILWIND_DIR, 'index.css');
      } else if (id.startsWith('tailwindcss/')) {
        file = path.join(TAILWIND_DIR, id.slice('tailwindcss/'.length));
      } else if (id.startsWith('.')) {
        file = path.resolve(base, id);
      } else {
        // A bare specifier — `@haul/ui/theme.css`, `@fontsource-variable/heebo`.
        // Resolved through Node so the package's own `exports` map decides,
        // which is the same answer the bundler gets.
        file = require.resolve(id, { paths: [base, APP_ROOT] });
      }
      if (!file.endsWith('.css')) file += '.css';
      return { path: file, base: path.dirname(file), content: fs.readFileSync(file, 'utf8') };
    },
  });

  const scanner = new Scanner({ sources: compiler.sources });
  const candidates = scanner.scan();
  return { css: compiler.build(candidates), scannedFiles: scanner.files.map(posix), importedIds };
}

const source = fs.readFileSync(GLOBALS_CSS, 'utf8');
const built = await build(source);

/**
 * The same stylesheet with the workspace glob taken out — the exact edit a
 * reviewer would make on the grounds that it looks redundant next to the app's
 * own `@source`.
 */
const WITHOUT_UI_SOURCE = source
  .split('\n')
  .filter((line) => !(line.startsWith('@source') && line.includes('packages/ui/src/**')))
  .join('\n');
const withoutUiSource = await build(WITHOUT_UI_SOURCE);

function readTree(root: string, skip: ReadonlySet<string>): string {
  let text = '';
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) text += readTree(child, skip);
    else if (/\.(?:tsx?|css)$/.test(entry.name)) text += fs.readFileSync(child, 'utf8');
  }
  return text;
}

describe('the app compiles the design system, not just its own classes', () => {
  it('reaches packages/ui through the workspace glob', () => {
    const reached = built.scannedFiles.filter((file) => file.includes('/packages/ui/src/'));
    expect(reached.length).toBeGreaterThan(10);
    // Not merely "some file under packages/ui" — the components, which are the
    // files that carry class names.
    expect(reached.some((file) => file.endsWith('/components/button.tsx'))).toBe(true);
  });

  it('scans this app as well, so the glob covers more than the design system', () => {
    expect(built.scannedFiles.some((file) => file.endsWith('/src/app/[locale]/page.tsx'))).toBe(
      true,
    );
  });

  it('scans no test source, so a fixture cannot become a shipped rule', () => {
    // `rtl.node.test.ts` is deliberately full of `pl-4` and `text-right`. Those
    // are the forms this product bans; compiling them would put physical
    // padding into the stylesheet of an RTL-first app.
    expect(built.scannedFiles.filter((file) => file.includes('__tests__'))).toEqual([]);
    expect(built.css).not.toContain('.pl-4');
  });

  it.each(UI_ONLY_UTILITIES)('%s exists in packages/ui and nowhere in this app', (utility) => {
    const uiSource = readTree(UI_SRC, new Set(['__tests__']));
    const appSource = readTree(path.join(APP_ROOT, 'src'), new Set(['__tests__']));
    expect(uiSource).toContain(utility);
    expect(appSource).not.toContain(utility);
  });

  it.each(UI_ONLY_UTILITIES)('%s has CSS behind it in the app stylesheet', (utility) => {
    expect(built.css).toContain(asSelector(utility));
  });

  it.each(UI_ONLY_UTILITIES)('%s disappears when the workspace glob is removed', (utility) => {
    // The half that makes the assertion above mean something. Without this, a
    // Tailwind release that started crawling symlinked workspace packages by
    // itself would keep this file green while the comment in `globals.css`
    // quietly became false — and the glob would be deleted by the next person
    // who read it as redundant.
    expect(withoutUiSource.css).not.toContain(asSelector(utility));
  });

  it('still compiles the app’s own classes without the glob, so the control is honest', () => {
    // Proves the negative result above is the missing glob and not a broken
    // build: the page's own utilities survive the edit.
    expect(withoutUiSource.css).toContain('.min-h-dvh');
  });
});

describe('the font faces', () => {
  it('are in the stylesheet at all', () => {
    expect(built.css).toContain('@font-face');
  });

  it('cover ₪ U+20AA, which the bare latin subset does not', () => {
    // This is the claim `tokens/type.ts` makes about the shekel sign, checked
    // against the shipped `unicode-range` rather than trusted. Fontsource's
    // `latin` subset carries U+20AC for the euro and stops; ₪ lives in `hebrew`
    // and in `latin-ext`. Load Latin only and the largest glyph on the Price
    // Card renders in a system fallback beside Heebo digits.
    const faces = built.css.split('@font-face').slice(1);
    const covering = faces.filter((face) => /unicode-range:[^;}]*U\+20AA/i.test(face));
    expect(covering.length).toBeGreaterThan(0);
    expect(covering.some((face) => face.includes('heebo-hebrew'))).toBe(true);
    expect(covering.some((face) => face.includes('rubik-hebrew'))).toBe(true);
  });

  it('are self-hosted — nothing is fetched from a font CDN', () => {
    expect(built.css).not.toContain('fonts.googleapis.com');
    expect(built.css).not.toContain('fonts.gstatic.com');
  });
});

describe('tailwindcss is imported exactly once across the CSS graph', () => {
  it('is pulled in by the design system and not again by the app', () => {
    // `@haul/ui/theme.css` opens with `@import "tailwindcss"` because it is the
    // file that declares `@theme static`. A second import here would emit
    // preflight and the whole utility layer twice, and the later copy wins on
    // equal specificity — a duplicated stylesheet that looks fine until an
    // override stops working.
    expect(built.importedIds.filter((id) => id === 'tailwindcss')).toHaveLength(1);
    // Comments stripped first: this file's own explanation of the rule names
    // the directive, and a check that reads prose as code is a check that
    // fails the moment somebody documents what it is for.
    expect(source.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/@import\s+["']tailwindcss["']/);
    // Preflight, once. The most visible half of a duplicated import.
    expect(built.css.match(/-webkit-tap-highlight-color/g) ?? []).toHaveLength(1);
  });
});

describe('no class in this app is built at runtime', () => {
  /**
   * The source scan, and it cannot be replaced by the compile above.
   * `compiler.build([cls])` *supplies* the class as a candidate, so an
   * interpolated `min-h-[44px]` compiles perfectly well when handed over
   * directly. The compiler can prove a class is well-formed; only reading the
   * source proves the scanner ever found it. This is the bug that shipped a
   * product's worth of heightless buttons in `@haul/ui`.
   */
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(child);
      } else if (/\.tsx?$/.test(entry.name)) {
        files.push(child);
      }
    }
  })(path.join(APP_ROOT, 'src'));

  it('finds source to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('interpolates no value into a Tailwind class', () => {
    const offenders: string[] = [];

    for (const file of files) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          const trimmed = line.trimStart();
          if (trimmed.startsWith('*') || trimmed.startsWith('//')) return;

          for (const template of line.match(/`[^`]*\$\{[^`]*`/g) ?? []) {
            if (/[a-z-]+-[[(]/.test(template)) {
              offenders.push(`${posix(path.relative(APP_ROOT, file))}:${index + 1}  ${template}`);
            }
          }
        });
    }

    expect(
      offenders,
      `classes assembled at runtime never reach Tailwind:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('would catch one — the scanner is the thing being trusted', () => {
    const fixture = 'className={`min-h-[${controlHeights.sm}]`}';
    expect(/`[^`]*\$\{[^`]*`/.test(fixture)).toBe(true);
    expect(/[a-z-]+-[[(]/.test(fixture)).toBe(true);
  });
});
