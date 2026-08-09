import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as publicApi from '../index.js';

/**
 * ---------------------------------------------------------------------------
 * The barrel must not drift from the package
 * ---------------------------------------------------------------------------
 * `packages/ui` is consumed as source TypeScript — `main` points straight at
 * `src/index.ts` — so anything this file forgets to re-export does not exist as
 * far as WS-5 and WS-6 are concerned. That failure surfaces as a confusing
 * import error in a different package, days later, and the usual repair is a
 * deep relative import into `@haul/ui/src/components/…` that quietly makes the
 * barrel meaningless.
 *
 * The check reads the barrel's *source* rather than its imported namespace,
 * because half of what this package exports is types. `type` and `interface`
 * are erased before anything runs, so `'MoneyProps' in publicApi` is false for
 * a name that is exported perfectly well — an import-based check would report
 * every type in the package as missing and teach the next person to delete it.
 * ---------------------------------------------------------------------------
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');

/** Modules whose public surface is meant to be reachable by a consumer. */
const PUBLIC_DIRS = ['components', 'tokens', 'lib'] as const;

/**
 * Modules that are public but reached through a `package.json` subpath rather
 * than the main barrel. The exemption is checked rather than asserted: the test
 * below reads package.json and fails if the subpath it names has gone away, so
 * this cannot become a quiet way to drop a module from the API.
 *
 * `native-theme` is here because the web barrel is imported by the Next.js
 * build, and React Native shaped values have no business being pulled into it.
 */
const REACHED_BY_SUBPATH = new Map<string, string>([['tokens/native-theme.ts', './native']]);

function publicModules(): string[] {
  const found: string[] = [];
  for (const dir of PUBLIC_DIRS) {
    const full = path.join(SRC, dir);
    if (!fs.existsSync(full)) continue;
    for (const entry of fs.readdirSync(full)) {
      if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue;
      if (entry === 'index.ts') continue;
      const relative = `${dir}/${entry}`;
      if (REACHED_BY_SUBPATH.has(relative)) continue;
      found.push(relative);
    }
  }
  return found;
}

const DECLARATION =
  /^export\s+(?:declare\s+)?(?:const|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;

/** Names a module declares and exports in its own right. */
function declaredExports(relative: string): string[] {
  const source = fs.readFileSync(path.join(SRC, relative), 'utf8');
  return [
    ...new Set([...source.matchAll(DECLARATION)].map((m) => m[1]).filter(Boolean)),
  ] as string[];
}

/** `'./tokens/index.js'` seen from `'index.ts'` becomes `'tokens/index.ts'`. */
function resolveSpecifier(fromRelative: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.posix.join(path.posix.dirname(fromRelative.replace(/\\/g, '/')), specifier);
  for (const candidate of [base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx')]) {
    if (fs.existsSync(path.join(SRC, candidate))) return candidate;
  }
  return null;
}

/** Every name the barrel makes reachable, following `export *` chains. */
function reachableFromBarrel(entry = 'index.ts', seen = new Set<string>()): Set<string> {
  const names = new Set<string>();
  if (seen.has(entry)) return names;
  seen.add(entry);

  const source = fs.readFileSync(path.join(SRC, entry), 'utf8');

  for (const block of source.matchAll(/export\s*\{([^}]*)\}\s*from\s*'[^']+'/g)) {
    for (const raw of (block[1] ?? '').split(',')) {
      const cleaned = raw.trim().replace(/^type\s+/, '');
      if (!cleaned) continue;
      const parts = cleaned.split(/\s+as\s+/);
      const exposed = (parts[1] ?? parts[0])?.trim();
      if (exposed) names.add(exposed);
    }
  }

  for (const star of source.matchAll(/export\s*\*\s*from\s*'([^']+)'/g)) {
    const target = resolveSpecifier(entry, star[1] ?? '');
    if (!target) continue;
    for (const name of declaredExports(target)) names.add(name);
    for (const name of reachableFromBarrel(target, seen)) names.add(name);
  }

  return names;
}

describe('the public API', () => {
  it('finds the modules and names it means to check', () => {
    // Without this the suite passes vacuously the day the layout moves.
    const modules = publicModules();
    expect(modules.length).toBeGreaterThan(10);
    expect(modules).toContain('components/price-card.tsx');
    expect(reachableFromBarrel().size).toBeGreaterThan(40);
  });

  const reachable = reachableFromBarrel();

  it.each(publicModules())('re-exports everything %s makes public', (relative) => {
    const missing = declaredExports(relative).filter((name) => !reachable.has(name));
    expect(missing, `${relative} exports names the barrel drops: ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  it.each([...REACHED_BY_SUBPATH])(
    'keeps %s reachable through the %s subpath',
    (relative, subpath) => {
      const manifest = JSON.parse(
        fs.readFileSync(path.resolve(SRC, '..', 'package.json'), 'utf8'),
      ) as { exports?: Record<string, string> };
      const target = manifest.exports?.[subpath];
      expect(target, `package.json no longer exports ${subpath}`).toBeDefined();
      expect(target).toBe(`./src/${relative}`);
    },
  );

  it('exposes the signature object and the token set at runtime', () => {
    expect(publicApi.PriceCard).toBeTypeOf('function');
    expect(publicApi.Money).toBeTypeOf('function');
    expect(publicApi.Button).toBeTypeOf('function');
    expect(publicApi.tokens).toBeTypeOf('object');
  });
});
