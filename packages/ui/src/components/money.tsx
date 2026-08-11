'use client';

import { agorot, formatILS, localised, type Agorot, type Locale } from '@haul/types';
import type { ComponentProps, ReactElement } from 'react';
import { variants, type VariantProps } from '../lib/variants.js';
import { tabularFiguresClass } from '../tokens/type.js';
import { useDirection } from './direction.js';

/**
 * ---------------------------------------------------------------------------
 * Money
 * ---------------------------------------------------------------------------
 * The one place in the product where an amount becomes characters on a screen.
 * Everything else — the engine, the ledger, the database — carries integer
 * agorot, and the moment two components each decide for themselves how to turn
 * that into a string is the moment a quote and its receipt disagree over a
 * rounding. So the formatting is not reimplemented here at all: `formatILS`
 * from `@haul/types` produces the string and this module never touches what it
 * returns. That restraint is load-bearing, and the rest of this comment is why.
 *
 * ## The string is not just digits
 *
 * ICU does not hand back `248.00 ₪`. For Hebrew it returns
 * `U+200F 248.00 U+00A0 U+200F ₪`, and for a negative it inserts a *second*
 * mark: `U+200F U+200E -50.00 U+00A0 U+200F ₪`. Those invisible characters are
 * the entire bidi contract. Resolve the Hebrew negative as ICU wrote it and it
 * renders `₪ -50.00`, with the sign against the digits where a reader expects
 * it. Strip the U+200E — trim it, normalise it, rebuild the sign by hand
 * because a hyphen looked too small — and the same amount renders `₪ 50.00-`,
 * with the minus flung to the far end of the run. There is a test that resolves
 * both by the Unicode algorithm and asserts exactly that, because "don't touch
 * the string" is an instruction nobody obeys without knowing what it costs.
 *
 * ## The one option that may not round
 *
 * `showDecimals={false}` reads like a display switch, and `formatILS` implements
 * it with `maximumFractionDigits: 0` — which rounds. Asked for whole shekels on
 * ₪248.60 it returns ₪249, a figure nobody will ever be charged, rendered at
 * 3.2rem on the screen whose entire job is to promise that the number you were
 * shown is the number you pay. Nothing about the misuse looks like a bug at the
 * call site either: it is what anyone reading "whole shekels only" in a design
 * reaches for.
 *
 * So the option asks rather than instructs. Decimals are dropped only when they
 * are already zero, and on any other amount the request is refused and the exact
 * figure rendered. Throwing was the alternative and it is the worse one here: an
 * amount is data, it arrives from a rate card an operator edits and from an
 * engine that divides, and a Price Card that crashes on ₪248.60 protects nobody.
 * Refusing is invisible in the case the option was written for and truthful in
 * the case it was not, which is the correct trade for a component that is only
 * ever allowed to be wrong in one direction.
 *
 * ## Isolation, not a forced direction
 *
 * An amount dropped into Hebrew prose is a run of neutral and weak characters
 * next to strong RTL text, which is the classic way a currency symbol or a
 * leading minus ends up on the wrong side. The fix is to isolate the run, and
 * the element that means precisely that is `<bdi>`: isolated from the
 * surrounding paragraph, direction resolved from its own first strong
 * character. Hard-coding `dir="ltr"` instead would also stop the prose
 * interfering, and it would quietly override CLDR — Hebrew would render
 * `248.00 ₪` while English renders `₪248.00`, so the symbol would swap sides
 * when a user changed language. Left to resolve itself, the symbol lands on the
 * same side of the digits in both locales, which is the property a bilingual
 * product actually needs. The digits inside are LTR either way; that is what
 * being European numerals means and no markup is required to arrange it.
 *
 * `unicode-bidi: isolate` is also declared explicitly. `<bdi>` gets it from the
 * user-agent stylesheet, and a user-agent stylesheet is the wrong place for an
 * invariant a receipt depends on.
 *
 * ## One class, not three declarations
 *
 * Money is set in the display face because it is the only face we ship whose ten
 * digits already share one advance width with no OpenType feature applied, and
 * which contains ₪ U+20AA. That face, `font-variant-numeric: tabular-nums` and
 * `font-feature-settings: normal` are a single decision, so they are a single
 * class — `tabular`, generated into `theme.css` from `moneyFontFamily` itself.
 * Spelling the parts out at a call site is how a product ends up with four
 * spellings of one rule, two of which keep the old face on the day the token
 * moves. The third declaration is the one that exists nowhere else: Tailwind's
 * built-in `tabular-nums` sets `font-variant-numeric` and stops, and the
 * low-level `font-feature-settings` outranks it for the same feature, so an
 * ancestor that asked for `'pnum'` for its own reasons un-aligns every price
 * beneath it and nothing in the price's own class list explains why.
 *
 * The figures rule is a no-op on the face we ship and it is still declared: it
 * promotes the *fallback* stack to tabular on the day Heebo fails to load, which
 * is the only day it matters. See `tokens/type.ts` for the measurements and the
 * test that re-derives the choice from them.
 *
 * ## The locked total has to survive being enlarged
 *
 * `size="total"` is the enormous number the Price Card is built around, and a
 * figure that must never break mid-number cannot also be a fixed 3.2rem. Fixed,
 * it tracks the root font size and nothing else, so the customer who has turned
 * system text up — the customer most likely to be reading a price carefully —
 * gets ₪1,890.00 running past the edge of the card with nowhere to wrap and the
 * page scrolling sideways to find it.
 *
 * The size is therefore a clamp. The step-4 token is the ceiling, so nothing
 * about the design changes at ordinary settings; under it the figure is bounded
 * by the width of the box rather than by the type scale. `cqi` rather than `vw`
 * because the bound that matters is the card's and not the window's: with no
 * ancestor declaring `container-type: inline-size` the unit resolves against the
 * small viewport, which is the honest approximation until the Price Card
 * declares one, and becomes exact the moment it does. The floor keeps it a
 * headline inside a narrow column. `whitespace-nowrap` stays either way — a
 * price broken across two lines is worse than a price that shrank.
 *
 * ## Negative without colour
 *
 * A promo line is negative and the product may not lean on red to say so —
 * outdoors, on a driver's cracked screen, at 3% of the population's colour
 * vision. The sign is therefore carried by the text itself, always rendered,
 * always adjacent to the digits, in a face where it occupies a digit's width;
 * `data-sign` states it to anything that needs to react without re-deriving
 * `amount < 0`; and the assistive-technology path gets the word rather than the
 * glyph, since a hyphen is announced inconsistently across screen readers and a
 * discount that reads as a charge is the worst possible mistake for this
 * component to make.
 * ---------------------------------------------------------------------------
 */

