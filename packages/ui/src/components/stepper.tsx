'use client';

import { localised, type Locale } from '@haul/types';
import { useId } from 'react';
import { cn } from '../lib/cn.js';
import { variants, type VariantProps } from '../lib/variants.js';
import { MIN_TAP_TARGET_PX, controlHeights } from '../tokens/size.js';
import { tabularFiguresClass } from '../tokens/type.js';
import { useDirection } from './direction.js';

/**
 * ---------------------------------------------------------------------------
 * Stepper
 * ---------------------------------------------------------------------------
 * Two jobs in the product: how many of an item are being moved (`3 × ארגז` in
 * the first-screen grid) and how many movers are coming. They look identical and
 * they are not the same control, so the API had to decide which of the
 * differences belong here.
 *
 * A `role="quantity" | "crew"` prop was the obvious move and is the wrong one.
 * The crew control's real distinguishing facts are that it starts at two and
 * stops at four — and neither of those is a design-system fact. A pair of movers
 * is a fleet decision that the rate card and the vehicle classes already own, and
 * baking it in here would mean a truck configuration change silently disagreeing
 * with the control that sets it. So bounds are the caller's, and what this
 * module owns is the mechanism: clamping, the refused edge, the announcement,
 * and the geometry.
 *
 * What genuinely differs between the two roles is language, so language is
 * props. "הוספת ארגז" and "צוות גדול יותר" are both correct and neither is a
 * template of the other; likewise the sentence a screen reader hears after a
 * change, which is `3 × ארגז` for an item and something else entirely for a
 * crew. Attempting to generate both from one string is how a Hebrew interface
 * ends up reading like machine translation.
 *
 * **The two default names are copy, so they follow the locale.** They are the
 * only strings this file authors, and a baked-in Hebrew default is a Hebrew bug
 * on an English screen in exactly the way an English default is an English bug
 * on a Hebrew one — the argument `button.tsx` makes, run in the other direction.
 * So they come from a `{he, en}` table resolved against the surrounding
 * `DirectionProvider`. The Hebrew is `הסרת` rather than `הפחתת` because you
 * remove a box, you do not reduce one, and it is a verbal noun in construct
 * state because that is the one Hebrew form that takes an arbitrary label
 * without having to agree with its gender or its number. It still cannot say
 * everything: `הוספת גודל צוות` is nonsense, which is what `addLabel` and
 * `removeLabel` are for. A generic default has to be idiomatic for the common
 * case; it cannot be idiomatic for every label a caller invents.
 *
 * **What is on screen is what the buttons operate on.** A caller's `value` goes
 * through the same clamp before it is rendered, not only on its way back out.
 * Displaying the prop and clamping the emission puts a number in front of a
 * customer that the control does not agree with: `2.5` for half a box, or a crew
 * control declared `min={2}` reading `0 מובילים` for the frame between mount and
 * the quote's own crew size arriving — with the minus already refusing and the
 * plus about to jump from 0 to 2, which reads as a broken control. Pressing `+`
 * adds one to the digit the person can see, and nothing else would make sense.
 *
 * The live region is the reason this is a component rather than two buttons.
 * Pressing `+` changes a number that is nowhere near the focus, so a screen
 * reader announces nothing at all — a blind customer pressing it four times
 * hears four clicks and has no idea whether the count is 4, 1, or unchanged
 * because the maximum was reached. The value is therefore a polite live region
 * that re-reads itself, and hitting the ceiling is signalled by the control
 * stating that it is unavailable rather than by a press that does nothing.
 *
 * **It states that with `aria-disabled`, never with the native attribute.**
 * Disabling the element that currently holds focus is how a browser is told to
 * drop focus to `<body>`, so a keyboard or switch user pressing `−` down to zero
 * loses their place and the next Tab restarts at the top of the document — in an
 * eleven-step flow, that is tabbing back down through every answer already
 * given. Inside a Sheet it is worse than tedious: the focus trap listens for Tab
 * on the panel it owns, and once focus is on `<body>` the trap never sees the
 * key, so the user tabs into the form behind the modal and operates controls
 * they cannot see — having done nothing more unusual than setting the crew size
 * to the maximum. Both buttons therefore stay focusable and stay in the tab
 * order for the whole life of the control, and the press is refused instead.
 * `disabled` from the caller works the same way and for the same reason: two
 * mechanisms for one meaning, in one control, is how the hazard comes back.
 *
 * The geometry is the other half. This is used one-handed, on a phone, by
 * someone standing in a half-packed room, and the failure mode is not missing a
 * button — it is hitting the *other* one, which silently changes the price in
 * the wrong direction. So the two targets are held a full target's width apart:
 * a thumb that misses by its own size still cannot reach the opposite control.
 * Both the target size and the separation come from the tap-target token and are
 * written as inline logical sizes, so they are asserted rather than asserted-in-
 * a-comment, and no restyle can shrink them by editing a class.
 * ---------------------------------------------------------------------------
 */

/**
 * The clear distance the value holds between the two buttons. Equal to one full
 * tap target on purpose — see the header: the miss distance we design against is
 * the size of the thing doing the missing.
 */
export const MIN_TARGET_SEPARATION_PX = MIN_TAP_TARGET_PX;

/**
 * The control counts whole things. There is no half a box and no half a mover,
 * so a fractional value from a caller is resolved rather than rendered, and the
 * result is always inside the range the caller declared.
 */
export function clampStepperValue(value: number, min: number, max: number): number {
  if (min > max) throw new RangeError(`clampStepperValue(): min ${min} exceeds max ${max}`);
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.round(value), min), max);
}

/** A default accessible name, built from whatever is being counted. */
type LabelPhrase = (label: string) => string;

