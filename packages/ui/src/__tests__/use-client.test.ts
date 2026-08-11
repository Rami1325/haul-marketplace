import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ---------------------------------------------------------------------------
 * The server/client boundary, enforced by reading the source
 * ---------------------------------------------------------------------------
 * `components/direction.tsx` called `createContext` at module scope with no
 * `'use client'` above it, and it is re-exported from the barrel. That is not a
 * component that fails to render on the server — it is a *package* that cannot
 * be imported on the server. Any `import { Money } from '@haul/ui'` inside a
 * React Server Component pulls the barrel, the barrel pulls direction, React
 * evaluates `createContext` in an environment that does not have it, and the
 * Next.js build stops. `button.tsx` and `money.tsx` were one hook away from the
 * same thing.
 *
 * The failure has three properties that make it worth a structural test rather
 * than a convention. It is invisible here: every test in this package renders in
 * jsdom, where there is no server and the directive means nothing, so a suite of
 * 863 green tests sat on top of it. It is total: one unmarked module poisons
 * every import of the package, including the ones that only wanted a token. And
 * it comes back, because the way it is reintroduced is somebody adding a hook to
 * a component that did not have one — which is an ordinary, correct-looking
 * change that nothing else in the pipeline objects to.
 *
 * ## What counts as needing the directive
 *
 * A module needs it when it does something a Server Component cannot: calls a
 * hook, creates a context, attaches an event handler, or reaches for a browser
 * API. Those are the markers below, and they are patterns over the source with
 * comments stripped — prose describing `useState` is not a call to it, and the
 * headers in this package describe these APIs constantly.
 *
 * ## And what counts as not needing it
 *
 * The converse is asserted too, and it is not symmetry for its own sake.
 * `'use client'` is a boundary, not a badge: marking a module puts it and
 * everything it imports into the client bundle, so a directive on `card.tsx`
 * would be harmless and a directive on the barrel would drag the entire token
 * layer — every colour, every measurement, in both themes — across to the
 * browser for a page that renders a static receipt. A purely presentational
 * primitive stays renderable on the server, which is the whole reason to know
 * which ones they are.
 * ---------------------------------------------------------------------------
 */

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const DIRECTIVE = "'use client';";

/** Everything shipped. `__tests__` is excluded: it never reaches a server build. */
const SCAN_ROOTS = ['components', 'icons', 'lib', 'tokens', 'styles'] as const;

const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set(['__tests__']);

interface Marker {
  /** Stable identity, so a fixture can prove this particular marker still fires. */
  readonly id: string;
  /** What was found, in words a reviewer can act on. */
  readonly name: string;
  readonly source: string;
}

/**
 * Everything a Server Component cannot do. Written as patterns rather than as an
 * import check because the import is not the problem — `import { useState }` in
 * a module that never calls it is inert, and `useDirection()` is a hook call
 * that no React import mentions at all.
 */
const MARKERS: readonly Marker[] = [
  {
    id: 'create-context',
    name: 'createContext at module scope',
    source: String.raw`\bcreateContext\s*[<(]`,
  },
  {
    id: 'hook-call',
    // Covers this package's own hooks as well as React's: `useDirection()` is a
    // `useContext` call wearing a different name, and it is the one that actually
    // spread through the components.
    name: 'React hook call',
    source: String.raw`(?<![\w$.])use[A-Z][A-Za-z0-9]*\s*[<(]`,
  },
  {
    id: 'event-handler',
    name: 'JSX event handler',
    source: String.raw`\son[A-Z][A-Za-z]*\s*=\s*\{`,
  },
  {
    id: 'browser-global',
    name: 'browser API',
    source: String.raw`\b(?:window|document|navigator|localStorage|sessionStorage)\s*\.|\bmatchMedia\s*\(|\baddEventListener\s*\(`,
  },
  {
    id: 'timer',
    name: 'timer or frame callback',
    source: String.raw`\b(?:setInterval|setTimeout|requestAnimationFrame)\s*\(`,
  },
  {
    id: 'portal',
    name: 'react-dom portal',
    source: String.raw`\bcreatePortal\s*\(`,
  },
];

