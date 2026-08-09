import {
  ADJUSTMENT_REASONS,
  AdjustmentReason,
  PriceBreakdownSchema,
  PriceLineKind,
  QuoteSchema,
  VehicleClassId,
  addVat,
  agorot,
  bps,
  formatBps,
  formatILS,
  isQuoteExpired,
  verifyBreakdown,
  type Agorot,
  type Bps,
  type Locale,
  type PriceBreakdown,
  type PriceLine,
  type Quote,
} from '@haul/types';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { DirectionProvider } from '../components/direction.js';
import {
  PRICE_CARD_COPY,
  PriceCard,
  adjustmentReasonText,
  displayedLines,
  displayedTotal,
  priceCardSurfaces,
  priceCardVariantNames,
  visibleLines,
  type AdjustmentTerms,
  type PriceCardVariant,
} from '../components/price-card.js';
import { controlHeightsPx } from '../tokens/size.js';
import { cssFor, resolvedMinHeightPx } from './helpers/stylesheet.js';

/**
 * The Price Card carries the one promise the company is built on, so it is held
 * to the promise rather than to its implementation. Almost every assertion below
 * reads the rendered DOM and does arithmetic on the characters a customer would
 * actually see: `verifyBreakdown` proving the *object* adds up is necessary and
 * is nowhere near sufficient, because a component that renders four of five
 * lines, or states net figures beside a gross total, satisfies the object and
 * still hands someone a receipt that does not add up.
 *
 * That means the tests need to read money back out of the screen, so the first
 * thing established here is that the reader itself is trustworthy.
 */

afterEach(cleanup);

const LOCALES: readonly Locale[] = ['he', 'en'];
const VAT_RATE: Bps = bps(1800);

const ISSUED = new Date('2026-08-09T09:00:00Z');
const EXPIRES = new Date('2026-08-09T09:15:00Z');
/** Ten minutes inside the lock. */
const LIVE_NOW = new Date('2026-08-09T09:05:00Z');
/** Five minutes past it. */
const LAPSED_NOW = new Date('2026-08-09T09:20:00Z');

// --- reading money back off the screen ---------------------------------------

const BIDI_MARKS = /[‎‏؜]/g;

/** What a person sees: the invisible marks dropped, the NBSP normalised. */
function plain(text: string): string {
  return text.replace(BIDI_MARKS, '').replaceAll(' ', ' ');
}

/**
 * Turn a rendered ILS string back into agorot, in decimal-string space rather
 * than through `parseFloat` — the money module bans floats for exactly the
 * reason that `8.155 * 100` is not `816`, and a test that reintroduced the bug
 * while checking for it would be worse than no test.
 */
function parseIls(text: string): number {
  const cleaned = plain(text)
    .replaceAll('−', '-')
    .replace(/[^\d.,-]/g, '')
    .replaceAll(',', '');
  const negative = cleaned.startsWith('-');
  const [whole = '0', fraction = ''] = cleaned.replace('-', '').split('.');
  const value = Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
  return negative ? -value : value;
}

/**
 * `Money` renders a screen-reader phrase beside the glyphs and marks its root
 * with `data-sign`, so the figure is the `<bdi>` inside that root — not merely
 * the first `<bdi>` in the row, which is the isolated label.
 */
function moneyText(element: Element | null): string {
  return element?.querySelector('[data-sign] bdi')?.textContent ?? '';
}

function moneyValue(element: Element | null): number {
  return parseIls(moneyText(element));
}

// --- fixtures ----------------------------------------------------------------

interface LineSpec {
  readonly key: string;
  readonly he: string;
  readonly en: string;
  readonly amount: number;
  readonly detailHe?: string;
  readonly detailEn?: string;
  readonly visible?: boolean;
  readonly kind?: PriceLine['kind'];
}

/**
 * Built through the real schemas, so a fixture that could not exist in
 * production cannot be used to make this component look correct.
 */
function buildBreakdown(specs: readonly LineSpec[]): PriceBreakdown {
  const lines = specs.map((spec) => ({
    kind: spec.kind ?? PriceLineKind.Base,
    key: spec.key,
    labelHe: spec.he,
    labelEn: spec.en,
    detailHe: spec.detailHe ?? null,
    detailEn: spec.detailEn ?? null,
    amount: spec.amount,
    isVisible: spec.visible ?? true,
  }));
  const net = agorot(lines.reduce((acc, line) => acc + line.amount, 0));
  const split = addVat(net, VAT_RATE);

  return PriceBreakdownSchema.parse({
    lines,
    netSubtotal: split.net,
    vatRate: VAT_RATE,
    vat: split.vat,
    grossTotal: split.gross,
  });
}

function buildQuote(breakdown: PriceBreakdown, over: Partial<Quote> = {}): Quote {
  return QuoteSchema.parse({
    id: 'q_01J8',
    cityId: 'tel_aviv',
    breakdown,
    lockedTotal: breakdown.grossTotal,
    // A real take rate, and deliberately not a round fraction of the total, so
    // the offer-leak assertions cannot pass by coincidence.
    driverPayout: Math.round(breakdown.grossTotal * 0.78),
    issuedAt: ISSUED,
    expiresAt: EXPIRES,
    estimatedWorkingMinutes: 135,
    recommendedVehicleClass: VehicleClassId.BoxTruck4t,
    crewSize: 2,
    routedDistanceMeters: 8400,
    engineVersion: '1.0.0',
    rateCardVersion: 'tlv-2026-08',
    inputHash: 'f3a9c1',
    reviewedBy: null,
    ...over,
  });
}

/** The plan's own card, line for line. */
const PLAIN = buildBreakdown([
  {
    key: 'base',
    he: 'נסיעה בסיסית',
    en: 'Base fare',
    detailHe: 'משאית 4 טון · 2 מובילים',
    detailEn: 'Box truck · 2 movers',
    amount: 14500,
  },
  {
    key: 'labor',
    he: 'זמן עבודה',
    en: 'Working time',
    detailHe: '2ש 15ד משוער',
    detailEn: '2h 15m est.',
    amount: 6800,
    kind: PriceLineKind.Labor,
  },
  {
    key: 'distance',
    he: 'מרחק',
    en: 'Distance',
    detailHe: '8.4 ק״מ',
    amount: 2100,
    kind: PriceLineKind.Distance,
  },
  {
    key: 'access.stairs',
    he: 'מדרגות',
    en: 'Stairs',
    detailHe: '2 קומות ללא מעלית',
    detailEn: '2 flights, no elevator',
    amount: 1400,
    kind: PriceLineKind.Access,
  },
]);

/** The case the `isVisible` flag exists for: two lines folded into the total. */
const FOLDED = buildBreakdown([
  { key: 'base', he: 'נסיעה בסיסית', en: 'Base fare', amount: 14500 },
  { key: 'labor', he: 'זמן עבודה', en: 'Working time', amount: 6800, kind: PriceLineKind.Labor },
  {
    key: 'factor',
    he: 'ביקוש ערב שישי',
    en: 'Friday evening demand',
    amount: 3200,
    visible: false,
    kind: PriceLineKind.DemandFactor,
  },
  {
    key: 'rounding',
    he: 'עיגול לסכום עגול',
    en: 'Rounding to a clean figure',
    amount: -17,
    visible: false,
    kind: PriceLineKind.Rounding,
  },
]);