/**
 * The only words this component authors. Exported so a test can walk the whole
 * vocabulary rather than sampling it — the assertion that an English surface
 * announces no Hebrew is worth more as an exhaustive scan than as a habit.
 */
export const STEPPER_COPY = {
  add: {
    he: (label) => `הוספת ${label}`,
    en: (label) => `Add ${label}`,
  },
  remove: {
    he: (label) => `הסרת ${label}`,
    en: (label) => `Remove ${label}`,
  },
} as const satisfies Readonly<Record<string, { he: LabelPhrase; en: LabelPhrase }>>;

const stepperConfig = {
  size: {
    /** The item grid, where a tile holds one of these under the item's name. */
    md: 'gap-2',
    /** A control that stands alone on a step: crew size, number of stops. */
    lg: 'gap-3',
  },
} as const;

export type StepperVariants = VariantProps<typeof stepperConfig>;

export type StepperSize = NonNullable<StepperVariants['size']>;

const stepperGroup = variants({
  // `border-ink-3`, not `border-line`: this is the only edge the control has —
  // the two buttons inside carry none — so it is a boundary that identifies a
  // control and owes 3:1, which `line` misses at 1.41:1 on card. Same call as
  // the field border in input.tsx, for the same reason.
  base: 'inline-flex items-center rounded-md border border-ink-3 bg-card ps-1 pe-1',
  variants: stepperConfig,
  defaults: { size: 'md' },
});

// The refused state is styled from `data-disabled`, not from `:disabled`, because
// the element it describes is deliberately still enabled — see the header. The
// hover and active overrides carry more variants than the states they cancel, so
// Tailwind sorts them after and the refusal stays visually honest under a press.
const stepperButton = cn(
  'flex items-center justify-center rounded-md font-display text-step-1 leading-none text-route',
  'transition-colors duration-quick hover:bg-paper-2 active:bg-line',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-route',
  'data-disabled:cursor-not-allowed data-disabled:text-ink-3',
  'data-disabled:hover:bg-transparent data-disabled:active:bg-transparent',
);

export interface StepperProps extends StepperVariants {
  /**
   * What is being counted — `ארגז`, `גודל צוות`. Plain text because it becomes
   * part of two button names and one spoken sentence, not just a rendered node.
   */
  label: string;
  value: number;
  onValueChange: (next: number) => void;
  /** Defaults to zero: removing the last one of an item is a legitimate answer. */
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /**
   * Off by default. In the item grid the tile already names the item and a
   * second visible copy reads as a stutter; the accessible name is there either
   * way.
   */
  showLabel?: boolean;
  addLabel?: string;
  removeLabel?: string;
  /**
   * The sentence read out after a change. The default is the item-grid phrasing
   * and it is deliberately the same in both languages: `×` is a sign rather than
   * a word, and the noun beside it is the caller's own `label`, already in
   * whatever language the surface is.
   */
  formatValue?: (value: number, label: string) => string;
  /** Defaults to the surrounding `DirectionProvider`, i.e. Hebrew. */
  locale?: Locale;
  id?: string;
  className?: string;
}

export function Stepper({
  label,
  value,
  onValueChange,
  min = 0,
  max = 99,
  step = 1,
  disabled = false,
  showLabel = false,
  addLabel,
  removeLabel,
  formatValue = (next, name) => `${next} × ${name}`,
  locale,
  size = 'md',
  id,
  className,
}: StepperProps) {
  const { locale: contextLocale } = useDirection();
  const active = locale ?? contextLocale;

  const generatedId = useId();
  const controlId = id ?? `${generatedId}-stepper`;
  const labelId = `${controlId}-label`;

  // Resolved before it is rendered, not only before it is emitted. Everything
  // below reads `shown`; the raw prop is consulted once, to decide whether a
  // press actually changes the caller's answer.
  const shown = clampStepperValue(value, min, max);
  const refuseRemove = disabled || shown <= min;
  const refuseAdd = disabled || shown >= max;

  const commit = (next: number) => {
    const clamped = clampStepperValue(next, min, max);
    if (clamped !== value) onValueChange(clamped);
  };

  // Square, and sized from the token rather than from a utility class so the
  // floor cannot be edited away in a restyle.
  const targetStyle = { minInlineSize: controlHeights[size], minBlockSize: controlHeights[size] };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <span id={labelId} className={showLabel ? 'font-body text-ink-2 text-start' : 'sr-only'}>
        {label}
      </span>

      <div role="group" aria-labelledby={labelId} className={stepperGroup({ size })}>
        <button
          type="button"
          onClick={() => {
            if (refuseRemove) return;
            commit(shown - step);
          }}
          aria-disabled={refuseRemove ? true : undefined}
          data-disabled={refuseRemove ? '' : undefined}
          aria-label={removeLabel ?? localised(active, STEPPER_COPY.remove)(label)}
          className={stepperButton}
          style={targetStyle}
        >
          <span aria-hidden="true">−</span>
        </button>

        <output
          id={`${controlId}-value`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={cn(
            tabularFiguresClass,
            'flex items-center justify-center text-step-1 font-bold text-ink',
          )}
          // The separation between the two targets, held by the value itself.
          style={{ minInlineSize: `${MIN_TARGET_SEPARATION_PX}px` }}
        >
          <span aria-hidden="true">{shown}</span>
          <span className="sr-only">{formatValue(shown, label)}</span>
        </output>

        <button
          type="button"
          onClick={() => {
            if (refuseAdd) return;
            commit(shown + step);
          }}
          aria-disabled={refuseAdd ? true : undefined}
          data-disabled={refuseAdd ? '' : undefined}
          aria-label={addLabel ?? localised(active, STEPPER_COPY.add)(label)}
          className={stepperButton}
          style={targetStyle}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
    </div>
  );
}
