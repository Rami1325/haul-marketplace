'use client';

import {
  ADJUSTMENT_REASONS,
  AdjustmentReason,
  IANA_TIMEZONE,
  addVat,
  agorot,
  formatBps,
  isQuoteExpired,
  israeliDateKey,
  localised,
  type Agorot,
  type Locale,
  type PriceBreakdown,
  type PriceLine,
  type Quote,
} from '@haul/types';
import { useId, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { variants } from '../lib/variants.js';
import { Button } from './button.js';
import { Card } from './card.js';
import { useDirection } from './direction.js';
import { Money } from './money.js';

/**
 * ---------------------------------------------------------------------------
 * Price Card — the signature object
 * ---------------------------------------------------------------------------
 * HAUL sells one sentence: the number you saw is the number you pay. This is the
 * component that says it. It is the same component on the booking confirmation,
 * on the driver's offer, on the receipt and on the B2B invoice, and that is the
 * whole point — four separately authored renderings of a `Quote` are four
 * chances for a receipt to disagree with the screen that took the money, and the
 * disagreement always surfaces on the day a customer is already angry. One
 * module, four surfaces, one arithmetic.
 *
 * ## Why the amounts on screen are not the amounts on the object
 *
 * Two facts about this product collide here, and reconciling them is most of
 * what this file does.
 *
 * The first is that a `PriceLine` may be invisible. `isVisible: false` is how a
 * demand factor is folded into the total without ever appearing as a line, and
 * the pricing engine relies on it — the codebase asserts elsewhere that such a
 * line is never labelled "surge", and the only way to keep that promise is to
 * not itemise it at all. The second is locked decision #8: Israeli consumer
 * prices are displayed VAT-inclusive. So the object carries net amounts, some of
 * which must not be shown, and the customer must see gross amounts, all of which
 * must add up.
 *
 * Rendering `line.amount` verbatim satisfies neither. The visible lines would
 * sum to less than `netSubtotal`, the customer would be looking at pre-VAT
 * figures beside a VAT-inclusive total, and the receipt would not add up in
 * either direction. A receipt that does not add up is the exact failure this
 * product exists to prevent, so the displayed figures are derived instead: each
 * visible line is grossed up on its own terms, the remainder — the folded lines
 * plus VAT rounding drift — is apportioned across them in proportion to their
 * size, and the apportionment is exact to the agora by construction. What the
 * customer adds up is what the customer pays, always, with no line named after
 * something we are unwilling to defend.
 *
 * The remainder is deliberately spread across the *positive* lines only. A promo
 * is a fixed promise — ₪50 off means ₪50 off — and a discount that drifted by an
 * agora because demand was high that evening would be the pettiest possible
 * broken promise.
 *
 * ## The four surfaces differ in what they are allowed to say
 *
 * The **booking** card is the plan's own layout: one enormous locked number, the
 * lines that make it up, the four things that may change it, and the button.
 *
 * The **offer** card is the driver's, and it shows `driverPayout` — never
 * `lockedTotal`. That is not a matter of hiding one figure, because per-line
 * amounts sum to the customer's total and a driver with a calculator would
 * recover it in seconds. So the offer states no amounts at all beside the lines:
 * it renders them as what the job *involves* — two flights, no lift, an hour of
 * carrying — which is the information a driver actually needs before accepting,
 * and it is a list rather than a description list because there are no values to
 * pair the names with. The one number on that surface is the payout.
 *
 * The **receipt** is the booking card in the past tense, and a price in the past
 * tense has no terms left that could move it.
 *
 * The **invoice** states net per line rather than gross, and itemises the
 * net/VAT/gross triplet rather than mentioning VAT in passing. A חשבונית מס is
 * read by a business that reclaims the VAT, so the net figures are the ones it
 * needs; the consumer surfaces are read by someone who only cares what leaves
 * their account. Same apportionment, run in net space instead of gross.
 *
 * ## Expiry, and where it means anything
 *
 * A lapsed lock still rendering as locked is the worst thing this component
 * could do, so on the surfaces where a price is still on offer the expiry is
 * carried by four channels at once and only one of them is colour: the heading
 * changes wording, a sentence states the lapse and the time it happened, the
 * booking button goes disabled, and the amber is withdrawn from the figure
 * entirely. Someone reading this in sunlight, in greyscale, or with a screen
 * reader gets the same answer.
 *
 * It is honoured on `booking` and `offer` and deliberately not on `receipt` and
 * `invoice`. Every quote behind a receipt has expired — it expired the moment
 * the job it priced began — and a receipt announcing that the price it records
 * is no longer valid would be nonsense that trains people to ignore the warning
 * where it counts.
 *
 * ## A description list, not a table
 *
 * The breakdown is name/value pairs, so it is a `<dl>`. A table would be the
 * other defensible choice and it is the wrong one: a table advertises a column
 * axis that does not exist here, obliges a caption and header cells that carry no
 * information, and makes a screen reader announce grid coordinates around every
 * figure. What a screen-reader user needs is "זמן עבודה, ₪80.24" as one
 * associated pair, which is precisely what a term and its definition are. The
 * per-line detail sits inside the `<dt>` so it is part of the term rather than a
 * stray phrase between two rows, and the separator between them is hidden from
 * assistive technology because a middle dot is punctuation for the eye only.
 *
 * ## Amber appears exactly once
 *
 * The palette reserves amber for money and attention, and a rule that admits
 * exceptions stops being a rule. On this card there is one amber element and it
 * is the figure the whole company's positioning rests on — not the heading above
 * it, not the adjustment list, not the button. Everything else is ink. That is
 * checked by test rather than asked for in review, because the first second
 * amber costs nothing on the day it ships and quietly ends the reason the price
 * is the loudest thing on the screen.
 *
 * ## The copy lives here, unusually
 *
 * Every other primitive in this package refuses to ship a user-facing string,
 * because a Hebrew-first product cannot have English defaults leaking out of its
 * design system. This module is the exception and the exception is narrow: the
 * words below are not chrome, they are the promise. "רק אלה משנים את המחיר" and
 * the four sentences under it are a commitment the company makes beside a price,
 * and they are generated from `ADJUSTMENT_REASONS` so that showing three of them
 * is not a thing anyone can do by accident and a fifth reason added to the enum
 * appears on every surface that states them without a single screen being
 * edited. Retyping those four sentences per app is how a product ends up
 * promising different things in two places.
 *
 * They are stated where the price can still move, and nowhere else. A receipt
 * and a חשבונית מס both record money that has already changed hands, and
 * present-tense terms for a settled price are noise on the receipt and, on a
 * document a business files to reclaim its VAT, a list of future conditions with
 * no place on it at all. That is `SurfaceRules.adjustments`, which is where
 * every other per-surface decision on this card lives too.
 *
 * The numbers inside two of them — how long we wait, how late a reschedule
 * costs — are rate-card values that vary by city, so they are a prop. Absent
 * them the sentences state the terms generically rather than inventing a figure
 * the design system has no business knowing.
 * ---------------------------------------------------------------------------
 */

interface Phrase {
  readonly he: string;
  readonly en: string;
}

/**
 * Everything this component says in its own voice. Exported so it can be walked
 * by a test — the assertion that the word "surge" never reaches a screen is
 * worth more as an exhaustive scan of the vocabulary than as a habit.
 */
export const PRICE_CARD_COPY = {
  lockedTitle: { he: 'המחיר נעול', en: 'Price locked' },
  payoutTitle: { he: 'התשלום שלך', en: 'Your payout' },
  paidTitle: { he: 'שולם', en: 'Paid' },
  invoiceTitle: { he: 'חשבונית מס', en: 'Tax invoice' },
  expiredTitle: { he: 'תוקף המחיר פג', en: 'This price has expired' },

  breakdownLabel: { he: 'פירוט המחיר', en: 'Price breakdown' },
  workLabel: { he: 'מה כוללת ההובלה', en: 'What this move involves' },
  summaryLabel: { he: 'סיכום', en: 'Summary' },

  totalToday: { he: 'סה״כ היום', en: 'Total today' },
  totalPaid: { he: 'סה״כ ששולם', en: 'Total paid' },
  totalDue: { he: 'סה״כ לתשלום', en: 'Total due' },
  netSubtotal: { he: 'לפני מע״מ', en: 'Before VAT' },

  onlyThese: { he: 'רק אלה משנים את המחיר', en: 'Only these change the price' },
  book: { he: 'להזמנת ההובלה', en: 'Book this move' },
} as const satisfies Readonly<Record<string, Phrase>>;

/** "מע״מ 18%" / "VAT 18%". The rate comes off the breakdown, never a constant here. */
function vatPhrase(rate: string): Phrase {
  return { he: `מע״מ ${rate}`, en: `VAT ${rate}` };
}

/** The same figure on a consumer surface, where it is already inside the total. */
function vatIncludedPhrase(rate: string): Phrase {
  return { he: `כולל מע״מ ${rate}`, en: `Includes VAT ${rate}` };
}

function validUntilPhrase(clock: string): Phrase {
  return { he: `בתוקף עד ${clock}`, en: `Valid until ${clock}` };
}

function expiredAtPhrase(clock: string): Phrase {
  return {
    he: `תוקף המחיר פג ב-${clock}. אפשר לקבל הצעת מחיר מעודכנת.`,
    en: `This price expired at ${clock}. Ask for an updated quote.`,
  };
}

// --- the adjustment list ----------------------------------------------------

/**
 * The two figures that make the promise concrete. Both are city rate-card
 * values, which is why they arrive from outside: a design system that hardcoded
 * "15 minutes" would keep saying it in the city that changed it.
 */
export interface AdjustmentTerms {
  /** Waiting time included in the locked price, in minutes. */
  readonly waitGraceMinutes: number;
  /** How close to the slot a reschedule starts costing, in hours. */
  readonly rescheduleCutoffHours: number;
}

/**
 * Hebrew counts one, two and many differently, and the dual is not optional
 * politeness — "2 שעות" reads as machine translation where "שעתיים" reads as a
 * person wrote it. This is the smallest place that difference shows and it is
 * the one a customer reads while deciding whether to trust us.
 */
function minutesHe(count: number): string {
  if (count === 1) return 'דקה אחת';
  if (count === 2) return 'שתי דקות';
  return `${count} דקות`;
}

function hoursHe(count: number): string {
  if (count === 1) return 'שעה';
  if (count === 2) return 'שעתיים';
  return `${count} שעות`;
}

/**
 * "More than fifteen minutes" hangs on a one-letter preposition, and Hebrew
 * attaches that letter two different ways. Onto a word it goes straight on with
 * nothing between them — משתי דקות, משעה. Onto a figure set in digits the
 * Academy of the Hebrew Language puts a maqaf between the two scripts, the same
 * rule that gives המאה ה-12 and ב-DNA — so מ-15 דקות, מ-24 שעות.
 *
 * Which one applies is decided by `minutesHe` and `hoursHe` above, since they
 * spell one and two as words and everything else as a numeral. A sentence
 * template therefore cannot carry the preposition: whichever of the two forms it
 * hardcodes is broken Hebrew for exactly the counts the other form covers, and a
 * city is free to set a fifteen-minute grace and a two-hour cutoff, or a
 * one-minute grace and a twenty-four-hour one. So the preposition is attached
 * here, by the only code that can see which spelling it is attaching to.
 */
function fromHe(quantity: string): string {
  return /^\p{Nd}/u.test(quantity) ? `מ-${quantity}` : `מ${quantity}`;
}

function minutesEn(count: number): string {
  return count === 1 ? '1 minute' : `${count} minutes`;
}

function hoursEn(count: number): string {
  return count === 1 ? '1 hour' : `${count} hours`;
}

type ReasonPhrase = (terms: AdjustmentTerms | undefined) => string;

/**
 * Keyed off the enum itself, so a fifth reason is a compile error here before it
 * is a missing line on a screen. The wording is the plan's, verbatim where the
 * terms are known.
 */
const ADJUSTMENT_REASON_COPY = {
  [AdjustmentReason.AddedStop]: {
    he: () => 'אם תוסיפו עצירה בדרך',
    en: () => 'You add a stop',
  },
  [AdjustmentReason.UnlistedItems]: {
    he: () => 'אם יגיעו פריטים שלא היו ברשימה',
    en: () => "Items arrive that aren't on your list",
  },
  [AdjustmentReason.ExcessWaiting]: {
    he: (terms) =>
      terms === undefined
        ? 'אם נמתין מעבר לזמן ההמתנה הכלול'
        : `אם נמתין יותר ${fromHe(minutesHe(terms.waitGraceMinutes))}`,
    en: (terms) =>
      terms === undefined
        ? 'We wait longer than the included grace period'
        : `We wait more than ${minutesEn(terms.waitGraceMinutes)}`,
  },
  [AdjustmentReason.LateReschedule]: {
    he: (terms) =>
      terms === undefined
        ? 'אם תשנו את המועד בתוך חלון הביטול'
        : `אם תשנו את המועד פחות ${fromHe(hoursHe(terms.rescheduleCutoffHours))} לפני`,
    en: (terms) =>
      terms === undefined
        ? 'You reschedule inside the cutoff window'
        : `You reschedule inside ${hoursEn(terms.rescheduleCutoffHours)}`,
  },
} as const satisfies Readonly<Record<AdjustmentReason, { he: ReasonPhrase; en: ReasonPhrase }>>;

export function adjustmentReasonText(
  reason: AdjustmentReason,
  locale: Locale,
  terms?: AdjustmentTerms,
): string {
  return localised(locale, ADJUSTMENT_REASON_COPY[reason])(terms);
}

// --- displayed amounts ------------------------------------------------------

/** Whether a surface states its lines VAT-inclusive or net of VAT. */
export type DisplaySpace = 'gross' | 'net';

export interface DisplayedLine {
  readonly line: PriceLine;
  /** Restated in the surface's space. These sum to `displayedTotal` exactly. */
  readonly amount: Agorot;
}

export function displayedTotal(breakdown: PriceBreakdown, space: DisplaySpace): Agorot {
  return space === 'gross' ? breakdown.grossTotal : breakdown.netSubtotal;
}

/** The lines a customer is allowed to see. The rest are folded into the total. */
export function visibleLines(breakdown: PriceBreakdown): readonly PriceLine[] {
  return breakdown.lines.filter((line) => line.isVisible);
}

/**
 * Split `total` across `weights` so the parts sum to exactly `total`, with no
 * agora created or destroyed. `allocate()` in `@haul/types` does this already
 * and cannot be used: it rejects a negative total, and the quantity being spread
 * here is a difference that is routinely negative — a rounding line that took
 * the price *down* to a clean figure, for instance.
 *
 * The remainder after truncation goes to the largest fractional parts first, so
 * the correcting agora lands where it is least visible rather than always on the
 * first row.
 */
function apportion(total: number, weights: readonly number[]): number[] {
  const count = weights.length;
  if (count === 0) return [];
  if (total === 0) return new Array<number>(count).fill(0);

  const weightSum = weights.reduce((acc, weight) => acc + weight, 0);
  const exact = weights.map((weight) =>
    weightSum === 0 ? total / count : (total * weight) / weightSum,
  );

  const parts = exact.map((value) => Math.trunc(value));
  let residual = total - parts.reduce((acc, part) => acc + part, 0);
  const step = residual < 0 ? -1 : 1;

  const order = exact
    .map((value, index) => ({ index, fraction: Math.abs(value - Math.trunc(value)) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
    .map((entry) => entry.index);

  for (let cursor = 0; residual !== 0; cursor += 1) {
    const target = order[cursor % count];
    if (target === undefined) break;
    parts[target] = (parts[target] ?? 0) + step;
    residual -= step;
  }

  return parts;
}

/**
 * What each visible line says on screen. See the module header: the displayed
 * figures are derived rather than read off, because the object's lines are net
 * and some of them are folded, and neither of those may be visible to a customer
 * checking that the receipt adds up.
 */
export function displayedLines(
  breakdown: PriceBreakdown,
  space: DisplaySpace,
): readonly DisplayedLine[] {
  const shown = visibleLines(breakdown);
  if (shown.length === 0) return [];

  const stated = shown.map((line) =>
    space === 'gross' ? addVat(line.amount, breakdown.vatRate).gross : line.amount,
  );
  const target = displayedTotal(breakdown, space);
  const remainder = target - stated.reduce((acc, amount) => acc + amount, 0);
  const share = apportion(
    remainder,
    stated.map((amount) => Math.max(amount, 0)),
  );

  return shown.map((line, index) => ({
    line,
    amount: agorot((stated[index] ?? 0) + (share[index] ?? 0)),
  }));
}

// --- the surfaces -----------------------------------------------------------

const PRICE_CARD_OPTIONS = {
  variant: {
    booking: 'gap-6',
    offer: 'gap-6',
    receipt: 'gap-5',
    invoice: 'gap-5',
  },
  status: {
    live: '',
    /**
     * A rust edge rather than a rust ground. An error tint is a boundary nobody
     * can see at 1.2:1; the edge clears 3:1 in both themes, and the wording
     * inside carries the state for anyone who cannot see either.
     */
    expired: 'border-rust',
  },
} as const;

export const priceCardVariants = variants({
  base: 'flex flex-col',
  variants: PRICE_CARD_OPTIONS,
  defaults: { variant: 'booking', status: 'live' },
});

export type PriceCardVariant = keyof (typeof PRICE_CARD_OPTIONS)['variant'];

export const priceCardVariantNames = [
  'booking',
  'offer',
  'receipt',
  'invoice',
] as const satisfies readonly PriceCardVariant[];

interface SurfaceRules {
  /** The largest figure on the card. The driver's surface never states the customer's. */
  readonly headline: 'locked_total' | 'driver_payout';
  /** Amounts beside each line, and the space they are stated in. */
  readonly lineAmounts: DisplaySpace | 'none';
  /** The tax figures: itemised as a tax document, folded into a note, or absent. */
  readonly tax: 'itemised' | 'note' | 'none';
  /** Whether a lapsed lock changes this surface. A receipt records a price that was honoured. */
  readonly expires: boolean;
  readonly cta: boolean;
  /**
   * Whether this surface states the four things that may change the price. Only
   * where the price can still move: a receipt and a tax invoice record one that
   * already has, and terms in the present tense beside a settled figure read as
   * a threat rather than a promise.
   */
  readonly adjustments: boolean;
  readonly elevation: 'flat' | 'raised';
  readonly title: Phrase;
  readonly totalLabel: Phrase;
}

export const priceCardSurfaces = {
  booking: {
    headline: 'locked_total',
    lineAmounts: 'gross',
    tax: 'note',
    expires: true,
    cta: true,
    adjustments: true,
    elevation: 'raised',
    title: PRICE_CARD_COPY.lockedTitle,
    totalLabel: PRICE_CARD_COPY.totalToday,
  },
  offer: {
    headline: 'driver_payout',
    lineAmounts: 'none',
    tax: 'none',
    expires: true,
    cta: false,
    adjustments: true,
    elevation: 'raised',
    title: PRICE_CARD_COPY.payoutTitle,
    totalLabel: PRICE_CARD_COPY.totalToday,
  },
  receipt: {
    headline: 'locked_total',
    lineAmounts: 'gross',
    tax: 'note',
    expires: false,
    cta: false,
    adjustments: false,
    elevation: 'flat',
    title: PRICE_CARD_COPY.paidTitle,
    totalLabel: PRICE_CARD_COPY.totalPaid,
  },
  invoice: {
    headline: 'locked_total',
    lineAmounts: 'net',
    tax: 'itemised',
    expires: false,
    cta: false,
    adjustments: false,
    elevation: 'flat',
    title: PRICE_CARD_COPY.invoiceTitle,
    totalLabel: PRICE_CARD_COPY.totalDue,
  },
} as const satisfies Readonly<Record<PriceCardVariant, SurfaceRules>>;

/**
 * The one amber element on the card, and what it becomes when the lock has
 * lapsed. `ink-3` is a tertiary tone the contrast rules bar from body copy, and
 * it is admissible here for exactly one reason: at step-4 this is large text.
 */
const lockedTotalVariants = variants({
  base: '',
  variants: {
    status: {
      live: 'text-hivis',
      expired: 'text-ink-3',
    },
  },
  defaults: { status: 'live' },
});

// --- the component ----------------------------------------------------------

export interface PriceCardProps extends Omit<ComponentProps<'div'>, 'children'> {
  quote: Quote;
  variant?: PriceCardVariant;
  /** Defaults to the surrounding `DirectionProvider`, i.e. Hebrew. */
  locale?: Locale;
  /**
   * The clock, injected. Reading `Date.now()` during render makes the server and
   * the client disagree about whether a lock is still live, which is the one
   * disagreement this component must never have.
   */
  now?: Date;
  /**
   * City rate-card figures for the adjustment sentences. Omitted, they state the
   * terms generically. Unread on the surfaces that state no terms at all.
   */
  terms?: AdjustmentTerms;
  onBook?: () => void;
  /** Overrides the booking label. The app's locale layer owns its own verbs. */
  ctaLabel?: ReactNode;
}

export function PriceCard({
  quote,
  variant = 'booking',
  locale,
  now,
  terms,
  onBook,
  ctaLabel,
  className,
  ...rest
}: PriceCardProps): ReactElement {
  const { locale: contextLocale } = useDirection();
  const active = locale ?? contextLocale;
  const surface: SurfaceRules = priceCardSurfaces[variant];

  const reference = now ?? new Date();
  const expired = surface.expires && isQuoteExpired(quote, reference);
  const status = expired ? 'expired' : 'live';

  const id = useId();
  const titleId = `${id}-title`;
  const statusId = `${id}-status`;
  const reasonsId = `${id}-reasons`;

  const { breakdown } = quote;
  const space: DisplaySpace = surface.lineAmounts === 'net' ? 'net' : 'gross';
  const rows = displayedLines(breakdown, space);
  const headline = surface.headline === 'driver_payout' ? quote.driverPayout : quote.lockedTotal;
  const vatRate = formatBps(breakdown.vatRate);

  const clock = formatExpiry(quote.expiresAt, reference, active);
  const statusText = !surface.expires
    ? null
    : localised(active, expired ? expiredAtPhrase(clock) : validUntilPhrase(clock));

  return (
    <Card
      {...rest}
      role="group"
      aria-labelledby={titleId}
      data-variant={variant}
      data-expired={expired ? '' : undefined}
      padding="roomy"
      elevation={surface.elevation}
      className={priceCardVariants({ variant, status, className })}
    >
      <div className="flex flex-col gap-1">
        <p id={titleId} className="text-step-0 font-semibold text-ink-2">
          {localised(active, expired ? PRICE_CARD_COPY.expiredTitle : surface.title)}
        </p>
        <p
          data-price-card-total=""
          className="flex items-baseline"
          aria-describedby={statusText === null ? undefined : statusId}
        >
          <Money
            amount={headline}
            locale={active}
            size="total"
            className={lockedTotalVariants({ status })}
          />
        </p>
        {statusText === null ? null : (
          <p
            id={statusId}
            data-price-card-status=""
            className={expired ? 'text-step-0 font-semibold text-rust' : 'text-step-0 text-ink-2'}
          >
            {statusText}
          </p>
        )}
      </div>

      {rows.length === 0 ? null : surface.lineAmounts === 'none' ? (
        <ul
          data-price-card-lines=""
          aria-label={localised(active, PRICE_CARD_COPY.workLabel)}
          className="flex flex-col gap-2 border-t border-line pt-5 text-step-0"
        >
          {rows.map(({ line }) => (
            <li key={line.key} data-line-key={line.key} className="min-w-0">
              <LineText line={line} locale={active} />
            </li>
          ))}
        </ul>
      ) : (
        <dl
          data-price-card-lines=""
          aria-label={localised(active, PRICE_CARD_COPY.breakdownLabel)}
          className="flex flex-col gap-3 border-t border-line pt-5 text-step-0"
        >
          {rows.map(({ line, amount }) => (
            <div
              key={line.key}
              data-line-key={line.key}
              className="flex items-baseline justify-between gap-4"
            >
              <dt className="min-w-0 text-ink">
                <LineText line={line} locale={active} />
              </dt>
              <dd className="shrink-0">
                <Money amount={amount} locale={active} size="line" />
              </dd>
            </div>
          ))}
        </dl>
      )}

      {surface.tax === 'none' ? null : (
        <dl
          data-price-card-summary=""
          aria-label={localised(active, PRICE_CARD_COPY.summaryLabel)}
          className="flex flex-col gap-2 border-t border-line-2 pt-4 text-step-0"
        >
          {surface.tax === 'itemised' ? (
            <SummaryRow
              summaryKey="net"
              label={localised(active, PRICE_CARD_COPY.netSubtotal)}
              amount={breakdown.netSubtotal}
              locale={active}
            />
          ) : null}
          {surface.tax === 'itemised' ? (
            <>
              <SummaryRow
                summaryKey="vat"
                label={localised(active, vatPhrase(vatRate))}
                amount={breakdown.vat}
                locale={active}
              />
              <SummaryRow
                summaryKey="total"
                label={localised(active, surface.totalLabel)}
                amount={breakdown.grossTotal}
                locale={active}
                emphasis
              />
            </>
          ) : (
            <>
              <SummaryRow
                summaryKey="total"
                label={localised(active, surface.totalLabel)}
                amount={breakdown.grossTotal}
                locale={active}
                emphasis
              />
              <SummaryRow
                summaryKey="vat"
                label={localised(active, vatIncludedPhrase(vatRate))}
                amount={breakdown.vat}
                locale={active}
              />
            </>
          )}
        </dl>
      )}

      {surface.adjustments ? (
        <div className="flex flex-col gap-2 border-t border-line pt-5">
          <p id={reasonsId} className="text-step-0 font-semibold text-ink">
            {localised(active, PRICE_CARD_COPY.onlyThese)}
          </p>
          <ul
            data-price-card-reasons=""
            aria-labelledby={reasonsId}
            className="flex flex-col gap-1 ps-5 text-step-0 text-ink-2"
          >
            {ADJUSTMENT_REASONS.map((reason) => (
              <li key={reason} data-reason={reason}>
                {adjustmentReasonText(reason, active, terms)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {surface.cta ? (
        <Button
          size="xl"
          tone="route"
          className="w-full"
          disabled={expired}
          onClick={onBook}
          data-price-card-cta=""
        >
          {ctaLabel ?? localised(active, PRICE_CARD_COPY.book)}
        </Button>
      ) : null}
    </Card>
  );
}

/**
 * The label and, when the engine supplied one in this language, the reason the
 * line exists. There is no fallback from English to Hebrew: a missing `detailEn`
 * is a gap in the engine's copy, and substituting the Hebrew would put a
 * language the reader did not ask for onto a foreign client's invoice.
 */
function LineText({ line, locale }: { line: PriceLine; locale: Locale }): ReactElement {
  const label = localised(locale, { he: line.labelHe, en: line.labelEn });
  const detail = localised(locale, { he: line.detailHe, en: line.detailEn });

  return (
    <>
      <span className="font-medium">{label}</span>
      {detail === null || detail === '' ? null : (
        <>
          <span aria-hidden="true" className="text-ink-2">
            {' · '}
          </span>
          <span className="text-ink-2">{detail}</span>
        </>
      )}
    </>
  );
}

function SummaryRow({
  summaryKey,
  label,
  amount,
  locale,
  emphasis = false,
}: {
  summaryKey: string;
  label: string;
  amount: Agorot;
  locale: Locale;
  emphasis?: boolean;
}): ReactElement {
  return (
    <div data-summary-key={summaryKey} className="flex items-baseline justify-between gap-4">
      <dt className={emphasis ? 'min-w-0 font-semibold text-ink' : 'min-w-0 text-ink-2'}>
        {/* The rate is a Latin run inside Hebrew prose; isolate it or the % migrates. */}
        <bdi>{label}</bdi>
      </dt>
      <dd className="shrink-0">
        <Money amount={amount} locale={locale} size={emphasis ? 'subtotal' : 'line'} />
      </dd>
    </div>
  );
}

/**
 * Jerusalem wall clock, because that is where the truck is and where the
 * customer is standing — a device set to another zone must not be told the lock
 * expires at a time nobody in Israel would recognise. The date joins the time
 * only when the expiry is not today, since a lock that lasts fifteen minutes
 * does not need a calendar beside it.
 */
function formatExpiry(expiresAt: Date, reference: Date, locale: Locale): string {
  const sameDay = israeliDateKey(expiresAt) === israeliDateKey(reference);
  return new Intl.DateTimeFormat(localised(locale, { he: 'he-IL', en: 'en-IL' }), {
    timeZone: IANA_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(sameDay ? null : { day: 'numeric', month: 'numeric' }),
  }).format(expiresAt);
}