const WITH_PROMO = buildBreakdown([
  { key: 'base', he: 'נסיעה בסיסית', en: 'Base fare', amount: 14500 },
  { key: 'labor', he: 'זמן עבודה', en: 'Working time', amount: 6800, kind: PriceLineKind.Labor },
  {
    key: 'factor',
    he: 'ביקוש ערב שישי',
    en: 'Friday evening demand',
    amount: 2900,
    visible: false,
    kind: PriceLineKind.DemandFactor,
  },
  {
    key: 'promo',
    he: 'הנחה',
    en: 'Discount',
    detailHe: 'FIRSTMOVE',
    detailEn: 'FIRSTMOVE',
    amount: -5000,
    kind: PriceLineKind.Promo,
  },
]);

const SINGLE = buildBreakdown([
  { key: 'base', he: 'מינימום קריאה', en: 'Call-out minimum', amount: 24000 },
]);

/** Every line folded. Degenerate, legal, and it must not throw. */
const ALL_HIDDEN = buildBreakdown([
  { key: 'base', he: 'נסיעה בסיסית', en: 'Base fare', amount: 14500, visible: false },
  {
    key: 'factor',
    he: 'ביקוש ערב שישי',
    en: 'Friday evening demand',
    amount: 1900,
    visible: false,
    kind: PriceLineKind.DemandFactor,
  },
]);

/** The schema's ceiling: 60 lines, one of them very long. */
const MAXIMAL = buildBreakdown(
  Array.from({ length: 60 }, (_, index) => ({
    key: `item.${index}`,
    he:
      index === 7
        ? 'פריט כבד במיוחד שדורש הסבר ארוך במיוחד כדי לבדוק שהשורה לא שוברת את הפריסה'
        : `שורה ${index}`,
    en:
      index === 7
        ? 'A deliberately long label that has to wrap without breaking the row layout'
        : `Line ${index}`,
    amount: 500 + index * 37,
    kind: PriceLineKind.HeavyItem,
  })),
);

interface Fixture {
  readonly name: string;
  readonly breakdown: PriceBreakdown;
}

const FIXTURES: readonly Fixture[] = [
  { name: 'the plan’s own card', breakdown: PLAIN },
  { name: 'two folded lines', breakdown: FOLDED },
  { name: 'a promo and a folded factor', breakdown: WITH_PROMO },
  { name: 'a single line', breakdown: SINGLE },
  { name: 'every line folded', breakdown: ALL_HIDDEN },
  { name: 'sixty lines', breakdown: MAXIMAL },
];

/** The fixtures that put at least one row on screen, i.e. that make an arithmetic claim. */
const ITEMISED = FIXTURES.filter((fixture) => visibleLines(fixture.breakdown).length > 0);

const VARIANTS = priceCardVariantNames;

// --- rendering helpers --------------------------------------------------------

function renderCard(ui: ReactElement): HTMLElement {
  return render(ui).container;
}

function card(container: HTMLElement): HTMLElement {
  const found = container.querySelector('[data-variant]');
  if (!(found instanceof HTMLElement)) throw new Error('PriceCard did not render');
  return found;
}

function lineRows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll('[data-price-card-lines] [data-line-key]')].filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
}

function summaryRow(container: HTMLElement, key: string): HTMLElement | null {
  const found = container.querySelector(`[data-summary-key="${key}"]`);
  return found instanceof HTMLElement ? found : null;
}

function headline(container: HTMLElement): HTMLElement | null {
  const found = container.querySelector('[data-price-card-total]');
  return found instanceof HTMLElement ? found : null;
}

function textOf(container: HTMLElement): string {
  return plain(container.textContent ?? '');
}

const NEEDS_CSS_ESCAPE = /[[\]().:!/%,#'"+*>~^$|=]/g;

/**
 * The declarations a browser would apply to an element, unioned from the rules
 * of that element's own classes.
 *
 * Scoped to each class's own block deliberately. The compiler behind `cssFor`
 * accumulates candidates across calls, so a sheet built for one element also
 * carries every rule built for every element before it — search it unscoped and
 * you find a guarantee this element does not have, which is the same class of
 * false green as reading the class attribute in the first place.
 */
function appliedDeclarations(className: string): string {
  return className
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const css = cssFor([token]);
      const start = css.indexOf(`.${token.replace(NEEDS_CSS_ESCAPE, (ch) => `\\${ch}`)} {`);
      if (start === -1) return '';
      const open = css.indexOf('{', start);
      const close = css.indexOf('}', open);
      return open === -1 || close === -1 ? '' : css.slice(open + 1, close);
    })
    .join('\n');
}

/**
 * Markup with the generated ids blanked. `useId` hands out a fresh value per
 * render, so a raw `innerHTML` comparison between two renders always differs and
 * an "identical" assertion built on it would pass by accident forever.
 */
function stableHtml(element: HTMLElement): string {
  return element.innerHTML.replace(/(id|aria-labelledby|aria-describedby)="[^"]*"/g, '$1=""');
}

// --- the reader itself --------------------------------------------------------

describe('the money reader these tests depend on', () => {
  const AMOUNTS = [0, 1, 99, 100, 24800, 123450, 1234567, -1, -5000, -123450];

  it.each(LOCALES)('round-trips every formatted amount in %s', (locale) => {
    for (const amount of AMOUNTS) {
      expect(parseIls(formatILS(agorot(amount), locale))).toBe(amount);
    }
  });

  it('survives the bidi marks and the non-breaking space ICU inserts', () => {
    const hebrew = formatILS(agorot(-5000), 'he');
    expect(hebrew).toMatch(BIDI_MARKS);
    expect(parseIls(hebrew)).toBe(-5000);
  });

  it('reads a class’s own rule rather than the whole accumulated sheet', () => {
    // The compiler behind cssFor is cumulative. Build the display-face rule into
    // it first, so the negative below is a real negative and not an empty sheet
    // — otherwise every "this figure is in the money face" assertion in this
    // file would pass for every element the moment one element passed.
    expect(appliedDeclarations('font-display')).toMatch(/font-family:\s*var\(--font-display\)/);
    expect(appliedDeclarations('whitespace-nowrap')).not.toMatch(/font-family/);
  });
});

// --- the fixtures are legal quotes -------------------------------------------

describe('the fixtures', () => {
  it.each(FIXTURES)('$name is a breakdown that adds up', ({ breakdown }) => {
    expect(verifyBreakdown(breakdown)).toEqual({ ok: true });
  });

  it('gives the driver a payout that is not the customer’s total', () => {
    // Otherwise every "the offer does not leak the locked total" assertion below
    // would pass for the wrong reason.
    for (const { breakdown } of FIXTURES) {
      const quote = buildQuote(breakdown);
      expect(quote.driverPayout).not.toBe(quote.lockedTotal);
      for (const locale of LOCALES) {
        expect(formatILS(quote.driverPayout, locale)).not.toBe(
          formatILS(quote.lockedTotal, locale),
        );
      }
    }
  });
});

