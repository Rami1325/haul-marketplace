import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ---------------------------------------------------------------------------
 * RTL purity, in the app this time
 * ---------------------------------------------------------------------------
 * `packages/ui/src/__tests__/rtl.test.ts` holds the design system to logical
 * properties. It cannot hold this app to anything — it scans its own package —
 * and the app is where the risk actually is: a screen is written under deadline,
 * in English, in a browser set to English, and a single `pl-4` puts the padding
 * on the wrong side of every Israeli phone while passing review and every render
 * test. The failure is asymmetric, which is exactly why it is worth a scanner
 * rather than a convention.
 *
 * **The rule table below is a copy, and the copy is deliberate.** The
 * alternative is exporting test infrastructure from `@haul/ui`, which would put
 * a scanner in a package whose job is to render, and importing that module here
 * would register the design system's entire suite inside this app's test run.
 * A copy that cannot rot is better than a shared module that distorts both ends:
 * the fixtures below exercise every rule and fail the suite if any regex stops
 * matching, so a rule that quietly broke in transit reads as a broken test
 * rather than as a clean codebase.
 *
 * Two rules exist here that the design system has no way to state:
 *
 *   - **No literal `dir` anywhere.** Direction is derived from the locale by
 *     `directionAttributes`, once, on `<html>`. A hand-written `dir="rtl"` is a
 *     second answer to the question, and it is the one that will not change when
 *     English is selected.
 *   - **The root layout carries both halves.** `directionAttributes` on `<html>`
 *     and `<DirectionProvider>` around the tree are not alternatives: logical
 *     properties resolve against the document, components read the locale from
 *     React context, and shipping one without the other produces a page that is
 *     laid out one way and formatted the other.
 * ---------------------------------------------------------------------------
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SCAN_ROOTS = ['src'] as const;

/** This file's own fixtures are deliberately full of the forms it bans. */
const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
  '__tests__',
  'node_modules',
  '.next',
  '.turbo',
]);

const SCANNABLE = /\.(?:tsx?|mts|mjs|css)$/;

interface Rule {
  /** Stable identity, so a fixture can prove this particular rule still fires. */
  readonly id: string;
  /** What was found, in words a reviewer can act on. */
  readonly name: string;
  /** The logical form to use instead. */
  readonly instead: string;
  readonly source: string;
  /**
   * True when CSS offers no logical equivalent, so an explicitly mirrored
   * `rtl:`/`ltr:` pair on one line is the correct way to write it.
   */
  readonly mirrorable?: true;
}

