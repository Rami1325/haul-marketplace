import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ---------------------------------------------------------------------------
 * Two boundaries, asserted against the import graph rather than against habit
 * ---------------------------------------------------------------------------
 * Both are documented in the modules they govern, and a comment is not a
 * mechanism. Each is one careless import away from breaking, and neither breaks
 * loudly.
 *
 * **1. Nothing under `src/server/` may be reachable from a client component.**
 * That directory holds the database connection string, the raw session hash and
 * the draft store. Next would refuse the obvious version of this mistake, but
 * the mistake is rarely obvious: it arrives as a shared helper imported by a
 * client component two hops away, and what ships is a bundle a customer can
 * read.
 *
 * **2. `proxy.ts` may not pull a `@haul/*` package into the proxy bundle.** Its
 * own comment promises it touches no database and no pricing engine, and the
 * way that promise breaks is a value import of `@haul/contracts` for something
 * as small as a step id — the barrel reaches `@haul/config`, which parses a
 * 169-item catalog through Zod at import time, a side effect no tree-shaker may
 * drop. `import type` is erased and is therefore fine, which is exactly the
 * distinction this test has to make and a reviewer usually does not.
 *
 * "Proxy bundle", not "edge bundle": Next 16 runs a proxy file on Node. What is
 * being protected is therefore per-navigation work in a server process rather
 * than an edge size limit — the same rule for a different reason, and the
 * reason is worth stating correctly because the wrong one suggests the bundler
 * would catch a violation. It would not. This test is the only thing that does.
 *
 * The graph is walked transitively, because one hop is the case that never
 * happens.
 * ---------------------------------------------------------------------------
 */

const SRC = resolve(fileURLToPath(new URL('..', import.meta.url)));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const ALL_FILES = sourceFiles(SRC);

interface Edge {
  readonly specifier: string;
  readonly typeOnly: boolean;
}

/**
 * Every module specifier a file imports, and whether the import is type-only.
 *
 * Regex rather than a parser, and honestly so: it reads `import`, `export … from`
 * and dynamic `import()`, which is every form this app uses. What it cannot see
 * — a specifier built at runtime — is not something any module here does, and a
 * test that quietly stopped covering a file would be worse than this one being
 * simple.
 */
function edgesOf(file: string): Edge[] {
  const source = readFileSync(file, 'utf8');
  const pattern =
    /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

  const edges: Edge[] = [];
  for (const match of source.matchAll(pattern)) {
    const specifier = match[2] ?? match[3];
    if (specifier === undefined) continue;
    // `import { type Foo }` still emits a runtime import of the module, so only
    // the statement-level `import type` counts as erased.
    edges.push({ specifier, typeOnly: match[1] !== undefined });
  }
  return edges;
}

/** A specifier resolved to a file in this app, or null when it leaves it. */
function resolveLocal(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(from), specifier);
  else return null;

  // Every relative import in this repo carries `.js`; the file on disk is `.ts`.
  const stripped = base.replace(/\.js$/, '');
  for (const candidate of [`${stripped}.ts`, `${stripped}.tsx`, join(stripped, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* not this one */
    }
  }
  return null;
}

/** Leading comments and blank lines removed, so a directive is at index 0. */
function isClientModule(file: string): boolean {
  const source = readFileSync(file, 'utf8')
    // Escaped rather than literal: a raw U+FEFF in a source file is exactly the
    // invisible character the lint rule against irregular whitespace exists for.
    .replace(/^\uFEFF/, '')
    .replace(/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, '');
  return /^['"]use client['"]/.test(source);
}

/**
 * Every file reachable from `entry`, including itself.
 *
 * `crossTypeOnly: false` walks value imports only — which is what the bundler
 * does, and the whole point of the second assertion below.
 */
function reachableFrom(entry: string, crossTypeOnly: boolean): Set<string> {
  const seen = new Set<string>([entry]);
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    for (const edge of edgesOf(file)) {
      if (!crossTypeOnly && edge.typeOnly) continue;
      const target = resolveLocal(file, edge.specifier);
      if (target === null || seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return seen;
}

/** External specifiers reached from `entry` through value imports only. */
function externalsFrom(entry: string): Set<string> {
  const externals = new Set<string>();
  for (const file of reachableFrom(entry, false)) {
    for (const edge of edgesOf(file)) {
      if (edge.typeOnly) continue;
      if (resolveLocal(file, edge.specifier) === null) externals.add(edge.specifier);
    }
  }
  return externals;
}

const show = (file: string) => relative(SRC, file).replaceAll('\\', '/');

describe('the client boundary', () => {
  const clientModules = ALL_FILES.filter(isClientModule);

  it('finds the client components it is supposed to be checking', () => {
    // Without this, the suite passes triumphantly on the day the directive
    // detection breaks and there are no client modules to walk at all.
    expect(clientModules.map(show)).toContain('i18n/provider.tsx');
  });

  it('keeps every server module out of reach of every client component', () => {
    for (const entry of clientModules) {
      const server = [...reachableFrom(entry, true)]
        .filter((file) => show(file).startsWith('server/'))
        .map(show);

      expect(server, `${show(entry)} can reach ${server.join(', ')}`).toEqual([]);
    }
  });

  it('has server modules to keep out of reach', () => {
    expect(ALL_FILES.filter((file) => show(file).startsWith('server/')).length).toBeGreaterThan(0);
  });
});

describe('the proxy boundary', () => {
  const PROXY = join(SRC, 'proxy.ts');

  /**
   * The one workspace package the proxy is allowed to carry.
   *
   * `i18n/locales.ts` re-exports `LocaleSchema`, `DEFAULT_LOCALE` and
   * `SUPPORTED_LOCALES` from `@haul/types` rather than restating them, on the
   * grounds that the guard deciding what a locale *is* should be the one that
   * defines it — and that is a value import, so the package is in the bundle.
   *
   * It is affordable because of where it sits: the bottom of the dependency
   * graph, importing nothing but Zod, with no data files behind it. Every other
   * `@haul/*` fails this test, and `@haul/config` is the reason the test
   * exists — it parses a 169-item catalog at import time, and reaching it costs
   * the proxy that work on every navigation on the site.
   */
  const ALLOWED_IN_THE_PROXY = new Set(['@haul/types']);

  it('keeps the rest of the domain out of the proxy bundle', () => {
    const haul = [...externalsFrom(PROXY)].filter(
      (specifier) => specifier.startsWith('@haul/') && !ALLOWED_IN_THE_PROXY.has(specifier),
    );
    expect(haul, `proxy.ts pulls ${haul.join(', ')} into the proxy bundle`).toEqual([]);
  });

  it('still reaches the modules it is supposed to', () => {
    // The assertion above would also pass if the proxy imported nothing at all,
    // or if the resolver quietly stopped following `@/` specifiers.
    const reached = [...reachableFrom(PROXY, false)].map(show);
    expect(reached).toContain('booking/paths.ts');
    expect(reached).toContain('booking/session.ts');
    expect(reached).toContain('i18n/locales.ts');
  });

  it('reads a type-only import as erased and a value import as not', () => {
    // The distinction the first assertion rests on, checked against the parser
    // rather than assumed of it.
    const edges = edgesOf(join(SRC, 'booking', 'paths.ts'));
    const contracts = edges.find((edge) => edge.specifier === '@haul/contracts');
    expect(contracts?.typeOnly).toBe(true);

    const session = edgesOf(join(SRC, 'server', 'draft-store.ts')).find(
      (edge) => edge.specifier === '@haul/db',
    );
    expect(session?.typeOnly).toBe(false);
  });
});