// --- the arithmetic on screen -------------------------------------------------

describe('the displayed figures are exact', () => {
  it.each(FIXTURES)('$name — gross line amounts sum to the locked total', ({ breakdown }) => {
    const rows = displayedLines(breakdown, 'gross');
    if (rows.length === 0) return;
    const sum = rows.reduce((acc, row) => acc + row.amount, 0);
    expect(sum).toBe(displayedTotal(breakdown, 'gross'));
    expect(sum).toBe(breakdown.grossTotal);
  });

  it.each(FIXTURES)('$name — net line amounts sum to the net subtotal', ({ breakdown }) => {
    const rows = displayedLines(breakdown, 'net');
    if (rows.length === 0) return;
    expect(rows.reduce((acc, row) => acc + row.amount, 0)).toBe(breakdown.netSubtotal);
  });

  it('never restates a discount, because a promo is a fixed promise', () => {
    const rows = displayedLines(WITH_PROMO, 'gross');
    const promo = rows.find((row) => row.line.key === 'promo');
    const stated = WITH_PROMO.lines.find((line) => line.key === 'promo');
    expect(stated).toBeDefined();
    expect(promo?.amount).toBe(addVat(stated?.amount ?? agorot(0), VAT_RATE).gross);
    expect(promo?.amount).toBeLessThan(0);
  });

  it('produces whole agorot only — no float ever reaches a screen', () => {
    for (const { breakdown } of FIXTURES) {
      for (const space of ['gross', 'net'] as const) {
        for (const row of displayedLines(breakdown, space)) {
          expect(Number.isInteger(row.amount)).toBe(true);
        }
      }
    }
  });
});

describe('a receipt that does not add up is the failure this product exists to prevent', () => {
  const GROSS_VARIANTS = VARIANTS.filter(
    (variant) => priceCardSurfaces[variant].lineAmounts === 'gross',
  );

  it.each(
    GROSS_VARIANTS.flatMap((variant) =>
      LOCALES.flatMap((locale) => ITEMISED.map((fixture) => ({ variant, locale, fixture }))),
    ),
  )(
    '$variant in $locale — $fixture.name — the rows on screen sum to the total on screen',
    ({ variant, locale, fixture }) => {
      const quote = buildQuote(fixture.breakdown);
      const container = renderCard(
        <PriceCard quote={quote} variant={variant} locale={locale} now={LIVE_NOW} />,
      );

      const rows = lineRows(container);
      expect(rows.length).toBe(visibleLines(fixture.breakdown).length);

      const sum = rows.reduce((acc, row) => acc + moneyValue(row.querySelector('dd')), 0);
      const total = moneyValue(summaryRow(container, 'total'));

      expect(sum).toBe(total);
      expect(total).toBe(quote.lockedTotal);
      // ...and the enormous figure at the top is the same number again.
      expect(moneyValue(headline(container))).toBe(total);
    },
  );

  it.each(LOCALES.flatMap((locale) => ITEMISED.map((fixture) => ({ locale, fixture }))))(
    'invoice in $locale — $fixture.name — net rows sum to net, and net plus VAT is the total',
    ({ locale, fixture }) => {
      const quote = buildQuote(fixture.breakdown);
      const container = renderCard(
        <PriceCard quote={quote} variant="invoice" locale={locale} now={LIVE_NOW} />,
      );

      const sum = lineRows(container).reduce(
        (acc, row) => acc + moneyValue(row.querySelector('dd')),
        0,
      );
      const net = moneyValue(summaryRow(container, 'net'));
      const vat = moneyValue(summaryRow(container, 'vat'));
      const total = moneyValue(summaryRow(container, 'total'));

      expect(sum).toBe(net);
      expect(net + vat).toBe(total);
      expect(total).toBe(quote.lockedTotal);
    },
  );

  it('states the same locked number on every customer-facing surface', () => {
    const quote = buildQuote(PLAIN);
    const totals = VARIANTS.filter((variant) => priceCardSurfaces[variant].tax !== 'none').map(
      (variant) => {
        const container = renderCard(<PriceCard quote={quote} variant={variant} now={LIVE_NOW} />);
        return moneyValue(summaryRow(container, 'total'));
      },
    );
    expect(new Set(totals)).toEqual(new Set([quote.lockedTotal]));
  });
});

// --- folded lines -------------------------------------------------------------

describe('a line marked invisible never reaches the DOM', () => {
  const HIDDEN_STRINGS = [
    'ביקוש ערב שישי',
    'Friday evening demand',
    'עיגול לסכום עגול',
    'Rounding to a clean figure',
  ];

  it.each(VARIANTS.flatMap((variant) => LOCALES.map((locale) => ({ variant, locale }))))(
    '$variant in $locale',
    ({ variant, locale }) => {
      const container = renderCard(
        <PriceCard quote={buildQuote(FOLDED)} variant={variant} locale={locale} now={LIVE_NOW} />,
      );

      const text = textOf(container);
      for (const hidden of HIDDEN_STRINGS) expect(text).not.toContain(hidden);

      expect(lineRows(container).map((row) => row.dataset['lineKey'])).toEqual(['base', 'labor']);
    },
  );

  it('folds the hidden amount into the total rather than dropping it', () => {
    // The hidden lines are worth 3200 − 17 net. If they were simply skipped the
    // rows would sum short, which is the bug this flag makes easy to ship.
    const container = renderCard(<PriceCard quote={buildQuote(FOLDED)} now={LIVE_NOW} />);
    const naive = visibleLines(FOLDED).reduce(
      (acc, line) => acc + addVat(line.amount, VAT_RATE).gross,
      0,
    );
    const shown = lineRows(container).reduce(
      (acc, row) => acc + moneyValue(row.querySelector('dd')),
      0,
    );
    expect(shown).toBeGreaterThan(naive);
    expect(shown).toBe(FOLDED.grossTotal);
  });
});

