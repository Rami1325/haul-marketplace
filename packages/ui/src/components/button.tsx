'use client';

import {
  useId,
  type ComponentPropsWithRef,
  type ElementType,
  type MouseEventHandler,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn.js';
import { percentLabel } from '../lib/percent.js';
import { variants, type VariantProps } from '../lib/variants.js';
import { useDirection } from './direction.js';

/**
 * ---------------------------------------------------------------------------
 * Button
 * ---------------------------------------------------------------------------
 * The most-used control in the product, and the one pressed under the worst
 * conditions this company will ever design for: standing in a half-packed
 * apartment, phone in one hand, sunlight on the screen, a truck already booked
 * for Sunday. Every decision below answers to that sentence rather than to what
 * photographs well in a component gallery.
 *
 * **There is no amber tone, and there will not be one.** Amber means money or
 * attention and nothing else; a button is neither — it is an action. The first
 * amber button is the change that costs nothing on the day it ships and quietly
 * ends the rule that makes the price the loudest thing on a screen. A button
 * that needs more weight than `route` does not need a brighter colour, it needs
 * to be the only button on the step.
 *
 * **Heights come from the size token**, which has already clamped every value to
 * the 44px floor — this component never states a target size of its own, so a
 * later `size="xs"` cannot smuggle a 32px control past the rule. They are
 * written as `min-h-`, not `h-`, because the floor is a minimum and a control
 * must still grow when a user turns dynamic type up. They reach the stylesheet
 * as `min-h-(--control-md)`: a literal class naming a custom property that the
 * theme generator emits from those same tokens. The tempting shorter route —
 * interpolating the token straight into an arbitrary value — silently produces
 * no CSS at all, because Tailwind finds utilities by scanning source text and a
 * class assembled at runtime is text it never sees. `__tests__/tailwind.test.ts`
 * compiles every class this package renders and fails on any that emits nothing,
 * so that failure cannot come back.
 *
 * **Loading is a progress bar, never a spinner.** `PLAN.html` bans spinners
 * outright, and the reason is specific to this product: a spinner during
 * matching feels like nothing is happening, at the exact moment the customer is
 * deciding whether this company is real. The bar is drawn in `currentColor`, so
 * it inherits whatever foreground the tone already proved legible against its
 * own fill — no tone needs a second colour decision, and none of them reaches
 * for amber to signal activity.
 *
 * **The bar that is heard is not the bar that is seen, and it cannot be.** ARIA
 * declares `button` *children presentational*, and every engine implements that
 * by pruning the subtree: a `role="progressbar"` painted inside the element
 * loses its role, its `aria-valuenow` and its `aria-valuetext` before assistive
 * technology is ever offered them. This component used to do exactly that, which
 * meant the rule above held only for people who could see it — the sighted
 * customer got the reassurance the plan is about and a blind customer got
 * `aria-busy` and silence, which is the spinner the rule exists to forbid, minus
 * the animation. So the drawn bar is decoration now, marked `aria-hidden`, and
 * the real `progressbar` is a sibling of the button rather than a child of it,
 * bound to the control by the button's own `aria-describedby`. Outside the
 * pruned subtree the percentage survives, and a busy *Book this move* announces
 * itself as a control that is 40% of the way through something rather than as a
 * control that has stopped responding.
 *
 * **Nothing here speaks on a timer.** The figure is published as a progressbar
 * and left there to be read, not pushed through a live region: a polite region
 * re-announced on every tick would occupy the speech channel for the whole of a
 * match and bury the one sentence that matters when the match lands, and a
 * matching screen can tick a lot. Screen readers already own this trade — the
 * `progressbar` role is what their progress-reporting settings are wired to, and
 * a user who wants beeps, speech or nothing at all has already chosen. A
 * percentage that can be asked for beats one that cannot be escaped. Focus is
 * likewise never moved; the customer stays wherever they were reading.
 *
 * **Loading also blocks the second click**, and that is not a nicety. A
 * double-tapped *Book this move* is a duplicated authorization: a second hold
 * against a real card, on a screen the customer already believes is behind them.
 * The label stays visible and the element stays focusable while busy, so the
 * button keeps its accessible name and a screen-reader user is told the control
 * is working rather than being told it vanished.
 *
 * **The focus ring is two-tone because it has to be.** `__tests__/contrast.test.ts`
 * proves no single colour can clear 3:1 against both a filled button and the page
 * behind it — the admissible luminance ranges do not intersect, in either theme.
 * So the indicator is an ink-2 ring separated from the fill by a paper-coloured
 * offset, and this file's own test asserts that construction stays visible for
 * every tone in both themes.
 *
 * **Pressing is displacement, not only colour.** The palette gives a deep pair to
 * the primary alone, and a component does not get to invent `rust-deep` to make
 * its own hover state symmetrical. Where there is no deeper tone, the press is
 * carried by a pixel of travel and the loss of elevation — a physical channel
 * that survives both themes, colour-blindness and a sunlit screen.
 *
 * No user-facing string is baked in anywhere below. This is a Hebrew-first
 * product; every word a person reads comes from the app's own locale layer, and
 * a primitive that ships an English default is a primitive that ships an English
 * bug into a Hebrew screen. The progress percentage is the one thing this file
 * puts into words, and it is formatted from the surrounding locale rather than
 * written down — for the same reason there is no `aria-valuetext`: a hand-typed
 * "40 percent" is English prose smuggled into a primitive, while `aria-valuenow`
 * is spoken by the screen reader in whatever language the user runs it in. The
 * formatting itself lives in `lib/percent.ts`, because `Progress` publishes the
 * same figure and one decision written twice is one decision that will diverge.
 * ---------------------------------------------------------------------------
 */

export const buttonTones = ['route', 'quiet', 'ghost', 'destructive'] as const;

export type ButtonTone = (typeof buttonTones)[number];

const BUTTON_BASE = [
  'relative inline-flex select-none items-center justify-center gap-2 overflow-hidden',
  'rounded-md border border-transparent font-semibold leading-none no-underline',
  'transition-[background-color,border-color,box-shadow,transform] duration-quick ease-weighted motion-reduce:transition-none',
  'active:translate-y-px',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-2 focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
  'data-disabled:translate-y-0 data-disabled:border-line data-disabled:bg-paper-2 data-disabled:text-ink-3 data-disabled:shadow-none',
];

const BUTTON_VARIANTS = {
  tone: {
    /** The primary. Guide green, and the only tone with a pressed fill of its own. */
    route:
      'bg-route text-on-route shadow-xs hover:bg-route-deep hover:shadow-sm active:bg-route-deep active:shadow-none',
    /** Secondary on paper: a real surface with an ink-3 edge, because a control's boundary must identify it. */
    quiet: 'border-ink-3 bg-card text-route hover:bg-paper-2 active:bg-paper-2',
    ghost: 'bg-transparent text-route hover:bg-paper-2 active:bg-paper-2',
    destructive: 'bg-rust text-on-route shadow-xs hover:shadow-sm active:shadow-none',
  },
  size: {
    // Written as literal `min-h-(--control-*)` rather than interpolated from the
    // size tokens. Tailwind discovers utilities by scanning source *text*, so a
    // class assembled at runtime — `min-h-[${controlHeights.sm}]` — is a string
    // the compiler never sees and a rule that is never emitted. The button would
    // then have no height rule at all and collapse to its line box. The variable
    // form keeps a single source of truth (the custom property is generated from
    // these same tokens) while staying a literal the scanner can find.
    sm: 'min-h-(--control-sm) ps-4 pe-4 text-step-0',
    md: 'min-h-(--control-md) ps-5 pe-5 text-step-0',
    lg: 'min-h-(--control-lg) ps-6 pe-6 text-step-0',
    xl: 'min-h-(--control-xl) ps-8 pe-8 text-step-1',
  },
} as const;

export const buttonVariants = variants({
  base: BUTTON_BASE,
  variants: BUTTON_VARIANTS,
  defaults: { tone: 'route', size: 'md' },
  compound: [
    {
      // A ghost button has no surface to grey out, so the filled disabled
      // treatment would give it one — a disabled control that looks more
      // present than its enabled state.
      when: { tone: 'ghost' },
      use: 'data-disabled:border-transparent data-disabled:bg-transparent',
    },
  ],
});

export type ButtonOwnProps = VariantProps<typeof BUTTON_VARIANTS> & {
  /**
   * Busy, not disabled. The label stays, the element stays focusable, and the
   * click is refused — see the header on duplicated authorizations.
   */
  loading?: boolean;
  /**
   * Completion as a fraction of 1. Omitted while busy means genuinely unknown,
   * which is reported as an indeterminate bar rather than as a made-up number.
   */
  progress?: number;
  disabled?: boolean;
  /**
   * Declared here rather than left to the spread, because while the button is
   * busy this component has a description of its own to add. A caller's help
   * text and the progress figure are both facts about the same control, so the
   * two are merged; replacing one with the other is how a described control
   * quietly loses its description.
   */
  'aria-describedby'?: string;
  className?: string;
  children?: ReactNode;
  onClick?: MouseEventHandler<HTMLElement>;
};

/**
 * Polymorphic, so a step that navigates renders an anchor and keeps every one of
 * these states. The alternative — an anchor styled to look like a button — is
 * how a product ends up with two focus rings and one of them wrong.
 */
export type ButtonProps<E extends ElementType = 'button'> = ButtonOwnProps & { as?: E } & Omit<
    ComponentPropsWithRef<E>,
    'as' | keyof ButtonOwnProps
  >;

export function Button<E extends ElementType = 'button'>({
  as,
  tone,
  size,
  loading = false,
  progress,
  disabled = false,
  className,
  children,
  onClick,
  'aria-describedby': describedBy,
  ...rest
}: ButtonProps<E>) {
  const { locale } = useDirection();
  const generatedId = useId();
  const progressId = `${generatedId}-progress`;

  const Element = (as ?? 'button') as ElementType;
  const isNativeButton = Element === 'button';
  const blocked = disabled || loading;

  const handleClick: MouseEventHandler<HTMLElement> = (event) => {
    if (blocked) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };

  const determinate = typeof progress === 'number';
  const fraction = determinate ? Math.min(1, Math.max(0, progress)) : 0;
  const percent = Math.round(fraction * 100);

  const describedByIds = [describedBy, loading ? progressId : undefined]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ');

  return (
    <>
      <Element
        // Written before the spread so a caller asking for a submit button gets one.
        {...(isNativeButton ? { type: 'button' } : null)}
        {...rest}
        // An anchor cannot be disabled, so it is stripped of the thing that makes
        // it an anchor. `aria-disabled` alone leaves a link that still navigates.
        {...(disabled && !isNativeButton ? { href: undefined, tabIndex: -1 } : null)}
        className={buttonVariants({ tone, size, className })}
        onClick={handleClick}
        disabled={isNativeButton ? disabled : undefined}
        aria-disabled={blocked && !(isNativeButton && disabled) ? true : undefined}
        aria-busy={loading ? true : undefined}
        aria-describedby={describedByIds === '' ? undefined : describedByIds}
        data-disabled={disabled ? '' : undefined}
        data-loading={loading ? '' : undefined}
      >
        {children}
        {loading ? (
          // Paint only. Carrying `role="progressbar"` here would look right in
          // the markup and reach nobody: a button's descendants are pruned from
          // the accessibility tree. The role lives on the sibling below.
          <span
            aria-hidden="true"
            data-progress-track=""
            className="pointer-events-none absolute bottom-0 start-0 end-0 block h-1 bg-current/20"
          >
            <span
              className={cn(
                'block h-full bg-current',
                determinate
                  ? 'transition-[inline-size] duration-base ease-weighted motion-reduce:transition-none'
                  : 'w-full opacity-60 animate-pulse motion-reduce:animate-none',
              )}
              style={determinate ? { inlineSize: `${fraction * 100}%` } : undefined}
            />
          </span>
        ) : null}
      </Element>

      {loading ? (
        // The progress a screen reader actually receives. `sr-only` because the
        // bar above is already the visible form of the same fact, and rendering
        // it twice on the screen would be the kind of duplication that makes
        // people turn assistive markup off.
        <span
          id={progressId}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={determinate ? percent : undefined}
          data-progress={determinate ? 'determinate' : 'indeterminate'}
          className="sr-only"
        >
          {determinate ? percentLabel(locale, percent) : null}
        </span>
      ) : null}
    </>
  );
}