/**
 * The whole of the money type treatment, in one name — re-exported from the
 * token layer, which owns it, rather than restated here. The other places a
 * figure is set (a numeric field's value, a quantity on a stepper) reach for the
 * same constant, so there is exactly one definition of what a figure looks like.
 */
export const MONEY_CLASS = tabularFiguresClass;

const moneyOptions = {
  size: {
    /**
     * The locked total. One enormous number, and the reason the Price Card
     * works — clamped rather than fixed so it cannot outgrow its card. See the
     * header; the token is the ceiling, not the size.
     */
    total:
      'text-[length:clamp(1.25rem,13cqi,var(--text-step-4))] leading-(--text-step-4--line-height) font-black tracking-tight',
    /** A section total — "Total today". Heavier than a line, quieter than the lock. */
    subtotal: 'text-step-1 font-bold',
    /** A breakdown row, a payout, an adjustment. The common case. */
    line: 'text-step-0 font-medium',
  },
} as const;

export const moneyVariants = variants({
  base: [MONEY_CLASS, 'whitespace-nowrap'],
  variants: moneyOptions,
  defaults: { size: 'line' },
});

export type MoneyVariantProps = VariantProps<typeof moneyOptions>;

export interface MoneyProps
  extends Omit<ComponentProps<'span'>, 'children' | keyof MoneyVariantProps>, MoneyVariantProps {
  /** Integer agorot. Never a float, never a pre-formatted string. */
  amount: Agorot;
  /** Defaults to the surrounding `DirectionProvider`, i.e. Hebrew. */
  locale?: Locale;
  /**
   * Ask for whole shekels — for a headline figure that is already round. It is
   * a request, not an instruction: an amount carrying agorot is rendered in
   * full regardless, because `formatILS` would otherwise round it into a number
   * the customer is not going to be charged. See the header.
   */
  showDecimals?: boolean;
}

export function Money({
  amount,
  locale,
  size,
  showDecimals = true,
  className,
  ...rest
}: MoneyProps): ReactElement {
  const { locale: contextLocale } = useDirection();
  const active = locale ?? contextLocale;

  const negative = amount < 0;
  // The refusal, in one line. Hiding decimals is only ever a display decision
  // when there are none to hide; anywhere else it is a rounding.
  const withDecimals = showDecimals || amount % 100 !== 0;
  const formatted = formatILS(amount, active, { showDecimals: withDecimals });

  // Spoken separately only when it changes the meaning. The word is unambiguous
  // in a way the glyph is not, and re-announcing every positive amount would
  // double the length of a receipt for no gain.
  const spoken = negative
    ? `${localised(active, { he: 'מינוס', en: 'minus' })} ${formatILS(
        agorot(Math.abs(amount)),
        active,
        { showDecimals: withDecimals },
      )}`
    : null;

  return (
    <span
      data-sign={negative ? 'negative' : 'positive'}
      className={moneyVariants({ size, className })}
      {...rest}
    >
      {spoken === null ? null : <span className="sr-only">{spoken}</span>}
      <bdi aria-hidden={negative ? true : undefined} className="[unicode-bidi:isolate]">
        {formatted}
      </bdi>
    </span>
  );
}