describe('the word this product refuses to use', () => {
  it('does not appear anywhere in the component’s own vocabulary', () => {
    for (const phrase of Object.values(PRICE_CARD_COPY)) {
      expect(phrase.he.toLowerCase()).not.toContain('surge');
      expect(phrase.en.toLowerCase()).not.toContain('surge');
    }
  });

  it('does not appear in any adjustment sentence, with or without terms', () => {
    const terms: AdjustmentTerms = { waitGraceMinutes: 15, rescheduleCutoffHours: 2 };
    for (const reason of ADJUSTMENT_REASONS) {
      for (const locale of LOCALES) {
        expect(adjustmentReasonText(reason, locale).toLowerCase()).not.toContain('surge');
        expect(adjustmentReasonText(reason, locale, terms).toLowerCase()).not.toContain('surge');
      }
    }
  });

  it.each(
    VARIANTS.flatMap((variant) =>
      LOCALES.flatMap((locale) => FIXTURES.map((fixture) => ({ variant, locale, fixture }))),
    ),
  )('is absent from $variant in $locale — $fixture.name', ({ variant, locale, fixture }) => {
    for (const now of [LIVE_NOW, LAPSED_NOW]) {
      const container = renderCard(
        <PriceCard
          quote={buildQuote(fixture.breakdown)}
          variant={variant}
          locale={locale}
          now={now}
          terms={{ waitGraceMinutes: 15, rescheduleCutoffHours: 2 }}
        />,
      );
      expect(textOf(container).toLowerCase()).not.toContain('surge');
      cleanup();
    }
  });
});

// --- the four things that may change a locked price ---------------------------

describe('"only these change the price" is generated, never typed out', () => {
  /** The surfaces whose price can still move, and so may still state its terms. */
  const ADJUSTING = VARIANTS.filter((variant) => priceCardSurfaces[variant].adjustments);
  const SETTLED = VARIANTS.filter((variant) => !priceCardSurfaces[variant].adjustments);

  it('is a decision the surface table makes, on both sides', () => {
    // Otherwise the two it.each blocks below could quietly cover nothing.
    expect(ADJUSTING.length).toBeGreaterThan(0);
    expect(SETTLED.length).toBeGreaterThan(0);
    expect([...ADJUSTING, ...SETTLED].sort()).toEqual([...VARIANTS].sort());
  });

  it.each(ADJUSTING.flatMap((variant) => LOCALES.map((locale) => ({ variant, locale }))))(
    '$variant in $locale renders every reason the enum declares',
    ({ variant, locale }) => {
      const container = renderCard(
        <PriceCard quote={buildQuote(PLAIN)} variant={variant} locale={locale} now={LIVE_NOW} />,
      );
      const items = [...container.querySelectorAll('[data-price-card-reasons] > li')];

      // Driven by the enum's own length. A fifth member appears here without this
      // file, or any screen, being edited — and dropping to three fails.
      expect(items).toHaveLength(ADJUSTMENT_REASONS.length);
      expect(items.map((item) => item.getAttribute('data-reason'))).toEqual([
        ...ADJUSTMENT_REASONS,
      ]);
    },
  );

  it.each(SETTLED.flatMap((variant) => LOCALES.map((locale) => ({ variant, locale }))))(
    '$variant in $locale states none of them, because its price is already settled',
    ({ variant, locale }) => {
      // A paid receipt that says "we wait more than 15 minutes" is describing a
      // job that is over, and a חשבונית מס is a document a business files —
      // neither has any use for the terms of a price that can no longer change.
      const terms: AdjustmentTerms = { waitGraceMinutes: 15, rescheduleCutoffHours: 2 };
      const container = renderCard(
        <PriceCard
          quote={buildQuote(PLAIN)}
          variant={variant}
          locale={locale}
          now={LIVE_NOW}
          terms={terms}
        />,
      );

      expect(container.querySelector('[data-price-card-reasons]')).toBeNull();
      expect(container.querySelectorAll('[data-reason]')).toHaveLength(0);

      const text = textOf(container);
      expect(text).not.toContain(
        locale === 'he' ? PRICE_CARD_COPY.onlyThese.he : PRICE_CARD_COPY.onlyThese.en,
      );
      // Not merely the heading: not one of the sentences either, with terms or
      // without, so nothing can leak back in as a stray line.
      for (const reason of ADJUSTMENT_REASONS) {
        expect(text).not.toContain(adjustmentReasonText(reason, locale));
        expect(text).not.toContain(adjustmentReasonText(reason, locale, terms));
      }
    },
  );

  it('gives each reason its own sentence in both languages', () => {
    for (const locale of LOCALES) {
      const sentences = ADJUSTMENT_REASONS.map((reason) => adjustmentReasonText(reason, locale));
      expect(new Set(sentences).size).toBe(ADJUSTMENT_REASONS.length);
      for (const sentence of sentences) expect(sentence.trim().length).toBeGreaterThan(0);
    }
  });

  it('is written in Hebrew for Hebrew and in English for English', () => {
    const hebrew = renderCard(<PriceCard quote={buildQuote(PLAIN)} locale="he" now={LIVE_NOW} />);
    expect(textOf(hebrew)).toContain(PRICE_CARD_COPY.onlyThese.he);
    expect(textOf(hebrew)).not.toContain(PRICE_CARD_COPY.onlyThese.en);
    cleanup();

    const english = renderCard(<PriceCard quote={buildQuote(PLAIN)} locale="en" now={LIVE_NOW} />);
    expect(textOf(english)).toContain(PRICE_CARD_COPY.onlyThese.en);
    expect(textOf(english)).not.toContain(PRICE_CARD_COPY.onlyThese.he);
  });

  it('states the city’s real terms when it is given them, and invents none when it is not', () => {
    const terms: AdjustmentTerms = { waitGraceMinutes: 15, rescheduleCutoffHours: 2 };

    expect(adjustmentReasonText(AdjustmentReason.ExcessWaiting, 'en', terms)).toBe(
      'We wait more than 15 minutes',
    );
    expect(adjustmentReasonText(AdjustmentReason.LateReschedule, 'en', terms)).toBe(
      'You reschedule inside 2 hours',
    );
    // Hebrew counts two of something with a dual form, not with the numeral.
    expect(adjustmentReasonText(AdjustmentReason.LateReschedule, 'he', terms)).toContain('שעתיים');
    expect(adjustmentReasonText(AdjustmentReason.ExcessWaiting, 'he', terms)).toContain('15 דקות');

    for (const locale of LOCALES) {
      expect(adjustmentReasonText(AdjustmentReason.ExcessWaiting, locale)).not.toMatch(/\d/);
      expect(adjustmentReasonText(AdjustmentReason.LateReschedule, locale)).not.toMatch(/\d/);
    }
  });
});

// --- the preposition that changes shape ---------------------------------------

/**
 * Two of the four sentences hang on a one-letter Hebrew preposition, and Hebrew
 * attaches that letter two different ways: straight onto a word — משתי דקות,
 * משעה — and across a maqaf onto a figure set in digits — מ-15 דקות, מ-24 שעות,
 * the same rule that gives המאה ה-12. Which one applies is decided by the count,
 * because one and two are spelled as words and everything else as a numeral.
 *
 * So a sentence template cannot carry a fixed prefix, and the counts below are
 * the whole point of this block: `{ waitGraceMinutes: 15, rescheduleCutoffHours: 2 }`
 * — the pair every other test in this file uses — is the one pair that makes a
 * hardcoded `מ-` and a hardcoded `מ` both look right at once. Both figures are
 * city rate-card props, and a city that sets a one-minute grace or a 24-hour
 * cutoff is not hypothetical.
 */
