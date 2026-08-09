import type { ComponentProps, ReactElement } from 'react';
import { variants, type VariantProps } from '../lib/variants.js';

/**
 * ---------------------------------------------------------------------------
 * Stack
 * ---------------------------------------------------------------------------
 * Almost every layout in this product is "some things in a row or a column with
 * a consistent gap between them". Written out by hand that is four utilities per
 * container, and the fourth one is where the system leaks: someone reaches for a
 * margin on the child instead of a gap on the parent, the last child grows a
 * trailing space, and the fix is a physical margin because that is the shortest
 * thing to type. A primitive that owns the gap removes the reason to reach.
 *
 * The gap is a token, not a number. Only the values in the space scale can be
 * named, so "roughly the same spacing as that other screen" stops being a
 * judgement someone makes with the arrow keys.
 *
 * **A row is RTL-correct with no conditional in it, and that is not a
 * coincidence.** Flexbox's main axis is flow-relative: in a `dir="rtl"` subtree
 * `flex-row` already runs from the inline start, which is the right-hand side,
 * and `justify-start` already means the reading start. Nothing here has to ask
 * which locale is active, so nothing here can get the answer wrong. The
 * corollary is that `flex-row-reverse` is not offered as a variant: it reverses
 * relative to the writing direction, so in Hebrew it means left-to-right, and it
 * is the one utility in this area that quietly does the opposite of what someone
 * reaching for it wanted.
 *
 * `min-w-0` is in the base because it fixes a bug rather than expressing a
 * taste. A flex item's default minimum size is its content, so one long
 * unbroken string — an address, an email, a Hebrew place name with no spaces —
 * pushes a row wider than its parent instead of truncating, and the overflow
 * shows up on the narrowest phone in the fleet rather than on the reviewer's
 * laptop.
 * ---------------------------------------------------------------------------
 */

/**
 * Written out per token rather than generated, for two reasons. Tailwind finds
 * classes by scanning source text, so a name assembled at runtime is a name that
 * never reaches the stylesheet. And the list is asserted against `spaceTokens`
 * by test, so the literal costs nothing and a token added without a gap to match
 * fails loudly.
 */
const GAP_CLASSES = {
  '0': 'gap-0',
  '1': 'gap-1',
  '2': 'gap-2',
  '3': 'gap-3',
  '4': 'gap-4',
  '5': 'gap-5',
  '6': 'gap-6',
  '7': 'gap-7',
  '8': 'gap-8',
  '10': 'gap-10',
  '12': 'gap-12',
  '16': 'gap-16',
  '20': 'gap-20',
  '24': 'gap-24',
} as const;

const stackOptions = {
  direction: {
    column: 'flex-col',
    row: 'flex-row',
  },
  gap: GAP_CLASSES,
  align: {
    start: 'items-start',
    center: 'items-center',
    end: 'items-end',
    stretch: 'items-stretch',
    baseline: 'items-baseline',
  },
  justify: {
    start: 'justify-start',
    center: 'justify-center',
    end: 'justify-end',
    between: 'justify-between',
  },
  wrap: {
    nowrap: 'flex-nowrap',
    wrap: 'flex-wrap',
  },
} as const;

export const stackVariants = variants({
  base: 'flex min-w-0',
  variants: stackOptions,
  defaults: {
    direction: 'column',
    gap: '4',
    align: 'stretch',
    justify: 'start',
    wrap: 'nowrap',
  },
});

export type StackVariantProps = VariantProps<typeof stackOptions>;

export { GAP_CLASSES as stackGapClasses };

export interface StackProps
  extends Omit<ComponentProps<'div'>, keyof StackVariantProps>, StackVariantProps {}

export function Stack({
  direction,
  gap,
  align,
  justify,
  wrap,
  className,
  ...rest
}: StackProps): ReactElement {
  return (
    <div className={stackVariants({ direction, gap, align, justify, wrap, className })} {...rest} />
  );
}
