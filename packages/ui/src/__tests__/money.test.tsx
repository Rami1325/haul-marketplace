import { agorot, formatILS, type Agorot } from '@haul/types';
import { cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { DirectionProvider } from '../components/direction.js';
import { MONEY_CLASS, Money, moneyVariants } from '../components/money.js';
import { fontSizeRem, moneyFontFamily, tabularNumerals, typefaceFacts } from '../tokens/type.js';
import { cssFor } from './helpers/stylesheet.js';

/**
 * Money is the component the whole product is judged on, so it is tested at
 * three levels: that it renders exactly what `formatILS` produced, that the
 * string it renders survives the Unicode bidirectional algorithm intact, and
 * that the size it renders at is a number a browser would actually compute.
 *
 * The bidi half is the reason this file is long. "The shekel sign is on the
 * far side of the number" is not something a DOM assertion can check — jsdom
 * does no layout, and even a real browser would only tell you about the browser
 * you ran. Bidi reordering is a specified, deterministic function of the
 * characters, so it is computed here and asserted, in the same spirit as the
 * pricing engine's determinism tests and the ledger's balance check.
 *
 * The size half is there for the same reason and it is answered the same way.
 * A class name proves nothing — a suite of green assertions about `text-step-4`
 * would sit quite happily on top of a headline that overflows its card — so the
 * class is compiled against the real `theme.css` and the resulting `clamp()` is
 * resolved by hand at a root font size and a viewport chosen to be the case
 * that used to break.
 */

afterEach(cleanup);

// --- a reduced Unicode bidirectional algorithm --------------------------------

/**
 * UAX #9, restricted to the character classes a formatted ILS amount and the
 * Hebrew prose around it can actually contain: strong L and R, European
 * numbers, and the separators and terminators between them. No Arabic classes,
 * no explicit embedding codes, no bracket pairing — none of which appear here,
 * and each of which would be dead code nobody could review.
 */
type BidiClass = 'L' | 'R' | 'EN' | 'ES' | 'ET' | 'CS' | 'WS' | 'ON';

/** Left-to-right mark. ICU inserts it to protect a leading minus sign. */
const LRM = '‎';
/** Right-to-left mark. ICU inserts it around a Hebrew-formatted amount. */
const RLM = '‏';
const NBSP = ' ';

function bidiClass(ch: string): BidiClass {
  if (ch === LRM) return 'L';
  if (ch === RLM) return 'R';
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x0590 && code <= 0x05ff) return 'R';
  if (code >= 0x30 && code <= 0x39) return 'EN';
  if (ch === '+' || ch === '-' || ch === '−') return 'ES';
  if (ch === '₪' || ch === '$' || ch === '%' || ch === '#') return 'ET';
  if (ch === ',' || ch === '.' || ch === ':' || ch === NBSP || ch === '/') return 'CS';
  if (ch === ' ' || ch === '\t') return 'WS';
  if (/[A-Za-z]/.test(ch)) return 'L';
  return 'ON';
}

/** Rules P2–P3, which is also what `dir="auto"` and `<bdi>` do. */
function paragraphLevel(text: string): 0 | 1 {
  for (const ch of text) {
    const cls = bidiClass(ch);
    if (cls === 'L') return 0;
    if (cls === 'R') return 1;
  }
  return 0;
}