describe('the Hebrew sentences attach מ the way Hebrew attaches it', () => {
  interface HebrewCase {
    readonly count: number;
    readonly waiting: string;
    readonly reschedule: string;
  }

  const CASES: readonly HebrewCase[] = [
    {
      count: 1,
      waiting: 'אם נמתין יותר מדקה אחת',
      reschedule: 'אם תשנו את המועד פחות משעה לפני',
    },
    {
      count: 2,
      waiting: 'אם נמתין יותר משתי דקות',
      reschedule: 'אם תשנו את המועד פחות משעתיים לפני',
    },
    {
      count: 3,
      waiting: 'אם נמתין יותר מ-3 דקות',
      reschedule: 'אם תשנו את המועד פחות מ-3 שעות לפני',
    },
    {
      count: 10,
      waiting: 'אם נמתין יותר מ-10 דקות',
      reschedule: 'אם תשנו את המועד פחות מ-10 שעות לפני',
    },
    {
      count: 15,
      waiting: 'אם נמתין יותר מ-15 דקות',
      reschedule: 'אם תשנו את המועד פחות מ-15 שעות לפני',
    },
    {
      count: 24,
      waiting: 'אם נמתין יותר מ-24 דקות',
      reschedule: 'אם תשנו את המועד פחות מ-24 שעות לפני',
    },
  ];

  function termsFor(count: number): AdjustmentTerms {
    return { waitGraceMinutes: count, rescheduleCutoffHours: count };
  }

  /** A maqaf separates two scripts. Before a Hebrew letter it is a typo. */
  const MAQAF_BEFORE_A_LETTER = /מ-(?!\p{Nd})/u;
  /** ...and its absence before a figure is the same typo the other way round. */
  const PREFIX_GLUED_TO_A_FIGURE = /מ\p{Nd}/u;

  it.each(CASES)('waits $count minutes, in the words a Hebrew reader would use', (testCase) => {
    expect(
      adjustmentReasonText(AdjustmentReason.ExcessWaiting, 'he', termsFor(testCase.count)),
    ).toBe(testCase.waiting);
  });

  it.each(CASES)('cuts off at $count hours, in the words a Hebrew reader would use', (testCase) => {
    expect(
      adjustmentReasonText(AdjustmentReason.LateReschedule, 'he', termsFor(testCase.count)),
    ).toBe(testCase.reschedule);
  });

  it('never hyphenates before a word, and never fails to hyphenate before a figure', () => {
    // Every count a rate card could plausibly hold, not only the six above.
    for (let count = 0; count <= 120; count += 1) {
      for (const reason of ADJUSTMENT_REASONS) {
        const sentence = adjustmentReasonText(reason, 'he', termsFor(count));
        expect(sentence).not.toMatch(MAQAF_BEFORE_A_LETTER);
        expect(sentence).not.toMatch(PREFIX_GLUED_TO_A_FIGURE);
      }
    }
  });

  it.each(CASES)('puts both sentences on the card itself at $count', (testCase) => {
    const container = renderCard(
      <PriceCard
        quote={buildQuote(PLAIN)}
        locale="he"
        now={LIVE_NOW}
        terms={termsFor(testCase.count)}
      />,
    );
    const sentences = [...container.querySelectorAll('[data-price-card-reasons] > li')].map(
      (item) => plain(item.textContent ?? ''),
    );

    expect(sentences).toHaveLength(ADJUSTMENT_REASONS.length);
    expect(sentences).toContain(testCase.waiting);
    expect(sentences).toContain(testCase.reschedule);
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(MAQAF_BEFORE_A_LETTER);
      expect(sentence).not.toMatch(PREFIX_GLUED_TO_A_FIGURE);
    }
  });

  it('leaves the generic sentences alone, since they name no figure to hyphenate', () => {
    for (const reason of ADJUSTMENT_REASONS) {
      const sentence = adjustmentReasonText(reason, 'he');
      expect(sentence).not.toMatch(/-/);
      expect(sentence).not.toMatch(/\d/);
    }
  });
});

// --- VAT ----------------------------------------------------------------------

describe('VAT is stated, because an Israeli price is quoted inclusive of it', () => {
  const TAXED = VARIANTS.filter((variant) => priceCardSurfaces[variant].tax !== 'none');

  it.each(TAXED.flatMap((variant) => LOCALES.map((locale) => ({ variant, locale }))))(
    '$variant in $locale shows the rate and the amount',
    ({ variant, locale }) => {
      const container = renderCard(
        <PriceCard quote={buildQuote(PLAIN)} variant={variant} locale={locale} now={LIVE_NOW} />,
      );
      const vat = summaryRow(container, 'vat');
      expect(vat).not.toBeNull();
      expect(plain(vat?.textContent ?? '')).toContain(formatBps(PLAIN.vatRate));
      expect(moneyValue(vat)).toBe(PLAIN.vat);
    },
  );

  it('itemises net, VAT and gross on the invoice, where a business reclaims the VAT', () => {
    const container = renderCard(
      <PriceCard quote={buildQuote(PLAIN)} variant="invoice" now={LIVE_NOW} />,
    );
    expect(moneyValue(summaryRow(container, 'net'))).toBe(PLAIN.netSubtotal);
    expect(moneyValue(summaryRow(container, 'vat'))).toBe(PLAIN.vat);
    expect(moneyValue(summaryRow(container, 'total'))).toBe(PLAIN.grossTotal);
  });

  it('says "included" on a consumer surface, so nobody adds it to the total twice', () => {
    const container = renderCard(<PriceCard quote={buildQuote(PLAIN)} now={LIVE_NOW} />);
    expect(summaryRow(container, 'net')).toBeNull();
    expect(plain(summaryRow(container, 'vat')?.textContent ?? '')).toContain('כולל מע״מ');
  });
});

// --- expiry -------------------------------------------------------------------