/**
 * Comments are removed before anything is matched. Every header in this package
 * names the APIs below at length — `direction.tsx` explains `createContext` in
 * prose two paragraphs before calling it — and a scanner that could not tell the
 * two apart would report the entire package and get itself deleted.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

function markersIn(source: string): string[] {
  const code = stripComments(source);
  return MARKERS.filter((marker) => new RegExp(marker.source).test(code)).map(
    (marker) => marker.name,
  );
}

/**
 * Whether the directive is the first thing in the file. Position is not a style
 * point: a directive that follows an import is not a directive, it is a string
 * expression, and the bundler ignores it silently.
 */
function carriesDirective(source: string): boolean {
  const firstStatement = stripComments(source)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstStatement === DIRECTIVE;
}

function sourceFilesUnder(relative: string): string[] {
  const absolute = resolve(PACKAGE_ROOT, 'src', relative);
  const found: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const child = join(relative, entry).replaceAll('\\', '/');
    if (statSync(resolve(PACKAGE_ROOT, 'src', child)).isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry)) found.push(...sourceFilesUnder(child));
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) {
      found.push(child);
    }
  }
  return found.sort();
}

const FILES = ['index.ts', ...SCAN_ROOTS.flatMap(sourceFilesUnder)];

function read(relative: string): string {
  return readFileSync(resolve(PACKAGE_ROOT, 'src', relative), 'utf8');
}

/**
 * Modules that are marked despite doing nothing a server cannot. Empty on
 * purpose. An entry has to name a file and a reason, because the cost of a
 * needless directive is a bundle that quietly grows, which nobody notices.
 */
const CLIENT_WITHOUT_MARKERS: ReadonlyMap<string, string> = new Map();

describe('the server/client boundary', () => {
  it('finds the modules it means to check', () => {
    // A scanner that reads nothing passes forever.
    expect(FILES.length).toBeGreaterThan(15);
    expect(FILES).toContain('components/direction.tsx');
    expect(FILES).toContain('components/card.tsx');
    expect(FILES).toContain('icons/registry.ts');
    expect(FILES).toContain('tokens/color.ts');
  });

  it.each(FILES)('%s carries the directive when it needs one', (relative) => {
    const source = read(relative);
    const found = markersIn(source);
    if (found.length === 0) return;

    expect(
      carriesDirective(source),
      `src/${relative} does ${found.join(', ')} and has no ${DIRECTIVE} at the top — ` +
        'every import of @haul/ui inside a Server Component now fails',
    ).toBe(true);
  });

  it.each(FILES)('%s does not claim the client without needing it', (relative) => {
    const source = read(relative);
    if (!carriesDirective(source)) return;
    if (CLIENT_WITHOUT_MARKERS.has(relative)) return;

    expect(
      markersIn(source),
      `src/${relative} is marked ${DIRECTIVE} but does nothing a server cannot — ` +
        'it and everything it imports are being shipped to the browser for nothing',
    ).not.toEqual([]);
  });

  it('leaves the barrel on the server, so tokens are not dragged into the bundle', () => {
    // The barrel re-exporting client modules is fine and is how this is meant to
    // work: the boundary is the module that declares it. Marking the barrel
    // itself would pull the whole token layer — both palettes, every
    // measurement — across for a page that renders a static receipt.
    expect(carriesDirective(read('index.ts'))).toBe(false);
  });
});

/**
 * The specific regression. `direction.tsx` is the module that made this a
 * package-level failure rather than a component-level one, so it is named rather
 * than left to the sweep above.
 */
describe('the module that took the server build down', () => {
  it('marks direction.tsx, which the barrel re-exports and every component uses', () => {
    const source = read('components/direction.tsx');
    expect(markersIn(source)).toContain('createContext at module scope');
    expect(carriesDirective(source)).toBe(true);
    expect(read('index.ts')).toContain("from './components/direction.js'");
  });

  it.each(['components/button.tsx', 'components/money.tsx'])('marks %s', (relative) => {
    const source = read(relative);
    expect(markersIn(source)).not.toEqual([]);
    expect(carriesDirective(source)).toBe(true);
  });

  it.each([
    'components/card.tsx',
    'components/chip.tsx',
    'components/stack.tsx',
    'components/grid.tsx',
  ])('leaves %s renderable on the server', (relative) => {
    // These are presentational: no hook, no context, no handler of their own.
    // A caller that hands one an `onClick` is already inside a client
    // component, because a function prop cannot cross the boundary at all.
    const source = read(relative);
    expect(markersIn(source)).toEqual([]);
    expect(carriesDirective(source)).toBe(false);
  });
});