function resolveLevels(text: string, base: 0 | 1): number[] {
  const cls = [...text].map(bidiClass);
  const outer: BidiClass = base === 1 ? 'R' : 'L';

  // W4 — a separator between two European numbers joins them.
  for (let i = 1; i < cls.length - 1; i += 1) {
    if ((cls[i] === 'ES' || cls[i] === 'CS') && cls[i - 1] === 'EN' && cls[i + 1] === 'EN') {
      cls[i] = 'EN';
    }
  }

  // W5 — a run of terminators touching a number becomes part of the number.
  for (let i = 0; i < cls.length; i += 1) {
    if (cls[i] !== 'ET') continue;
    let end = i;
    while (end + 1 < cls.length && cls[end + 1] === 'ET') end += 1;
    const before = i > 0 ? cls[i - 1] : outer;
    const after = end + 1 < cls.length ? cls[end + 1] : outer;
    if (before === 'EN' || after === 'EN') {
      for (let j = i; j <= end; j += 1) cls[j] = 'EN';
    }
    i = end;
  }

  // W6 — everything else weak becomes neutral.
  for (let i = 0; i < cls.length; i += 1) {
    if (cls[i] === 'ET' || cls[i] === 'ES' || cls[i] === 'CS') cls[i] = 'ON';
  }

  // W7 — a number after Latin text is Latin text.
  let lastStrong: BidiClass = outer;
  for (let i = 0; i < cls.length; i += 1) {
    const current = cls[i];
    if (current === 'L' || current === 'R') lastStrong = current;
    else if (current === 'EN' && lastStrong === 'L') cls[i] = 'L';
  }

  // N1/N2 — neutrals take the surrounding direction when it agrees, otherwise
  // the paragraph's. Numbers count as right-to-left for this purpose.
  const isNeutral = (cls_: BidiClass | undefined): boolean => cls_ === 'WS' || cls_ === 'ON';
  const asStrong = (cls_: BidiClass | undefined): BidiClass =>
    cls_ === 'R' || cls_ === 'EN' ? 'R' : 'L';

  for (let i = 0; i < cls.length; i += 1) {
    if (!isNeutral(cls[i])) continue;
    let end = i;
    while (end + 1 < cls.length && isNeutral(cls[end + 1])) end += 1;
    const before = i > 0 ? asStrong(cls[i - 1]) : outer;
    const after = end + 1 < cls.length ? asStrong(cls[end + 1]) : outer;
    const resolved = before === after ? before : outer;
    for (let j = i; j <= end; j += 1) cls[j] = resolved;
    i = end;
  }

  // I1/I2 — implicit levels.
  return cls.map((c) => {
    if (base === 0) return c === 'R' ? 1 : c === 'EN' ? 2 : 0;
    return c === 'R' ? 1 : 2;
  });
}

/** L2 — reverse contiguous runs from the deepest level down to the first odd one. */
function reorder(text: string, base: 0 | 1): string[] {
  const chars = [...text];
  const levels = resolveLevels(text, base);
  const order = chars.map((_, index) => index);
  const levelAt = (position: number): number => levels[order[position] ?? 0] ?? 0;

  const deepest = levels.length === 0 ? 0 : Math.max(...levels);
  for (let level = deepest; level >= 1; level -= 1) {
    let i = 0;
    while (i < order.length) {
      if (levelAt(i) < level) {
        i += 1;
        continue;
      }
      let end = i;
      while (end + 1 < order.length && levelAt(end + 1) >= level) end += 1;
      order.splice(i, end - i + 1, ...order.slice(i, end + 1).reverse());
      i = end + 1;
    }
  }

  return order.map((index) => chars[index] ?? '');
}

/**
 * What a reader sees, in screen order, with the invisible marks dropped and the
 * non-breaking space normalised so an expectation reads like a price tag.
 */
function displayed(text: string, base: 0 | 1): string {
  return reorder(text, base).join('').replaceAll(LRM, '').replaceAll(RLM, '').replaceAll(NBSP, ' ');
}

/** What `<bdi>` gives you: its own paragraph, direction from its own content. */
function isolated(text: string): string {
  return displayed(text, paragraphLevel(text));
}

/** The same amount dropped straight into Hebrew prose, with nothing protecting it. */
function inHebrewProse(text: string): string {
  return displayed(`שלום ${text} עולם`, 1);
}

// --- rendering helpers --------------------------------------------------------

interface MoneyParts {
  readonly root: HTMLElement;
  readonly amount: HTMLElement;
  readonly spoken: HTMLElement | null;
}

function renderMoney(ui: ReactElement): MoneyParts {
  const { container } = render(ui);
  const amount = container.querySelector('bdi');
  if (!(amount instanceof HTMLElement)) {
    throw new Error('Money must render its amount inside a <bdi>');
  }
  const root = amount.parentElement;
  if (!(root instanceof HTMLElement)) throw new Error('Money must render a root element');
  const spoken = root.querySelector('.sr-only');
  return { root, amount, spoken: spoken instanceof HTMLElement ? spoken : null };
}