describe('a lapsed lock cannot go on looking locked', () => {
  const EXPIRING = VARIANTS.filter((variant) => priceCardSurfaces[variant].expires);

  it('agrees with the type layer about what expired means', () => {
    const quote = buildQuote(PLAIN);
    expect(isQuoteExpired(quote, LIVE_NOW)).toBe(false);
    expect(isQuoteExpired(quote, LAPSED_NOW)).toBe(true);
  });

  it.each(EXPIRING.flatMap((variant) => LOCALES.map((locale) => ({ variant, locale }))))(
    '$variant in $locale renders differently once the lock has lapsed',
    ({ variant, locale }) => {
      const quote = buildQuote(PLAIN);

      const live = renderCard(
        <PriceCard quote={quote} variant={variant} locale={locale} now={LIVE_NOW} />,
      );
      const liveHtml = stableHtml(card(live));
      const liveText = textOf(live);
      expect(card(live).dataset['expired']).toBeUndefined();
      cleanup();

      const lapsed = renderCard(
        <PriceCard quote={quote} variant={variant} locale={locale} now={LAPSED_NOW} />,
      );
      expect(stableHtml(card(lapsed))).not.toBe(liveHtml);
      expect(card(lapsed).dataset['expired']).toBe('');

      // The heading changes wording — the channel that survives greyscale.
      const expiredTitle =
        locale === 'he' ? PRICE_CARD_COPY.expiredTitle.he : PRICE_CARD_COPY.expiredTitle.en;
      expect(textOf(lapsed)).toContain(expiredTitle);
      expect(liveText).not.toContain(expiredTitle);

      // ...and a sentence says so, with the time it happened.
      const status = lapsed.querySelector('[data-price-card-status]');
      expect(plain(status?.textContent ?? '')).toContain(locale === 'he' ? 'פג' : 'expired');
      // The figure is still announced, and it is described by that sentence.
      expect(headline(lapsed)?.getAttribute('aria-describedby')).toBe(status?.id);
    },
  );

  it('withdraws the amber, because a price you cannot pay is not money', () => {
    const quote = buildQuote(PLAIN);

    const live = renderCard(<PriceCard quote={quote} now={LIVE_NOW} />);
    expect(amberElements(live)).toHaveLength(1);
    expect(amberElements(live)[0]?.closest('[data-price-card-total]')).not.toBeNull();
    cleanup();

    const lapsed = renderCard(<PriceCard quote={quote} now={LAPSED_NOW} />);
    expect(amberElements(lapsed)).toHaveLength(0);
  });

  it('refuses the booking, which is the channel that cannot be misread', () => {
    const quote = buildQuote(PLAIN);
    const lapsed = renderCard(<PriceCard quote={quote} now={LAPSED_NOW} />);
    const cta = lapsed.querySelector('[data-price-card-cta]');
    expect(cta).toBeDisabled();
  });

  it('leaves a receipt alone, because the price it records was honoured', () => {
    // Every quote behind a receipt has expired — it expired when the job began.
    // A receipt warning that its own price is no longer valid is noise that
    // teaches people to ignore the warning on the surface where it matters.
    for (const variant of VARIANTS.filter((v) => !priceCardSurfaces[v].expires)) {
      const quote = buildQuote(PLAIN);
      const live = renderCard(<PriceCard quote={quote} variant={variant} now={LIVE_NOW} />);
      const liveHtml = stableHtml(card(live));
      cleanup();

      const lapsed = renderCard(<PriceCard quote={quote} variant={variant} now={LAPSED_NOW} />);
      expect(stableHtml(card(lapsed))).toBe(liveHtml);
      expect(textOf(lapsed)).not.toContain(PRICE_CARD_COPY.expiredTitle.he);
      cleanup();
    }
  });

  it('says when a live lock runs out, because a lock is not a promise to hold forever', () => {
    const container = renderCard(<PriceCard quote={buildQuote(PLAIN)} now={LIVE_NOW} />);
    // 09:15Z is 12:15 in Jerusalem in August, and the card is read in Jerusalem.
    expect(plain(container.querySelector('[data-price-card-status]')?.textContent ?? '')).toContain(
      '12:15',
    );
  });
});

/** Every element carrying the one amber utility this card is allowed. */
function amberElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll('*')].filter(
    (node): node is HTMLElement =>
      node instanceof HTMLElement && node.className.split(/\s+/).includes('text-hivis'),
  );
}

// --- the driver's surface -----------------------------------------------------

describe('the offer states the driver’s payout and not the customer’s price', () => {
  it.each(LOCALES)('in %s', (locale) => {
    const quote = buildQuote(PLAIN);
    const container = renderCard(
      <PriceCard quote={quote} variant="offer" locale={locale} now={LIVE_NOW} />,
    );

    expect(moneyValue(headline(container))).toBe(quote.driverPayout);
    expect(moneyValue(headline(container))).not.toBe(quote.lockedTotal);

    const text = textOf(container);
    expect(text).toContain(plain(formatILS(quote.driverPayout, locale)));
    expect(text).not.toContain(plain(formatILS(quote.lockedTotal, locale)));
  });

  it('carries no line amounts at all, because they would add back up to the total', () => {
    const quote = buildQuote(PLAIN);
    const container = renderCard(<PriceCard quote={quote} variant="offer" now={LIVE_NOW} />);

    expect(container.querySelectorAll('[data-price-card-lines] dd')).toHaveLength(0);
    expect(summaryRow(container, 'total')).toBeNull();
    expect(summaryRow(container, 'vat')).toBeNull();

    for (const row of displayedLines(PLAIN, 'gross')) {
      expect(textOf(container)).not.toContain(plain(formatILS(row.amount, 'he')));
    }
  });

  it('still tells the driver what the job involves', () => {
    const container = renderCard(
      <PriceCard quote={buildQuote(PLAIN)} variant="offer" locale="en" now={LIVE_NOW} />,
    );
    const list = container.querySelector('[data-price-card-lines]');
    expect(list?.tagName).toBe('UL');
    expect(textOf(container)).toContain('2 flights, no elevator');
    expect(lineRows(container)).toHaveLength(visibleLines(PLAIN).length);
  });

  it('shows the driver the same four things that may change the price', () => {
    const container = renderCard(
      <PriceCard quote={buildQuote(PLAIN)} variant="offer" now={LIVE_NOW} />,
    );
    expect(container.querySelectorAll('[data-price-card-reasons] > li')).toHaveLength(
      ADJUSTMENT_REASONS.length,
    );
  });
});

// --- accessibility ------------------------------------------------------------

describe('the breakdown is a real structure, not a pile of divs', () => {
  it('pairs every label with its amount, which is what a screen reader reads out', () => {
    const container = renderCard(
      <PriceCard quote={buildQuote(PLAIN)} locale="en" now={LIVE_NOW} />,
    );
    const list = container.querySelector('[data-price-card-lines]');
    expect(list?.tagName).toBe('DL');

    for (const row of lineRows(container)) {
      const terms = row.querySelectorAll('dt');
      const definitions = row.querySelectorAll('dd');
      expect(terms).toHaveLength(1);
      expect(definitions).toHaveLength(1);
      expect(terms[0]?.parentElement).toBe(definitions[0]?.parentElement);
    }

    const working = lineRows(container).find((row) => row.dataset['lineKey'] === 'labor');
    expect(plain(working?.querySelector('dt')?.textContent ?? '')).toContain('Working time');
    expect(moneyValue(working?.querySelector('dd') ?? null)).toBeGreaterThan(0);
  });

  it('hides the decorative separator from assistive technology', () => {
    const container = renderCard(
      <PriceCard quote={buildQuote(PLAIN)} locale="en" now={LIVE_NOW} />,
    );
    const row = lineRows(container).find((node) => node.dataset['lineKey'] === 'access.stairs');
    const separator = row?.querySelector('[aria-hidden="true"]');
    expect(separator?.textContent).toBe(' · ');
  });

  it('names itself, and names each list inside it', () => {
    const container = renderCard(<PriceCard quote={buildQuote(PLAIN)} now={LIVE_NOW} />);
    const root = card(container);

    expect(root.getAttribute('role')).toBe('group');
    const labelledBy = root.getAttribute('aria-labelledby');
    expect(container.querySelector(`#${labelledBy}`)?.textContent).toBe(
      PRICE_CARD_COPY.lockedTitle.he,
    );

    expect(container.querySelector('[data-price-card-lines]')?.getAttribute('aria-label')).toBe(
      PRICE_CARD_COPY.breakdownLabel.he,
    );
    expect(container.querySelector('[data-price-card-summary]')?.getAttribute('aria-label')).toBe(
      PRICE_CARD_COPY.summaryLabel.he,
    );
    const reasons = container.querySelector('[data-price-card-reasons]');
    const reasonsLabel = reasons?.getAttribute('aria-labelledby');
    expect(container.querySelector(`#${reasonsLabel}`)?.textContent).toBe(
      PRICE_CARD_COPY.onlyThese.he,
    );
  });

  it('keeps the locked total the largest figure on the card', () => {
    const container = renderCard(<PriceCard quote={buildQuote(PLAIN)} now={LIVE_NOW} />);
    const total = headline(container)?.querySelector('[data-sign]');
    expect(total?.className).toContain('text-step-4');
    for (const row of lineRows(container)) {
      expect(row.querySelector('dd [data-sign]')?.className).toContain('text-step-0');
    }
  });
});