/**
 * The scanner is the thing being trusted, so it is the thing that gets tested.
 * A marker that quietly stops matching reads as a clean package: every file
 * passes, and the only thing the suite proves is that nothing was looked for.
 */
describe('the scanner itself', () => {
  const MUST_FLAG = [
    'const Ctx = createContext<Value>(fallback);',
    'const [value, setValue] = useState(0);',
    'useEffect(() => undefined, []);',
    'const node = useRef<HTMLElement | null>(null);',
    'const wide = useSyncExternalStore(subscribe, get, getServer);',
    'const { locale } = useDirection();',
    'return <button onClick={handleClick} />;',
    'return <div onKeyDown={onKeyDown} />;',
    'document.body.style.overflow = "hidden";',
    'if (typeof window.matchMedia === "function") return true;',
    'const handle = setInterval(tick, 1000);',
    'return createPortal(panel, container);',
  ];

  const MUST_NOT_FLAG = [
    'export const cardVariants = variants({ base: CARD_BASE });',
    'export type ButtonProps = { onClick?: MouseEventHandler };',
    'const used = usedByNobody(value);',
    'export function useless(value: string) { return value; }',
    'const url = "https://example.test/not-a-comment";',
    'export const ICON_VIEWBOX = "0 0 24 24";',
    'const map = new Map<string, string>();',
  ];

  it.each(MUST_FLAG)('flags %s', (line) => {
    expect(markersIn(line)).not.toEqual([]);
  });

  it.each(MUST_NOT_FLAG)('leaves %s alone', (line) => {
    expect(markersIn(line)).toEqual([]);
  });

  it('has a fixture for every marker, so one that stopped matching cannot hide', () => {
    const exercised = new Set(
      MUST_FLAG.flatMap((line) =>
        MARKERS.filter((marker) => new RegExp(marker.source).test(stripComments(line))).map(
          (marker) => marker.id,
        ),
      ),
    );
    expect(MARKERS.map((marker) => marker.id).filter((id) => !exercised.has(id))).toEqual([]);
  });

  it('gives every marker a distinct id', () => {
    expect(new Set(MARKERS.map((marker) => marker.id)).size).toBe(MARKERS.length);
  });

  it('reads prose about a hook as prose', () => {
    // Every header in this package names these APIs. A scanner that could not
    // tell a sentence from a call would flag the token modules and be deleted.
    expect(markersIn('/** useState is what this module deliberately avoids. */')).toEqual([]);
    expect(markersIn('// createContext(…) would make this a client module.')).toEqual([]);
  });

  it('rejects a directive that is not the first statement, because a bundler does', () => {
    // A directive below an import is not a directive, it is a string expression,
    // and every bundler ignores it without complaining.
    expect(carriesDirective(`${DIRECTIVE}\nimport x from 'y';`)).toBe(true);
    expect(carriesDirective(`/** header */\n${DIRECTIVE}\n`)).toBe(true);
    expect(carriesDirective(`import x from 'y';\n${DIRECTIVE}\n`)).toBe(false);
  });

  it('holds the directive to one spelling', () => {
    // A bundler accepts the double-quoted form; Prettier would rewrite it on the
    // next format pass, so a file carrying it is a file about to change under
    // someone. Exactness here costs nothing and keeps the diff honest.
    expect(carriesDirective('"use client";\n')).toBe(false);
  });

  it('names a reason for every module exempted from the converse check', () => {
    for (const [file, reason] of CLIENT_WITHOUT_MARKERS) {
      expect(FILES).toContain(file);
      expect(reason.length).toBeGreaterThan(30);
    }
  });
});
