import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * RTL purity, enforced by reading the source rather than by asking people to
 * remember. Hebrew is this product's default, not a mode it can be switched
 * into, and a single physical utility is enough to break a screen for the
 * majority of its users — a `pl-4` looks correct in review, passes every render
 * test, and puts the padding on the wrong side of every Israeli phone.
 *
 * The failure is asymmetric, which is why it is worth a test rather than a
 * lint rule nobody installed: the person who writes the physical form is
 * usually working in English, in a browser they have set to English, and will
 * never see what they shipped.
 *
 * ## Why this scanner covers more than padding and margins
 *
 * A guard rail with holes in it is worse than no guard rail, because everyone
 * downstream stops looking. This one had three, and each of them let a whole
 * family of physical direction through while the suite stayed green.
 *
 * **Transforms do not mirror.** `direction: rtl` flips the box model and the
 * text; it does nothing to `transform`. A side sheet written as
 * `-translate-x-full` slides in from the same physical edge in both languages,
 * and a chevron on `rotate-90` points the same physical way — so a "back"
 * arrow becomes a "forward" arrow in Hebrew. The maths says exactly which of
 * these are safe: mirroring conjugates a rotation by θ into one by −θ, so only
 * a half turn (and zero) survives untouched, and it leaves rotation about the
 * X axis alone entirely. `translate-y-*`, `rotate-180`, `rotate-x-*` and
 * positive `scale-x-*` are therefore fine; everything else on the horizontal
 * axis is flagged.
 *
 * **Flow, origin, gradients and background position are physical too.** None
 * of `float`, `transform-origin`, `linear-gradient(to right, …)` or
 * `background-position` follows the writing direction, and each one is a
 * plausible thing to reach for — a `float-right` badge, a `bg-linear-to-r`
 * fade on a horizontally scrolling item row — while feeling like layout rather
 * than like a hard-coded side.
 *
 * **The scan used to stop at two directories.** `src/tokens/native-theme.ts`
 * is the only module that feeds React Native, where `marginLeft` genuinely
 * does not flip and `marginStart` is required, and it was never read.
 * `src/styles/theme.css` — the stylesheet every app actually ships — was never
 * read either. Roots are now derived from the filesystem rather than listed,
 * so a new directory is scanned the day it appears instead of the day someone
 * remembers this file exists.
 *
 * ## The escape hatches, and why they are shaped the way they are
 *
 * Some properties have no logical form at all. CSS gives `transform-origin`,
 * `background-position` and gradient directions physical keywords and nothing
 * else. For those, the correct answer is a deliberately mirrored pair —
 * `rtl:origin-right ltr:origin-left` — so both directions are written down
 * together and neither can drift. A match is forgiven only when it carries an
 * `rtl:`/`ltr:` variant *and* its opposite appears on the same line; a lone
 * `rtl:` half-pair is still a bug. Families that do have a logical form
 * (padding, margin, inset, alignment, borders, radii, float, clear) get no
 * such hatch — write `ps-4`.
 *
 * Anything else genuinely unavoidable goes in `EXEMPTIONS` below, one entry per
 * occurrence, naming the file and the reason. A blanket whitelist of a whole
 * utility family is what let `translate-x-*` through for the life of this
 * package, so there is no mechanism here for granting one.
 *
 * ## What this cannot see, stated rather than implied
 *
 * A text scanner cannot read the *shape* of an icon. An SVG whose path data
 * draws an arrow has a direction that no regex will find, so a `transform`
 * attribute is checked and the geometry is not. The package's answer is that
 * icons are drawn symmetric (the close cross, the check, the warning triangle)
 * and a directional glyph gets a mirrored twin chosen by `useDirection()`,
 * never a `scale-x-[-1]`.
 *
 * ## Why the fixtures are half of this file
 *
 * The scanner is the thing being trusted, so it is the thing that gets tested,
 * in both directions. A pattern that misses `-mr-2` lets the bug through; a
 * pattern that flags `border-line` — one of this system's own colours — gets
 * the whole test deleted inside a week. `right` also lives inside `copyright`
 * and `bright`, "right-to-left" is prose we want to be able to write, and
 * `[margin-inline-start:2px]` is exactly the escape a logical layout is
 * supposed to use. Every rule therefore has to be exercised by a fixture, and
 * a rule that quietly stops matching fails the suite rather than reading as a
 * clean codebase.
 */

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Everything that can put a physical direction into the product: the components
 * and helpers that emit class names, the tokens that feed React Native, the
 * generator that writes the stylesheet, and the stylesheet itself.
 */