// --- Hebrew is the reference implementation -----------------------------------

describe('Hebrew renders right to left with the figures intact', () => {
  it('puts the card inside an rtl subtree, and the English one inside an ltr subtree', () => {
    const hebrew = renderCard(
      <DirectionProvider locale="he">
        <PriceCard quote={buildQuote(PLAIN)} now={LIVE_NOW} />
      </DirectionProvider>,
    );
    expect(hebrew.querySelector('[dir="rtl"]')?.contains(card(hebrew))).toBe(true);
    cleanup();

    const english = renderCard(
      <DirectionProvider locale="en">
        <PriceCard quote={buildQuote(PLAIN)} now={LIVE_NOW} />
      </DirectionProvider>,
    );
    expect(english.querySelector('[dir="ltr"]')?.contains(card(english))).toBe(true);
  });

  it('isolates every amount, so the shekel sign cannot migrate into the prose', () => {
    // money.test.tsx resolves the full bidi algorithm and proves where the sign
    // lands. What this card owes is that every figure it renders goes through
    // that mechanism rather than around it.
    const container = renderCard(<PriceCard quote={buildQuote(WITH_PROMO)} now={LIVE_NOW} />);
    const amounts = [...container.querySelectorAll('[data-sign] bdi')];
    expect(amounts.length).toBeGreaterThan(0);
    for (const amount of amounts) {
      expect(amount.className).toContain('[unicode-bidi:isolate]');
    }
  });

  it('leaves ICU’s string untouched, marks and all — that is what places the sign', () => {
    const quote = buildQuote(PLAIN);
    const container = renderCard(<PriceCard quote={quote} now={LIVE_NOW} />);
    const rendered = moneyText(headline(container));

    expect(rendered).toBe(formatILS(quote.lockedTotal, 'he'));
    expect(rendered).toMatch(BIDI_MARKS);
    // The digits themselves run left to right inside that string, in order.
    expect(rendered).toContain('292.64');
    expect(rendered).not.toContain('46.292');
  });

  it('sets every figure in the tabular money face, so the column lines up', () => {
    const container = renderCard(<PriceCard quote={buildQuote(MAXIMAL)} now={LIVE_NOW} />);
    const figures = [...container.querySelectorAll('[data-sign]')];
    expect(figures.length).toBeGreaterThan(60);

    // Asked of the compiled stylesheet rather than of the class attribute. A
    // receipt's column lines up because of the declarations a browser applies,
    // and a test that matched utility names instead would go green on a class
    // with no rule behind it and red on a rename that changed nothing — so this
    // holds whether the money face arrives as one utility or as two.
    for (const classList of new Set(figures.map((figure) => figure.className))) {
      const applied = appliedDeclarations(classList);
      expect(applied).toMatch(/font-family:\s*var\(--font-display\)/);
      expect(applied).toMatch(/(?:font-variant-numeric|--tw-numeric-spacing):\s*tabular-nums/);
    }
  });

  it('uses no physical direction utility anywhere in the rendered tree', () => {
    // src/__tests__/rtl.test.ts scans this file's source. This is the same rule
    // checked from the other end: whatever survived composition and tailwind-merge.
    const banned =
      /(?<!\w)(?:-?[pm][lr]-(?:\d|px|auto|\[)|text-(?:left|right)(?![\w-])|border-[lr](?![a-z])|rounded-[lr](?![a-z])|-?(?:left|right)-(?:\d|px|auto|full|\[))/;

    for (const variant of VARIANTS) {
      for (const locale of LOCALES) {
        const container = renderCard(
          <PriceCard quote={buildQuote(PLAIN)} variant={variant} locale={locale} now={LIVE_NOW} />,
        );
        for (const node of container.querySelectorAll('[class]')) {
          expect(node.className).not.toMatch(banned);
        }
        cleanup();
      }
    }
  });
});

// --- the shapes that break layouts --------------------------------------------

describe('the breakdowns that would break a hand-built layout', () => {
  it('renders a breakdown whose every line is folded, and claims nothing it cannot show', () => {
    const quote = buildQuote(ALL_HIDDEN);
    const container = renderCard(<PriceCard quote={quote} now={LIVE_NOW} />);

    // No rows at all, so the card makes no arithmetic claim it cannot back up.
    expect(container.querySelector('[data-price-card-lines]')).toBeNull();
    expect(moneyValue(summaryRow(container, 'total'))).toBe(quote.lockedTotal);
    expect(moneyValue(headline(container))).toBe(quote.lockedTotal);
    expect(container.querySelectorAll('[data-price-card-reasons] > li')).toHaveLength(
      ADJUSTMENT_REASONS.length,
    );
  });

  it('renders a single-line breakdown', () => {
    const quote = buildQuote(SINGLE);
    const container = renderCard(<PriceCard quote={quote} now={LIVE_NOW} />);
    const rows = lineRows(container);
    expect(rows).toHaveLength(1);
    expect(moneyValue(rows[0]?.querySelector('dd') ?? null)).toBe(quote.lockedTotal);
  });

  it('renders the schema’s maximum of sixty lines, and they still sum exactly', () => {
    const quote = buildQuote(MAXIMAL);
    const container = renderCard(<PriceCard quote={quote} now={LIVE_NOW} />);
    const rows = lineRows(container);
    expect(rows).toHaveLength(60);
    expect(rows.reduce((acc, row) => acc + moneyValue(row.querySelector('dd')), 0)).toBe(
      quote.lockedTotal,
    );
  });

  it('lets a long label wrap rather than truncating a price line', () => {
    // Truncating is the tempting fix and it is the wrong one: a customer who
    // cannot read what a line is for cannot check the price is right.
    const container = renderCard(
      <PriceCard quote={buildQuote(MAXIMAL)} locale="en" now={LIVE_NOW} />,
    );
    const row = lineRows(container).find((node) => node.dataset['lineKey'] === 'item.7');
    expect(row?.querySelector('dt')?.className).toContain('min-w-0');
    expect(row?.querySelector('dt')?.className).not.toContain('truncate');
    expect(plain(row?.textContent ?? '')).toContain('without breaking the row layout');
  });
});

// --- copy, locale and the call to action --------------------------------------

describe('every word comes from the quote or from the locale, never from a literal', () => {
  it('labels each line from the quote, in the reader’s language', () => {
    const hebrew = renderCard(<PriceCard quote={buildQuote(PLAIN)} locale="he" now={LIVE_NOW} />);
    expect(textOf(hebrew)).toContain('זמן עבודה');
    expect(textOf(hebrew)).not.toContain('Working time');
    cleanup();

    const english = renderCard(<PriceCard quote={buildQuote(PLAIN)} locale="en" now={LIVE_NOW} />);
    expect(textOf(english)).toContain('Working time');
    expect(textOf(english)).not.toContain('זמן עבודה');
  });

  it('never substitutes Hebrew detail into an English surface', () => {
    // The distance line carries detailHe and no detailEn. Falling back would put
    // Hebrew onto a foreign client's invoice; the honest answer is silence.
    const container = renderCard(
      <PriceCard quote={buildQuote(PLAIN)} locale="en" now={LIVE_NOW} />,
    );
    const row = lineRows(container).find((node) => node.dataset['lineKey'] === 'distance');
    expect(plain(row?.querySelector('dt')?.textContent ?? '')).toBe('Distance');
    expect(textOf(container)).not.toContain('ק״מ');
  });

  it('follows the surrounding provider, and lets the prop override it', () => {
    const inherited = renderCard(
      <DirectionProvider locale="en">
        <PriceCard quote={buildQuote(PLAIN)} now={LIVE_NOW} />
      </DirectionProvider>,
    );
    expect(textOf(inherited)).toContain(PRICE_CARD_COPY.lockedTitle.en);
    cleanup();

    const overridden = renderCard(
      <DirectionProvider locale="en">
        <PriceCard quote={buildQuote(PLAIN)} locale="he" now={LIVE_NOW} />
      </DirectionProvider>,
    );
    expect(textOf(overridden)).toContain(PRICE_CARD_COPY.lockedTitle.he);
  });

  it('defaults to Hebrew when nobody wrapped anything', () => {
    const container = renderCard(<PriceCard quote={buildQuote(PLAIN)} now={LIVE_NOW} />);
    expect(textOf(container)).toContain(PRICE_CARD_COPY.lockedTitle.he);
  });
});

describe('the call to action', () => {
  it('exists on the booking card and nowhere else', () => {
    for (const variant of VARIANTS) {
      const container = renderCard(
        <PriceCard quote={buildQuote(PLAIN)} variant={variant} now={LIVE_NOW} />,
      );
      const cta = container.querySelector('[data-price-card-cta]');
      expect(Boolean(cta)).toBe(priceCardSurfaces[variant].cta);
      cleanup();
    }
  });

  it('clears the tap-target floor the plan asks for', () => {
    const container = renderCard(<PriceCard quote={buildQuote(PLAIN)} now={LIVE_NOW} />);
    const cta = container.querySelector('[data-price-card-cta]');
    // Resolved through the compiled stylesheet: the CTA that carries the whole
    // promise must actually be 64px tall, not merely mention the number.
    expect(resolvedMinHeightPx(cta?.className ?? '')).toBe(controlHeightsPx.xl);
  });

  it('books when pressed, and does nothing once the lock has lapsed', () => {
    let booked = 0;
    const quote = buildQuote(PLAIN);

    const live = renderCard(
      <PriceCard quote={quote} now={LIVE_NOW} onBook={() => (booked += 1)} />,
    );
    const liveCta = live.querySelector('[data-price-card-cta]');
    if (liveCta) fireEvent.click(liveCta);
    expect(booked).toBe(1);
    cleanup();

    const lapsed = renderCard(
      <PriceCard quote={quote} now={LAPSED_NOW} onBook={() => (booked += 1)} />,
    );
    const lapsedCta = lapsed.querySelector('[data-price-card-cta]');
    if (lapsedCta) fireEvent.click(lapsedCta);
    expect(booked).toBe(1);
  });

  it('takes the app’s own verb when the app has one', () => {
    const container = renderCard(
      <PriceCard quote={buildQuote(PLAIN)} now={LIVE_NOW} ctaLabel="לנעול ולהזמין" />,
    );
    expect(textOf(container)).toContain('לנעול ולהזמין');
    expect(textOf(container)).not.toContain(PRICE_CARD_COPY.book.he);
  });
});

// --- the surface table --------------------------------------------------------

describe('the four surfaces the plan names', () => {
  it('are configured exactly once each, with nothing left over', () => {
    expect(Object.keys(priceCardSurfaces).sort()).toEqual([...VARIANTS].sort());
    expect(new Set(VARIANTS).size).toBe(VARIANTS.length);
  });

  it('agree on which figure is the headline', () => {
    const quote = buildQuote(PLAIN);
    for (const variant of VARIANTS) {
      const container = renderCard(<PriceCard quote={quote} variant={variant} now={LIVE_NOW} />);
      const expected: Agorot =
        priceCardSurfaces[variant].headline === 'driver_payout'
          ? quote.driverPayout
          : quote.lockedTotal;
      expect(moneyValue(headline(container))).toBe(expected);
      cleanup();
    }
  });

  it('agree on which of them may still state the terms of the price', () => {
    // The same shape as the call-to-action assertion below: every element of
    // this card is a per-surface decision, and the adjustment block was the one
    // that used to render everywhere regardless.
    for (const variant of VARIANTS) {
      const container = renderCard(
        <PriceCard quote={buildQuote(PLAIN)} variant={variant} now={LIVE_NOW} />,
      );
      const block = container.querySelector('[data-price-card-reasons]');
      expect(Boolean(block)).toBe(priceCardSurfaces[variant].adjustments);
      cleanup();
    }
  });

  it('marks itself, so a screenshot in a bug report says which surface it is', () => {
    for (const variant of VARIANTS) {
      const container = renderCard(
        <PriceCard quote={buildQuote(PLAIN)} variant={variant} now={LIVE_NOW} />,
      );
      expect(card(container).dataset['variant']).toBe(variant satisfies PriceCardVariant);
      cleanup();
    }
  });

  it('passes a caller’s attributes and class through to the surface', () => {
    const container = renderCard(
      <PriceCard
        quote={buildQuote(PLAIN)}
        now={LIVE_NOW}
        id="price-lock"
        className="bg-paper"
        data-testid="lock"
      />,
    );
    const root = card(container);
    expect(root.id).toBe('price-lock');
    expect(root.getAttribute('data-testid')).toBe('lock');
    expect(root.className).toContain('bg-paper');
    expect(root.className).not.toContain('bg-card');
  });
});