const RULES: readonly Rule[] = [
  {
    id: 'padding',
    name: 'physical padding utility',
    instead: 'ps-* / pe-* (scroll-ps-* / scroll-pe-* for scroll padding)',
    source: String.raw`(?<!\w)p[lr]-(?:\d+(?:\.\d+)?|px|auto|\[[^\]]*\])`,
  },
  {
    id: 'margin',
    name: 'physical margin utility',
    instead: 'ms-* / me-* (scroll-ms-* / scroll-me-* for scroll margin)',
    source: String.raw`(?<!\w)-?m[lr]-(?:\d+(?:\.\d+)?|px|auto|\[[^\]]*\])`,
  },
  {
    id: 'inset',
    name: 'physical inset utility',
    instead: 'start-* / end-* (inset-x-* when both sides are meant)',
    source: String.raw`(?<!\w)-?(?:left|right)-(?:\d+(?:\.\d+)?(?:\/\d+)?|px|auto|full|\[[^\]]*\])`,
  },
  {
    id: 'text-align-utility',
    name: 'physical text alignment utility',
    instead: 'text-start / text-end',
    source: String.raw`(?<!\w)text-(?:left|right)(?![\w-])`,
  },
  {
    id: 'border-side',
    name: 'physical border side utility',
    instead: 'border-s / border-e',
    source: String.raw`(?<!\w)border-[lr](?![a-z])(?:-[\w./\[\]-]+)?`,
  },
  {
    id: 'radius-side',
    name: 'physical corner radius utility',
    instead: 'rounded-s-* / rounded-e-*',
    source: String.raw`(?<!\w)rounded-[lr](?![a-z])(?:-[\w./\[\]-]+)?`,
  },
  {
    id: 'radius-corner',
    name: 'physical single-corner radius utility',
    instead: 'rounded-ss-* / rounded-se-* / rounded-es-* / rounded-ee-*',
    source: String.raw`(?<!\w)rounded-[tb][lr](?![a-z])(?:-[\w./\[\]-]+)?`,
  },
  {
    id: 'box-side-css',
    name: 'physical CSS box side',
    instead:
      'margin-inline-start / padding-inline-end / border-inline-* / border-start-start-radius',
    source: String.raw`(?<!\w)(?:margin|padding|border)(?:-(?:top|bottom))?-(?:left|right)(?!\w)`,
  },
  {
    id: 'box-side-style',
    name: 'physical CSS box side in a style object',
    instead: 'marginInlineStart / paddingInlineEnd / borderInline* / scrollPaddingInline*',
    source: String.raw`(?:[Mm]argin|[Pp]adding|[Bb]order)(?:Top|Bottom)?(?:Left|Right)(?![a-z])`,
  },
  {
    id: 'inset-css',
    name: 'physical CSS inset',
    instead: 'inset-inline-start / inset-inline-end',
    source: String.raw`(?<![\w-])['"]?(?:left|right)['"]?\s*:`,
  },
  {
    id: 'text-align-css',
    name: 'physical text-align value',
    instead: 'text-align: start / end',
    source: String.raw`text-align\s*:\s*['"]?(?:left|right)`,
  },
  {
    id: 'text-align-style',
    name: 'physical textAlign value',
    instead: "textAlign: 'start' / 'end'",
    source: String.raw`textAlign\s*:\s*[^,;}\n]*['"](?:left|right)['"]`,
  },
  {
    id: 'translate-x',
    name: 'horizontal translate utility',
    instead: 'translate-y-*, or a mirrored rtl:/ltr: pair — a transform does not flip in RTL',
    mirrorable: true,
    source: String.raw`(?<!\w)-?translate-x-(?!0(?![\w.\/\[]))(?:\d+(?:\.\d+)?(?:\/\d+)?|px|full|\[[^\]]*\]|\([^)]*\))`,
  },
  {
    id: 'scale-x-flip',
    name: 'horizontal flip via negative scale',
    instead: 'a mirrored rtl:/ltr: pair, or a glyph drawn the right way round',
    mirrorable: true,
    source: String.raw`(?<!\w)(?:-scale-x-|scale-x-\[\s*-)`,
  },
  {
    id: 'skew',
    name: 'skew utility',
    instead: 'a mirrored rtl:/ltr: pair — skew(θ) mirrors to skew(−θ)',
    mirrorable: true,
    source: String.raw`(?<!\w)-?skew(?:-[xy])?-(?!0(?![\w.\[]))(?:\d+(?:\.\d+)?|\[[^\]]*\])`,
  },
  {
    id: 'rotate-utility',
    name: 'rotation that is not a half turn',
    instead: 'rotate-180 / rotate-x-*, or a mirrored rtl:/ltr: pair',
    mirrorable: true,
    source: String.raw`(?<!\w)-?rotate-(?:y-)?(?!(?:0|180|360)(?![\w.\[]))(?:\d+(?:\.\d+)?|\[[^\]]*\]|\([^)]*\))`,
  },
  {
    id: 'transform-fn',
    name: 'physical horizontal transform function',
    instead: 'translateY / scaleY, or an axis chosen from useDirection() with an EXEMPTIONS entry',
    source: String.raw`(?:translateX|skewX|skewY)\s*\(|(?<![\w-])skew\s*\(|scaleX?\s*\(\s*-|(?<![\w-])translate(?:3d)?\s*\(\s*(?!0(?:px|%|r?em|vw|vh)?\s*[,)])|(?<![\w-])matrix3?d?\s*\(`,
  },
  {
    id: 'rotate-fn',
    name: 'rotation that is not a half turn, in a transform function',
    instead: 'rotate(180deg) / rotateX(…), or an angle chosen from useDirection()',
    source: String.raw`(?<![\w-])rotate(?:[YZ])?\s*\(\s*-?(?!(?:0|180|360)(?:deg|grad|rad|turn)?\s*\))`,
  },
  {
    id: 'transform-property',
    name: 'physical value in an individual transform property',
    instead:
      'a vertical translate, a half turn, a positive scale, or a value chosen from useDirection()',
    source: String.raw`(?<![\w-])translate\s*:\s*['"]?(?=-?[\d.])(?!0(?![\d.]))|(?<![\w-])rotate\s*:\s*['"]?(?=-?[\d.])-?(?!(?:0|180|360)(?:deg|turn|rad|grad)?\s*['"]?\s*(?:[;,}]|$))|(?<![\w-])scale\s*:\s*['"]?-(?=[\d.])`,
  },
  {
    id: 'float',
    name: 'physical float utility',
    instead: 'float-start / float-end',
    source: String.raw`(?<!\w)float-(?:left|right)(?![\w-])`,
  },
  {
    id: 'clear',
    name: 'physical clear utility',
    instead: 'clear-start / clear-end',
    source: String.raw`(?<!\w)clear-(?:left|right)(?![\w-])`,
  },
  {
    id: 'float-css',
    name: 'physical float / clear value',
    instead: 'float: inline-start / clear: inline-end',
    source: String.raw`(?<![\w-])(?:float|clear)\s*:\s*['"]?(?:left|right)(?![\w-])`,
  },
  {
    id: 'origin',
    name: 'physical transform-origin utility',
    instead: 'origin-center / origin-top, or a mirrored rtl:/ltr: pair',
    mirrorable: true,
    source: String.raw`(?<!\w)origin-(?:(?:top|bottom)-)?(?:left|right)(?![\w-])`,
  },
  {
    id: 'origin-css',
    name: 'physical transform-origin value',
    instead: 'transform-origin: center, or a value chosen from useDirection()',
    source: String.raw`transform-origin\s*:\s*[^;{}\n]*(?<![\w-])(?:left|right)(?![\w-])|transformOrigin\s*:\s*['"][^'"\n]*(?<![\w-])(?:left|right)(?![\w-])`,
  },
  {
    id: 'gradient',
    name: 'physical gradient direction',
    instead: 'a vertical gradient (bg-linear-to-b), or a mirrored rtl:/ltr: pair',
    mirrorable: true,
    source: String.raw`(?<!\w)bg-(?:linear|gradient|radial|conic)-to-(?:[tb]?[rl])(?![\w-])|(?<!\w)bg-(?:linear|conic)-(?:-?\d+)(?![\w-])|(?:linear|conic|repeating-linear)-gradient\(\s*to\s+[a-z\s]*?(?<![\w-])(?:left|right)(?![\w-])`,
  },
  {
    id: 'bg-position',
    name: 'physical background-position utility',
    instead: 'bg-center / bg-top / bg-bottom, or a mirrored rtl:/ltr: pair',
    mirrorable: true,
    source: String.raw`(?<!\w)bg-(?:left|right)(?:-(?:top|bottom))?(?![\w-])`,
  },
  {
    id: 'bg-position-css',
    name: 'physical background-position value',
    instead: 'background-position: center, or a value chosen from useDirection()',
    source: String.raw`background-position(?:-[xy])?\s*:\s*[^;{}\n]*(?<![\w-])(?:left|right)(?![\w-])|backgroundPosition[XY]?\s*:\s*['"][^'"\n]*(?<![\w-])(?:left|right)(?![\w-])`,
  },
  {
    id: 'literal-dir',
    name: 'hand-written dir attribute',
    instead: 'directionAttributes(locale) from @haul/ui, or a <DirectionProvider locale={…}>',
    source: String.raw`\bdir\s*=\s*(?:['"]|\{\s*['"])(?:rtl|ltr)`,
  },
];