const SCAN_ROOTS = ['src', 'scripts'] as const;

/** This file's own fixtures are deliberately full of the forms it bans. */
const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
  '__tests__',
  'node_modules',
  'dist',
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
];

/**
 * Per-occurrence forgiveness for a physical form that is genuinely the honest
 * one. Empty on purpose: nothing in this package needs it today. An entry has
 * to name a scanned file and give a reason, and an entry that stops matching
 * fails the suite — a stale exemption is how a blanket whitelist gets started.
 */
interface Exemption {
  readonly file: string;
  /** The exact text the scanner reports, e.g. `translateX(`. */
  readonly text: string;
  /** Why the physical form is correct here and the logical one is not. */
  readonly reason: string;
}

const EXEMPTIONS: readonly Exemption[] = [];

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
 * pair. Both halves have to be on the same line, because the point of the
 * hatch is that a reader sees both directions at once — a `rtl:` sitting alone
 * is the same bug with extra steps.
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

function isExempt(file: string, violation: Violation): boolean {
  return EXEMPTIONS.some((e) => e.file === file && e.text === violation.text);
}

/** `src/components/money.tsx:42:18  pl-4  physical padding utility — use ps-* / pe-*` */
function report(file: string, violations: readonly Violation[]): string[] {
  return violations
    .filter((v) => !isExempt(file, v))
    .map((v) => `${file}:${v.line}:${v.column}  ${v.text}  ${v.rule.name} — use ${v.rule.instead}`);
}

function sourceFilesUnder(dir: string): string[] {
  const absolute = resolve(PACKAGE_ROOT, dir);
  if (!existsSync(absolute)) return [];

  const found: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const child = join(dir, entry).replaceAll('\\', '/');
    if (statSync(resolve(PACKAGE_ROOT, child)).isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry)) found.push(...sourceFilesUnder(child));
    } else if (SCANNABLE.test(entry) && !entry.endsWith('.d.ts')) {
      found.push(child);
    }
  }
  return found.sort();
}

const FILES = SCAN_ROOTS.flatMap(sourceFilesUnder);