const AMOUNTS: readonly Agorot[] = [
  agorot(0),
  agorot(1),
  agorot(99),
  agorot(100),
  agorot(24800),
  agorot(123450),
  agorot(-1),
  agorot(-5000),
  agorot(-123450),
];

/** Amounts carrying agorot, which is the whole of the whole-shekel question. */
const WITH_AGOROT: readonly Agorot[] = [
  agorot(1),
  agorot(99),
  agorot(24801),
  agorot(24850),
  agorot(24899),
  agorot(-24850),
];

/** Amounts that are already round, where hiding the decimals loses nothing. */
const WHOLE_SHEKELS: readonly Agorot[] = [agorot(0), agorot(100), agorot(24800), agorot(-5000)];

// --- reading the compiled stylesheet ------------------------------------------

/** Characters CSS requires escaped when a class name becomes a selector. */
const NEEDS_ESCAPE = /[[\]().:!/%,#'"+*>~^$|=]/g;
const asSelector = (className: string): string =>
  className.replace(NEEDS_ESCAPE, (ch) => '\\' + ch);

/**
 * The declarations inside one class's own rule, compiled against the real
 * `theme.css`. Scoped to the rule rather than searched for across the sheet:
 * Tailwind's preflight declares `font-size` on several elements, and an
 * unscoped match reads a reset and concludes the utility exists.
 */
function declarationsFor(className: string): string {
  const css = cssFor([className]);
  const start = css.indexOf(`.${asSelector(className)} {`);
  if (start === -1) throw new Error(`no CSS rule compiled for .${className}`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

/** The one class in a size variant that carries the given utility prefix. */
function classFrom(size: 'total' | 'subtotal' | 'line', prefix: string): string {
  const found = moneyVariants({ size })
    .split(/\s+/)
    .find((token) => token.startsWith(prefix));
  if (found === undefined) throw new Error(`Money size="${size}" renders no ${prefix}* class`);
  return found;
}

/** The three arguments of a `clamp()`, split at the top level. */
function clampArguments(declaration: string): readonly string[] {
  const open = declaration.indexOf('clamp(');
  if (open === -1) throw new Error(`not a clamp: ${declaration}`);

  const args: string[] = [];
  let current = '';
  let depth = 0;
  for (let i = open + 'clamp('.length; i < declaration.length; i += 1) {
    const char = declaration[i];
    if (char === ')' && depth === 0) break;
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  args.push(current.trim());
  if (args.length !== 3) throw new Error(`clamp() takes three arguments: ${declaration}`);
  return args;
}

/**
 * One `clamp()` argument in CSS pixels, for a given root font size and viewport
 * width. `cqi` falls back to the small viewport size while no ancestor declares
 * a container, which is exactly what the Price Card does today.
 */
function toPx(argument: string, rootPx: number, viewportPx: number): number {
  const token = /^var\(--text-(step-\d)\)$/.exec(argument);
  if (token?.[1] === 'step-4') return fontSizeRem['step-4'] * rootPx;

  const rem = /^([\d.]+)rem$/.exec(argument);
  if (rem?.[1] !== undefined) return Number(rem[1]) * rootPx;

  const container = /^([\d.]+)cqi$/.exec(argument);
  if (container?.[1] !== undefined) return (Number(container[1]) / 100) * viewportPx;

  throw new Error(`money.test cannot resolve the clamp argument "${argument}"`);
}

// --- the tests ----------------------------------------------------------------

describe('formatting is delegated, never reimplemented', () => {
  it.each(AMOUNTS)('renders %i agorot exactly as formatILS does, in Hebrew', (amount) => {
    const { amount: node } = renderMoney(<Money amount={amount} />);
    expect(node.textContent).toBe(formatILS(amount, 'he'));
  });

  it.each(AMOUNTS)('renders %i agorot exactly as formatILS does, in English', (amount) => {
    const { amount: node } = renderMoney(<Money amount={amount} locale="en" />);
    expect(node.textContent).toBe(formatILS(amount, 'en'));
  });

  it('keeps the bidi marks ICU put there, character for character', () => {
    // These are invisible, so nothing about deleting them shows up in review or
    // in a screenshot. They are the reason the sign lands where it does.
    const { amount } = renderMoney(<Money amount={agorot(-5000)} />);
    expect(amount.textContent).toContain(RLM);
    expect(amount.textContent).toContain(LRM);
    expect(amount.textContent).toBe(formatILS(agorot(-5000), 'he'));
  });

  it('passes the whole-shekel option through rather than trimming the string', () => {
    const { amount } = renderMoney(<Money amount={agorot(24800)} showDecimals={false} />);
    expect(amount.textContent).toBe(formatILS(agorot(24800), 'he', { showDecimals: false }));
    expect(amount.textContent).not.toContain('.');
  });
});

describe('whole shekels are a request, not an instruction', () => {
  /**
   * `formatILS(…, { showDecimals: false })` sets `maximumFractionDigits: 0`,
   * which rounds. In a product that sells a price which does not move, the one
   * thing this component may never do is render a figure the customer will not
   * be charged — so the option is honoured only where there is nothing to lose.
   */
  it.each(WITH_AGOROT)('renders %i agorot in full despite showDecimals={false}', (amount) => {
    const { amount: node } = renderMoney(<Money amount={amount} showDecimals={false} />);
    expect(node.textContent).toBe(formatILS(amount, 'he'));
  });

  it.each(WITH_AGOROT)('never renders the rounded figure for %i agorot', (amount) => {
    const rounded = formatILS(amount, 'he', { showDecimals: false });
    const { amount: node } = renderMoney(<Money amount={amount} showDecimals={false} />);
    expect(node.textContent).not.toBe(rounded);
    // The concrete failure: ₪248.50 must not be able to appear as ₪249.
    expect(node.textContent).toContain('.');
  });

  it('is the same refusal in English, and on the spoken form of a negative', () => {
    const { amount, spoken } = renderMoney(
      <Money amount={agorot(-24850)} locale="en" showDecimals={false} />,
    );
    expect(amount.textContent).toBe(formatILS(agorot(-24850), 'en'));
    // A screen reader must not be told a different number from the one on screen.
    expect(spoken?.textContent).toContain(formatILS(agorot(24850), 'en'));
  });

  it.each(WHOLE_SHEKELS)('still drops the decimals on %i agorot, which is the point', (amount) => {
    const { amount: node } = renderMoney(<Money amount={amount} showDecimals={false} />);
    expect(node.textContent).toBe(formatILS(amount, 'he', { showDecimals: false }));
    expect(node.textContent).not.toContain('.');
  });

  it('changes nothing when the option is not asked for', () => {
    for (const amount of [...WITH_AGOROT, ...WHOLE_SHEKELS]) {
      expect(renderMoney(<Money amount={amount} />).amount.textContent).toBe(
        formatILS(amount, 'he'),
      );
    }
  });
});

describe('the reduced bidi algorithm this file relies on', () => {
  it('reproduces the two textbook cases', () => {
    // Latin sentence with a Hebrew word and a number: the number belongs to the
    // Hebrew run, so it sits to its left.
    expect(displayed('hello שלום 12', 0)).toBe('hello 12 םולש');
    // Hebrew sentence with a Latin word: the Latin run keeps its own order.
    expect(displayed('שלום world 12', 1)).toBe('world 12 םולש');
  });
});

describe('the amount is isolated from the prose around it', () => {
  it('renders inside a bdi, with the isolation declared rather than inherited', () => {
    const { amount } = renderMoney(<Money amount={agorot(24800)} />);
    expect(amount.tagName).toBe('BDI');
    expect(amount.className).toContain('[unicode-bidi:isolate]');
  });

  it('puts the symbol on the same side of the digits in both locales', () => {
    // The argument against hard-coding dir="ltr": it would render Hebrew as
    // "248.00 ₪" and English as "₪248.00", so the symbol would change sides
    // when a user changed language. Resolved on its own terms, it does not.
    expect(isolated(formatILS(agorot(24800), 'he'))).toBe('₪ 248.00');
    expect(isolated(formatILS(agorot(24800), 'en'))).toBe('₪248.00');
  });

  it('never reorders the digits themselves', () => {
    for (const locale of ['he', 'en'] as const) {
      expect(isolated(formatILS(agorot(123450), locale))).toContain('1,234.50');
    }
  });

  it('keeps a minus against the digits — which unisolated prose does not', () => {
    const english = formatILS(agorot(-5000), 'en');
    expect(isolated(english)).toBe('-₪50.00');
    // Dropped into Hebrew with nothing protecting it, the sign is flung to the
    // far end of the run and reads as a trailing mark on the number.
    expect(inHebrewProse(english)).toContain('₪50.00-');
  });

  it('shows what isolation buys for a Hebrew amount too', () => {
    const hebrew = formatILS(agorot(24800), 'he');
    expect(isolated(hebrew)).toBe('₪ 248.00');
    // The same string inside an English paragraph, unisolated, puts the symbol
    // on the other side of the number.
    expect(displayed(`hello ${hebrew} world`, 0)).toContain('248.00₪');
  });
});

describe("ICU's invisible marks are load-bearing", () => {
  const hebrewNegative = formatILS(agorot(-5000), 'he');

  it('places the sign against the digits as written', () => {
    expect(isolated(hebrewNegative)).toBe('₪ -50.00');
  });

  it('moves the sign to the far end of the run if the LRM is stripped', () => {
    // This is what "normalise the string", "trim it", or "rebuild the sign by
    // hand because a hyphen looked too small" actually costs. A discount that
    // renders as "50.00-" is a discount a customer reads as a charge.
    expect(isolated(hebrewNegative.replaceAll(LRM, ''))).toBe('₪ 50.00-');
  });

  it('moves the symbol to the other side if the RLM is stripped', () => {
    expect(isolated(hebrewNegative.replaceAll(RLM, ''))).toBe('-50.00 ₪');
  });

  it('is what the component actually renders, so all of the above applies to it', () => {
    const { amount } = renderMoney(<Money amount={agorot(-5000)} />);
    expect(amount.textContent).toBe(hebrewNegative);
    expect(isolated(amount.textContent ?? '')).toBe('₪ -50.00');
  });
});

describe('negative amounts read as negative without any colour', () => {
  it('states the sign on the element, so nothing downstream re-derives it', () => {
    expect(renderMoney(<Money amount={agorot(-5000)} />).root.dataset['sign']).toBe('negative');
    expect(renderMoney(<Money amount={agorot(5000)} />).root.dataset['sign']).toBe('positive');
    expect(renderMoney(<Money amount={agorot(0)} />).root.dataset['sign']).toBe('positive');
  });

  it.each(['he', 'en'] as const)('always renders a sign glyph in %s', (locale) => {
    const { amount } = renderMoney(<Money amount={agorot(-5000)} locale={locale} />);
    expect(amount.textContent).toContain('-');
  });

  it.each([
    ['he', 'מינוס'],
    ['en', 'minus'],
  ] as const)(
    'says the word in %s rather than trusting a hyphen to be announced',
    (locale, word) => {
      const { amount, spoken } = renderMoney(<Money amount={agorot(-5000)} locale={locale} />);
      expect(spoken?.textContent).toContain(word);
      expect(spoken?.textContent).toContain(formatILS(agorot(5000), locale));
      // ...and the glyph is not announced a second time.
      expect(amount.getAttribute('aria-hidden')).toBe('true');
    },
  );

  it('adds nothing at all for a positive amount', () => {
    const { amount, spoken } = renderMoney(<Money amount={agorot(5000)} />);
    expect(spoken).toBeNull();
    expect(amount.getAttribute('aria-hidden')).toBeNull();
  });
});

describe('the class money is set in', () => {
  const declarations = declarationsFor(MONEY_CLASS);

  it('is one class, and every amount wears it', () => {
    const column = AMOUNTS.map((amount) => renderMoney(<Money amount={amount} />).root.className);
    for (const className of column) {
      expect(className.split(/\s+/)).toContain(MONEY_CLASS);
    }
    // Every row in a receipt is set identically, which is what makes it a column.
    expect(new Set(column).size).toBe(1);
  });

  it('does not respell the family or the figures beside it', () => {
    // The failure this replaces: four spellings of one rule across the package,
    // two of which keep the old face on the day `moneyFontFamily` moves.
    for (const size of ['total', 'subtotal', 'line'] as const) {
      const rendered = moneyVariants({ size }).split(/\s+/);
      expect(rendered).not.toContain(tabularNumerals);
      expect(rendered).not.toContain('font-display');
    }
  });

  it('resolves to the face the measurements picked, not to one typed out here', () => {
    expect(declarations).toContain(`font-family: var(--font-${moneyFontFamily});`);
    expect(typefaceFacts[moneyFontFamily].digitsAlreadyTabular).toBe(true);
    expect(typefaceFacts[moneyFontFamily].hasShekelSign).toBe(true);
  });

  it('is never mono, which has no ₪ glyph, nor the body face, whose alignment is a feature', () => {
    expect(typefaceFacts.mono.hasShekelSign).toBe(false);
    expect(typefaceFacts.body.digitsAlreadyTabular).toBe(false);
    expect(declarations).not.toContain('var(--font-mono)');
    expect(declarations).not.toContain('var(--font-body)');
  });

  it('declares tabular figures, as insurance on the fallback stack', () => {
    // A no-op on Heebo, whose digits already share one advance. It is what
    // promotes a system fallback face to tabular on the day Heebo fails to load.
    expect(declarations).toContain(`font-variant-numeric: ${tabularNumerals};`);
  });

  it('carries the declaration Tailwind’s own tabular-nums does not', () => {
    // `font-variant-numeric` alone loses to an ancestor's `font-feature-settings`
    // for the same feature, so a `'pnum'` several levels up would un-align a
    // price and nothing in the price's class list would explain why.
    expect(declarations).toContain('font-feature-settings: normal;');
    expect(declarationsFor(tabularNumerals)).not.toContain('font-feature-settings');
  });
});

describe('presentation', () => {
  it('has a locked-total form and a line-item form, and they differ', () => {
    const total = renderMoney(<Money amount={agorot(24800)} size="total" />).root.className;
    const line = renderMoney(<Money amount={agorot(24800)} size="line" />).root.className;
    expect(total).not.toBe(line);
    expect(line).toContain('text-step-0');
    for (const className of [total, line]) {
      expect(className.split(/\s+/)).toContain(MONEY_CLASS);
      expect(className).toContain('whitespace-nowrap');
    }
  });

  it('defaults to the line-item form, because that is the common case', () => {
    const bare = renderMoney(<Money amount={agorot(24800)} />).root.className;
    const line = renderMoney(<Money amount={agorot(24800)} size="line" />).root.className;
    expect(bare).toBe(line);
  });

  it('lets a caller override a class rather than fighting it', () => {
    const { root } = renderMoney(
      <Money amount={agorot(24800)} size="total" className="text-step-2" />,
    );
    expect(root.className).toContain('text-step-2');
    expect(root.className).not.toContain(classFrom('total', 'text-'));
  });

  it('passes anything else straight through to the element', () => {
    const { root } = renderMoney(<Money amount={agorot(24800)} id="locked-total" title="סה״כ" />);
    expect(root.id).toBe('locked-total');
    expect(root.getAttribute('title')).toBe('סה״כ');
  });
});

describe('the locked total scales down instead of overflowing', () => {
  const sizeClass = classFrom('total', 'text-');
  const declaration = declarationsFor(sizeClass);
  const [floor, preferred, ceiling] = clampArguments(declaration);

  /**
   * The number a browser would compute for the headline, given a root font size
   * and a viewport width. `Math.min(Math.max(…))` is what `clamp()` means.
   */
  function resolvedPx(rootPx: number, viewportPx: number): number {
    const [lo, mid, hi] = [floor, preferred, ceiling].map((argument) =>
      toPx(argument ?? '', rootPx, viewportPx),
    );
    return Math.min(Math.max(mid ?? 0, lo ?? 0), hi ?? 0);
  }

  /**
   * A formatted amount's width, in px. Heebo's digits share one advance of
   * roughly 0.58em and the separators are narrower, so charging every character
   * the digit advance overstates the run — which is the direction a "does it
   * fit" assertion should err in.
   */
  function widthPx(amount: Agorot, fontSizePx: number): number {
    const visible = formatILS(amount, 'he').replaceAll(LRM, '').replaceAll(RLM, '');
    return visible.length * 0.58 * fontSizePx;
  }

  /** `Card padding="roomy"` is 24px on each side of the Price Card. */
  const CARD_PADDING_PX = 48;
  /** The narrowest viewport WCAG 1.4.10 requires content to reflow into. */
  const NARROWEST_PX = 320;

  it('is a bounded size rather than the fixed step it used to be', () => {
    // `text-step-4` compiles to `font-size: var(--text-step-4)` and nothing
    // caps it, which is how the largest number on the Price Card ended up
    // wider than the card at an enlarged root font size.
    expect(declaration).not.toMatch(/font-size:\s*var\(--text-step-4\)\s*;/);
    expect(declaration).toMatch(/font-size:\s*clamp\(/);
  });

  it('keeps the type step as its ceiling, so ordinary settings look unchanged', () => {
    expect(ceiling).toBe('var(--text-step-4)');
    // A laptop, at the browser default: exactly the size the plan specifies.
    expect(resolvedPx(16, 1440)).toBeCloseTo(fontSizeRem['step-4'] * 16, 5);
    // A current phone, at the browser default: indistinguishable from it.
    expect(resolvedPx(16, 393)).toBeCloseTo(fontSizeRem['step-4'] * 16, 0);
  });

  it('is bounded by the box it sits in, not only by the type scale', () => {
    expect(preferred).toMatch(/^\d+(?:\.\d+)?cqi$/);
  });

  it('still has a floor, so it stays a headline in a narrow column', () => {
    expect(floor).toMatch(/^\d+(?:\.\d+)?rem$/);
    expect(Number.parseFloat(floor ?? '0')).toBeLessThan(fontSizeRem['step-4']);
    expect(Number.parseFloat(floor ?? '0')).toBeGreaterThan(0);
  });

  it.each([agorot(24800), agorot(189000)])(
    'fits %i agorot inside a 320px card at 200% text, where the fixed step did not',
    (amount) => {
      const enlarged = resolvedPx(32, NARROWEST_PX);
      expect(widthPx(amount, enlarged) + CARD_PADDING_PX).toBeLessThanOrEqual(NARROWEST_PX);

      // The regression this replaces: the same figure at a fixed 3.2rem, with
      // `whitespace-nowrap` and nowhere to wrap, runs off the end of the card.
      const fixed = fontSizeRem['step-4'] * 32;
      expect(widthPx(amount, fixed) + CARD_PADDING_PX).toBeGreaterThan(NARROWEST_PX);
    },
  );

  it('never breaks a price across two lines to achieve it', () => {
    // Shrinking is the concession; a number split over a line end is not.
    expect(moneyVariants({ size: 'total' })).toContain('whitespace-nowrap');
  });

  it('keeps the leading the step was paired with', () => {
    // An arbitrary font-size carries no line-height, and inheriting the body's
    // 1.6 would put a sixth of a line of air around a 51px figure.
    const leading = classFrom('total', 'leading-');
    expect(declarationsFor(leading)).toContain('var(--text-step-4--line-height)');
  });
});

describe('locale', () => {
  it('is Hebrew when nobody wrapped anything', () => {
    const { amount } = renderMoney(<Money amount={agorot(24800)} />);
    expect(amount.textContent).toBe(formatILS(agorot(24800), 'he'));
  });

  it('follows the surrounding provider', () => {
    const { container } = render(
      <DirectionProvider locale="en">
        <Money amount={agorot(24800)} />
      </DirectionProvider>,
    );
    expect(container.querySelector('bdi')?.textContent).toBe(formatILS(agorot(24800), 'en'));
  });

  it('lets the prop win, for a receipt rendered in a language the page is not in', () => {
    const { container } = render(
      <DirectionProvider locale="en">
        <Money amount={agorot(24800)} locale="he" />
      </DirectionProvider>,
    );
    expect(container.querySelector('bdi')?.textContent).toBe(formatILS(agorot(24800), 'he'));
  });
});