interface Violation {
  readonly line: number;
  readonly column: number;
  readonly text: string;
  readonly rule: Rule;
}

/** The `md:hover:` chain immediately before a match, if there is one. */
const VARIANT_CHAIN = /(?:[\w-]+:)+$/;

/**
 * Whether a physical utility is written as half of a deliberately mirrored
 * pair. Both halves have to be on the same line, because the point of the hatch
 * is that a reader sees both directions at once.
 */
function isMirroredPair(line: string, index: number): boolean {
  const chain = VARIANT_CHAIN.exec(line.slice(0, index))?.[0] ?? '';
  const guarded = chain.includes('rtl:') || chain.includes('ltr:');
  return guarded && line.includes('rtl:') && line.includes('ltr:');
}

function scan(source: string): Violation[] {
  const found: Violation[] = [];

  source.split(/\r?\n/).forEach((line, index) => {
    for (const rule of RULES) {
      const pattern = new RegExp(rule.source, 'g');
      let match = pattern.exec(line);
      while (match !== null) {
        if (!(rule.mirrorable === true && isMirroredPair(line, match.index))) {
          found.push({ line: index + 1, column: match.index + 1, text: match[0], rule });
        }
        match = pattern.exec(line);
      }
    }
  });

  return found.sort((a, b) => a.line - b.line || a.column - b.column);
}

