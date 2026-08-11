'use client';

import type { Locale } from '@haul/types';
import { useId, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { percentLabel } from '../lib/percent.js';
import { variants, type VariantProps } from '../lib/variants.js';
import { tabularFiguresClass } from '../tokens/type.js';
import { useDirection } from './direction.js';

/**
 * ---------------------------------------------------------------------------
 * Progress
 * ---------------------------------------------------------------------------
 * `PLAN.html` bans spinners, and the reason is specific rather than stylistic:
 * a spinner during matching feels like nothing is happening, at the exact moment
 * the customer is deciding whether this company is real. A bar has a beginning
 * and an end, so even an empty one is a claim that there is a process with a
 * shape to it.
 *
 * **This one is in the accessibility tree, which is the whole difference from
 * the Button's.** The Button owns a progress bar too and has to publish it as a
 * *sibling*, because ARIA declares a button's children presentational and every
 * engine prunes them — a role painted inside the control reaches nobody. Nothing
 * prunes this element, so `role="progressbar"` lives on the visible track and
 * the figure a screen reader receives and the figure a sighted customer sees are
 * literally the same element. Its own children are pruned, which is fine: the
 * fill inside is paint.
 *
 * **Indeterminate is still a bar.** A wait of genuinely unknown length must not
 * be reported as a made-up number, so `aria-valuenow` is simply absent — that is
 * what tells assistive technology the length is unknown, and inventing a value
 * to avoid an empty attribute is how a progress bar starts lying. What the eye
 * gets is `--animate-sweep`: the fill grows from the track's inline start to the
 * full width and starts again. It animates `inline-size` rather than sliding a
 * short bar across with a transform, which is what makes it run the right way
 * round in Hebrew — see `tokens/motion.ts`, where the physics of that decision
 * is written down.
 *
 * Under `prefers-reduced-motion` the sweep is swapped for a pulse rather than
 * removed. A size animation is movement and is exactly what the setting exists
 * to suppress; an opacity animation is not, and something still has to say the
 * wait is ongoing. Removing the animation outright would leave a full bar
 * sitting at 100%, which reads as finished — the one thing it must not say.
 *
 * **Nothing here speaks on a timer**, for the reason the Button's header gives
 * at length: a polite live region re-announced on every tick occupies the speech
 * channel for the whole of a match and buries the sentence that matters when the
 * match lands. The `progressbar` role is what a screen reader's own progress
 * settings are wired to, and a user who wants beeps, speech or silence has
 * already chosen. A surface that genuinely needs to announce a milestone has
 * `LiveRegion` for it.
 *
 * The track is `paper-2`, which the palette already reserves for inset surfaces
 * and names progress tracks among them. The fill clears 3:1 against that track
 * and against both grounds in both themes, which is the contrast that carries
 * the *value* — the track's own edge is context, and a track drawn at 3:1 would
 * be a second bar competing with the first.
 *
 * There is no amber tone and there will not be one. Amber means money or
 * attention; a wait is neither, and the first amber progress bar is the change
 * that ends the rule making the price the loudest thing on a screen.
 * ---------------------------------------------------------------------------
 */

const progressConfig = {
  size: {
    /** Inline with other content — a step's own quiet progress. */
    sm: 'h-1',
    /** The default. */
    md: 'h-2',
    /** The matching screen, where the bar is the only thing on it. */
    lg: 'h-3',
  },
} as const;

export type ProgressVariants = VariantProps<typeof progressConfig>;

export type ProgressSize = NonNullable<ProgressVariants['size']>;

export const progressVariants = variants({
  base: 'block w-full overflow-hidden rounded-pill bg-paper-2',
  variants: progressConfig,
  defaults: { size: 'md' },
});

/**
 * Both fills are one class list each rather than a variant recipe, because the
 * difference between them is not a style choice a caller may make — it is
 * whether there is a number to report. The determinate one animates its own
 * `inline-size` so a jump from 20% to 60% travels instead of teleporting.
 */
const DETERMINATE_FILL = cn(
  'block h-full rounded-pill bg-route',
  'transition-[inline-size] duration-base ease-weighted motion-reduce:transition-none',
);

const INDETERMINATE_FILL = cn(
  'block h-full w-full rounded-pill bg-route',
  'animate-sweep motion-reduce:animate-pulse',
);

export interface ProgressProps {
  /**
   * What is being waited for. Required: a progress bar with no name announces
   * itself as "40%" and nothing else, which is a number with no noun.
   */
  label: ReactNode;
  /**
   * Completion as a fraction of 1. Omitted means genuinely unknown, which is
   * reported as indeterminate rather than as a number nobody measured.
   */
  value?: number;
  /** On by default: the wait is the screen, so the sentence describing it is too. */
  showLabel?: boolean;
  /** Defaults to on when there is a figure to show. */
  showValue?: boolean;
  size?: ProgressSize;
  /** Defaults to the surrounding `DirectionProvider`, i.e. Hebrew. */
  locale?: Locale;
  id?: string;
  className?: string;
}

export function Progress({
  label,
  value,
  showLabel = true,
  showValue,
  size = 'md',
  locale,
  id,
  className,
}: ProgressProps) {
  const { locale: contextLocale } = useDirection();
  const active = locale ?? contextLocale;

  const generatedId = useId();
  const barId = id ?? `${generatedId}-progress`;
  const labelId = `${barId}-label`;

  const determinate = typeof value === 'number' && Number.isFinite(value);
  const fraction = determinate ? Math.min(1, Math.max(0, value)) : 0;
  const percent = Math.round(fraction * 100);
  const statesValue = showValue ?? determinate;

  return (
    <div
      className={cn('flex flex-col gap-2', className)}
      data-progress={determinate ? 'determinate' : 'indeterminate'}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span id={labelId} className={showLabel ? 'font-body text-ink-2 text-start' : 'sr-only'}>
          {label}
        </span>
        {statesValue && determinate ? (
          // Hidden from assistive technology because `aria-valuenow` on the bar
          // below is the same fact, and a screen reader that read both would
          // announce the percentage twice for every glance at the control.
          <span aria-hidden="true" className={cn(tabularFiguresClass, 'text-ink-2')}>
            {percentLabel(active, percent)}
          </span>
        ) : null}
      </div>

      <div
        id={barId}
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={100}
        // Absent, not zero. Absence is what states "length unknown"; a zero
        // would state "no progress at all", which is a different claim.
        aria-valuenow={determinate ? percent : undefined}
        className={progressVariants({ size })}
      >
        <span
          data-progress-fill=""
          className={determinate ? DETERMINATE_FILL : INDETERMINATE_FILL}
          style={determinate ? { inlineSize: `${percent}%` } : undefined}
        />
      </div>
    </div>
  );
}