/** Directories under `src` that a scan is expected to reach, read from disk. */
const SRC_DIRECTORIES = readdirSync(resolve(PACKAGE_ROOT, 'src'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !EXCLUDED_DIRECTORIES.has(entry.name))
  .map((entry) => entry.name)
  .sort();

describe('RTL purity', () => {
  it('scans every source directory, so a green run means something', () => {
    // A scanner that finds no files passes forever, and one that finds only the
    // directories somebody remembered to list passes for everything else. Both
    // have happened here: `src/tokens` and `src/styles` went unread for the
    // life of the package while this suite reported a clean codebase.
    expect(FILES.length).toBeGreaterThan(0);

    const missed = SRC_DIRECTORIES.filter(
      (name) => !FILES.some((file) => file.startsWith(`src/${name}/`)),
    );
    expect(missed).toEqual([]);
  });

  it('reaches the files the old scan could not see', () => {
    expect(FILES).toContain('src/styles/theme.css');
    expect(FILES).toContain('src/tokens/native-theme.ts');
    expect(FILES).toContain('scripts/build-theme-css.mts');
  });

  it('reads real content, not empty files', () => {
    const characters = FILES.reduce(
      (total, file) => total + readFileSync(resolve(PACKAGE_ROOT, file), 'utf8').length,
      0,
    );
    expect(characters).toBeGreaterThan(50_000);
  });

  it('finds violations when pointed at a file that has them — this one', () => {
    // Discovery, read, scan, report: the whole chain, over a real file on disk
    // rather than over a string literal. Without it, a traversal that quietly
    // returned nothing, an extension filter that matched nothing, or a `report`
    // that swallowed everything would all read as a spotless package.
    const self = 'src/__tests__/rtl.test.ts';
    expect(sourceFilesUnder('src/__tests__')).toContain(self);

    const source = readFileSync(resolve(PACKAGE_ROOT, self), 'utf8');
    expect(report(self, scan(source)).length).toBeGreaterThan(20);
  });

  it.each(FILES)('%s uses logical properties only', (file) => {
    const source = readFileSync(resolve(PACKAGE_ROOT, file), 'utf8');
    expect(report(file, scan(source))).toEqual([]);
  });
});

/**
 * The scanner is the thing being trusted, so it is the thing that gets tested.
 * Both directions matter equally: a pattern that misses `-mr-2` lets the bug
 * through, and a pattern that flags `border-line` gets the whole test deleted.
 */
describe('the scanner itself', () => {
  const MUST_FLAG = [
    // Box model.
    '<div className="pl-4" />',
    '<div className="pr-[3px]" />',
    'className={cn("ml-auto")}',
    '<div className="-mr-2" />',
    '<div className="scroll-pl-4" />',
    '<span className="left-0" />',
    '<span className="right-1/2" />',
    '<p className="text-left">',
    '<p className="text-right">',
    '<div className="border-l" />',
    '<div className="border-r-2 border-line" />',
    '<div className="rounded-l-lg" />',
    '<div className="rounded-r" />',
    '<div className="rounded-tl-lg" />',
    '<div className="rounded-br" />',
    '<div className="md:pl-2" />',
    '<div className="hover:mr-1" />',
    'style={{ marginLeft: 4 }}',
    'style={{ scrollPaddingLeft: 8 }}',
    'style={{ borderTopRightRadius: 4 }}',
    'style={{ left: 0 }}',
    "const fixed = { 'right': 0 };",
    "style={{ textAlign: 'left' }}",
    "style={{ textAlign: isRtl ? 'right' : 'left' }}",
    '.card { padding-right: 4px; }',
    '.card { border-left-width: 1px; }',
    '.tile { border-top-left-radius: 4px; }',
    '.card { text-align: right; }',

    // Transforms, which never flip on their own.
    '<div className="translate-x-2" />',
    '<div className="-translate-x-full" />',
    '<div className="md:translate-x-[3px]" />',
    '<div className="-scale-x-100" />',
    '<div className="scale-x-[-1]" />',
    '<div className="skew-x-6" />',
    '<div className="rotate-90" />',
    '<div className="-rotate-45" />',
    '<div className="rotate-y-12" />',
    "style={{ transform: 'translateX(4px)' }}",
    "style={{ transform: 'translate(8px, 0)' }}",
    '<path transform="scale(-1 1)" />',
    "style={{ transform: 'rotate(90deg)' }}",
    '<g transform="rotate(45 8 8)" />',
    '.sheet { translate: -100% 0; }',
    "style={{ rotate: '90deg' }}",
    '.mirror { scale: -1 1; }',

    // Flow, origin, gradients, background position.
    '<div className="float-right" />',
    '<div className="clear-left" />',
    '.badge { float: left; }',
    '<div className="origin-left" />',
    '<div className="origin-bottom-right" />',
    '.card { transform-origin: left top; }',
    "style={{ transformOrigin: 'right center' }}",
    '<div className="bg-linear-to-r from-route" />',
    '<div className="bg-gradient-to-bl" />',
    '.fade { background: linear-gradient(to right, transparent, black); }',
    '<div className="bg-left-top" />',
    '<div className="bg-right" />',
    '.hero { background-position: right center; }',
    "style={{ backgroundPosition: 'left' }}",
  ];

  const MUST_NOT_FLAG = [
    // The logical forms this package is written in.
    '<div className="ps-4 pe-2 ms-auto me-1" />',
    '<div className="start-0 end-2 inset-x-0" />',
    '<p className="text-start text-end">',
    '<div className="border-s border-e-2 border-line-2" />',
    '<div className="rounded-s-lg rounded-e-md rounded-lg" />',
    '<div className="rounded-ss-lg rounded-ee-md rounded-t-lg" />',
    '<div className="[margin-inline-start:2px]" />',
    '<div className="scroll-ps-4 scroll-me-2 snap-start snap-end" />',
    '<div className="float-start clear-end" />',
    '.card { padding-inline-end: 4px; inset-inline-start: 0; float: inline-start; }',

    // Prose and identifiers that merely contain the words.
    '// direction runs right-to-left here, not left-to-right',
    'const copyright = "bright lights, no rightward drift";',
    'const parsed = "xml-2";',
    "const direction = isRtl ? 'rtl' : 'ltr';",
    'const translation = translateBetween(from, to);',

    // Colours and radii of this system, which are not sides.
    '<div className="rounded-md border-2 border-rust" />',
    '<div className="bg-line-2 border-line bg-rust text-hivis" />',

    // Transforms that survive a mirror unchanged.
    '<div className="translate-y-2 -translate-y-full translate-x-0" />',
    '<div className="rotate-180 -rotate-180 rotate-x-45" />',
    '<div className="scale-x-100 -scale-y-100 skew-x-0" />',
    "style={{ transform: 'translateY(100%)' }}",
    "style={{ transform: 'translate(0, 4px)' }}",
    "style={{ transform: 'rotate(180deg)' }}",
    '.sheet { translate: 0 100%; }',
    "style={{ rotate: '180deg' }}",
    '.zoom { scale: 1.5; }',
    '<div translate="no" className="tabular" />',
    "const passthrough = { translate: 'no' };",

    // Directions that are not sides, and the vertical gradient.
    '<div className="origin-center origin-top" />',
    '<div className="bg-linear-to-b from-paper to-card bg-center bg-top" />',

    // The one hatch: both directions written down together.
    '<div className="rtl:-translate-x-full ltr:translate-x-full" />',
    '<div className="rtl:origin-right ltr:origin-left" />',
  ];

  it.each(MUST_FLAG)('flags %s', (line) => {
    expect(scan(line)).not.toEqual([]);
  });

  it.each(MUST_NOT_FLAG)('leaves %s alone', (line) => {
    expect(report('fixture', scan(line))).toEqual([]);
  });

  it('has a fixture for every rule, so a rule that stopped matching cannot hide', () => {
    // Without this, a regex broken by a typo reads as a clean codebase: every
    // file passes, and the one thing the suite proves is that nothing was
    // looked for.
    const exercised = new Set(MUST_FLAG.flatMap((line) => scan(line).map((v) => v.rule.id)));
    expect(RULES.map((rule) => rule.id).filter((id) => !exercised.has(id))).toEqual([]);
  });

  it('gives every rule a distinct id', () => {
    expect(new Set(RULES.map((rule) => rule.id)).size).toBe(RULES.length);
  });

  it('half of a mirrored pair is still a violation', () => {
    expect(scan('<div className="rtl:-translate-x-full" />')).not.toEqual([]);
    expect(scan('<div className="ltr:origin-left" />')).not.toEqual([]);
  });

  it('offers no hatch for a family that has a logical form', () => {
    expect(scan('<div className="rtl:pl-4 ltr:pr-4" />')).toHaveLength(2);
  });

  it('points at the exact line and column', () => {
    const source = ['const a = 1;', 'const b = 2;', '<div className="pl-4" />'].join('\n');
    expect(report('src/components/example.tsx', scan(source))).toEqual([
      'src/components/example.tsx:3:17  pl-4  physical padding utility — use ps-* / pe-* (scroll-ps-* / scroll-pe-* for scroll padding)',
    ]);
  });

  it('reports every violation on a line, not just the first', () => {
    expect(scan('<div className="pl-4 mr-2 text-right" />')).toHaveLength(3);
  });
});

describe('the exemption list', () => {
  it('names a scanned file and a reason for every entry', () => {
    for (const exemption of EXEMPTIONS) {
      expect(FILES).toContain(exemption.file);
      expect(exemption.reason.length).toBeGreaterThan(30);
    }
  });

  it('carries no entry that has stopped matching', () => {
    // A stale exemption is a blanket whitelist that nobody has noticed yet.
    const stale = EXEMPTIONS.filter((exemption) => {
      const source = readFileSync(resolve(PACKAGE_ROOT, exemption.file), 'utf8');
      return !scan(source).some((violation) => violation.text === exemption.text);
    });
    expect(stale).toEqual([]);
  });
});