function report(file: string, violations: readonly Violation[]): string[] {
  return violations.map(
    (v) => `${file}:${v.line}:${v.column}  ${v.text}  ${v.rule.name} — use ${v.rule.instead}`,
  );
}

function sourceFilesUnder(dir: string): string[] {
  const absolute = resolve(APP_ROOT, dir);
  if (!existsSync(absolute)) return [];

  const found: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const child = join(dir, entry).replaceAll('\\', '/');
    if (statSync(resolve(APP_ROOT, child)).isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry)) found.push(...sourceFilesUnder(child));
    } else if (SCANNABLE.test(entry) && !entry.endsWith('.d.ts')) {
      found.push(child);
    }
  }
  return found.sort();
}

const FILES = SCAN_ROOTS.flatMap(sourceFilesUnder);

/** Directories under `src` that a scan is expected to reach, read from disk. */
const SRC_DIRECTORIES = readdirSync(resolve(APP_ROOT, 'src'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !EXCLUDED_DIRECTORIES.has(entry.name))
  .map((entry) => entry.name)
  .sort();

describe('RTL purity', () => {
  it('scans every source directory, so a green run means something', () => {
    // A scanner that finds no files passes forever, and one that finds only the
    // directories somebody remembered to list passes for everything else.
    expect(FILES.length).toBeGreaterThan(0);

    const missed = SRC_DIRECTORIES.filter(
      (name) => !FILES.some((file) => file.startsWith(`src/${name}/`)),
    );
    expect(missed).toEqual([]);
  });

  it('reads the stylesheet and the layout, not only the components', () => {
    expect(FILES).toContain('src/app/globals.css');
    expect(FILES).toContain('src/app/[locale]/layout.tsx');
    expect(FILES).toContain('src/proxy.ts');
  });

  it('finds violations when pointed at a file that has them — this one', () => {
    // Discovery, read, scan, report: the whole chain, over a real file on disk.
    // Without it, a traversal that quietly returned nothing would read as a
    // spotless application.
    const self = 'src/__tests__/rtl.node.test.ts';
    expect(sourceFilesUnder('src/__tests__')).toContain(self);

    const source = readFileSync(resolve(APP_ROOT, self), 'utf8');
    expect(report(self, scan(source)).length).toBeGreaterThan(20);
  });

  it.each(FILES)('%s uses logical properties only', (file) => {
    const source = readFileSync(resolve(APP_ROOT, file), 'utf8');
    expect(report(file, scan(source))).toEqual([]);
  });
});

describe('direction comes from the locale, in both forms', () => {
  const layout = readFileSync(resolve(APP_ROOT, 'src/app/[locale]/layout.tsx'), 'utf8');

  it('puts dir and lang on <html> from directionAttributes', () => {
    // Logical properties resolve against the document. Without this the whole
    // page lays out left-to-right no matter what any React context says.
    expect(layout).toMatch(/<html\s+\{\.\.\.directionAttributes\(locale\)\}/);
  });

  it('also wraps the tree in a DirectionProvider', () => {
    // And components read the locale from context. Neither substitutes for the
    // other; a page with only the attribute formats every amount as Hebrew.
    expect(layout).toContain('<DirectionProvider locale={locale}>');
  });

  it('never writes a direction down by hand', () => {
    const offenders = FILES.flatMap((file) => {
      const source = readFileSync(resolve(APP_ROOT, file), 'utf8');
      return scan(source)
        .filter((violation) => violation.rule.id === 'literal-dir')
        .map((violation) => `${file}:${violation.line}`);
    });
    expect(offenders).toEqual([]);
  });
});

/**
 * The scanner is the thing being trusted, so it is the thing that gets tested,
 * in both directions. A pattern that misses `-mr-2` lets the bug through; a
 * pattern that flags `border-line` — one of this system's own colours — gets the
 * whole test deleted inside a week.
 */
describe('the scanner itself', () => {
  const MUST_FLAG = [
    // Box model.
    '<div className="pl-4" />',
    '<div className="pr-[3px]" />',
    'className={cn("ml-auto")}',
    '<div className="-mr-2" />',
    '<span className="left-0" />',
    '<span className="right-1/2" />',
    '<p className="text-left">',
    '<div className="border-l" />',
    '<div className="rounded-l-lg" />',
    '<div className="rounded-tl-lg" />',
    'style={{ marginLeft: 4 }}',
    'style={{ left: 0 }}',
    "style={{ textAlign: 'left' }}",
    '.card { padding-right: 4px; }',
    '.card { text-align: right; }',

    // Transforms, which never flip on their own.
    '<div className="translate-x-2" />',
    '<div className="-scale-x-100" />',
    '<div className="skew-x-6" />',
    '<div className="rotate-90" />',
    "style={{ transform: 'translateX(4px)' }}",
    "style={{ transform: 'rotate(90deg)' }}",
    '.sheet { translate: -100% 0; }',

    // Flow, origin, gradients, background position.
    '<div className="float-right" />',
    '<div className="clear-left" />',
    '.badge { float: left; }',
    '<div className="origin-left" />',
    '.card { transform-origin: left top; }',
    '<div className="bg-linear-to-r from-route" />',
    '<div className="bg-left-top" />',
    '.hero { background-position: right center; }',

    // The app's own rule.
    '<html dir="rtl" lang="he">',
    '<div dir={"ltr"}>',
  ];

  const MUST_NOT_FLAG = [
    // The logical forms this app is written in.
    '<div className="ps-4 pe-2 ms-auto me-1" />',
    '<div className="start-0 end-2 inset-x-0" />',
    '<p className="text-start text-end">',
    '<div className="border-s border-e-2 border-line-2" />',
    '<div className="rounded-s-lg rounded-e-md rounded-lg" />',
    '<div className="mx-auto flex min-h-dvh flex-col justify-center gap-8 p-6" />',
    '.card { padding-inline-end: 4px; inset-inline-start: 0; float: inline-start; }',

    // Prose and identifiers that merely contain the words.
    '// direction runs right-to-left here, not left-to-right',
    'const copyright = "bright lights, no rightward drift";',
    "const direction = isRtl ? 'rtl' : 'ltr';",

    // Colours and radii of this system, which are not sides.
    '<div className="rounded-md border-2 border-rust" />',
    '<div className="bg-line-2 border-line bg-rust text-hivis" />',

    // Transforms that survive a mirror unchanged.
    '<div className="translate-y-2 rotate-180 scale-x-100" />',
    "style={{ transform: 'translateY(100%)' }}",

    // Direction derived rather than written.
    '<html {...directionAttributes(locale)} suppressHydrationWarning>',
    '<DirectionProvider locale={locale}>',

    // The one hatch: both directions written down together.
    '<div className="rtl:-translate-x-full ltr:translate-x-full" />',
  ];

  it.each(MUST_FLAG)('flags %s', (line) => {
    expect(scan(line)).not.toEqual([]);
  });

  it.each(MUST_NOT_FLAG)('leaves %s alone', (line) => {
    expect(report('fixture', scan(line))).toEqual([]);
  });

  it('has a fixture for every rule, so a rule that stopped matching cannot hide', () => {
    // Without this, a regex broken in the copy from `@haul/ui` reads as a clean
    // codebase: every file passes, and the one thing the suite proves is that
    // nothing was looked for.
    const exercised = new Set(MUST_FLAG.flatMap((line) => scan(line).map((v) => v.rule.id)));
    expect(RULES.map((rule) => rule.id).filter((id) => !exercised.has(id))).toEqual([]);
  });

  it('gives every rule a distinct id', () => {
    expect(new Set(RULES.map((rule) => rule.id)).size).toBe(RULES.length);
  });

  it('points at the exact line and column', () => {
    const source = ['const a = 1;', 'const b = 2;', '<div className="pl-4" />'].join('\n');
    expect(report('src/app/example.tsx', scan(source))).toEqual([
      'src/app/example.tsx:3:17  pl-4  physical padding utility — use ps-* / pe-* (scroll-ps-* / scroll-pe-* for scroll padding)',
    ]);
  });
});
