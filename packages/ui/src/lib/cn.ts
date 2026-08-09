import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * ---------------------------------------------------------------------------
 * cn — class composition with last-wins semantics
 * ---------------------------------------------------------------------------
 * Every component in this package accepts `className`, and a caller who passes
 * `bg-paper` expects it to win over the component's own `bg-card`. Plain string
 * concatenation does not give them that: both classes land in the attribute and
 * the winner is decided by stylesheet order, which is an implementation detail
 * of the build. `twMerge` resolves the conflict by Tailwind group instead, so
 * the last class written is the one that applies.
 *
 * The merger is extended with this design system's own scales, because
 * `tailwind-merge` can only de-conflict groups it knows about. `text-step-2`
 * and `text-step-3` are the same group and must not both survive; `text-ink`
 * and `text-step-2` are different groups and must both survive. Out of the box
 * it would guess wrong on both, so the scales are declared here.
 * ---------------------------------------------------------------------------
 */

/**
 * Font-size steps declared in `tokens/type.ts`. Listed as literals rather than
 * imported so this module stays free of the token graph — it is imported by
 * every component, including ones that never touch a token.
 */
const FONT_SIZE_STEPS = ['step-0', 'step-1', 'step-2', 'step-3', 'step-4'] as const;

const MOTION_DURATIONS = ['quick', 'base', 'settle', 'sheet'] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...FONT_SIZE_STEPS] }],
      duration: [{ duration: [...MOTION_DURATIONS] }],
    },
  },
});

export type { ClassValue };

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
