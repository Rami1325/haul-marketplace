import type { ComponentProps, ReactElement } from 'react';
import { variants, type VariantProps } from '../lib/variants.js';
import { stackGapClasses } from './stack.js';

/**
 * ---------------------------------------------------------------------------
 * Grid
 * ---------------------------------------------------------------------------
 * `Stack` covers a row or a column and nothing else, which leaves the one layout
 * this product cannot do without: the item picker, a grid of tiles, and the
 * first screen a customer ever sees. Written by hand that layout is a column
 * count, a gap and a breakpoint ladder — and the ladder is where it goes wrong.
 *
 * **A tile grid should be told the narrowest a cell may be, not how many cells
 * fit.** `repeat(auto-fill, minmax(--tile-md, 1fr))` derives the column count
 * from the space available, which means it is right on a phone nobody has tested
 * on, right in a sheet that is narrower than the page, and — the case a
 * breakpoint ladder can never get right — right for the customer who has turned
 * system text up, whose tiles need more room at a screen width the ladder still
 * calls "medium". The floors live in `tokens/size.ts` in rem for exactly that
 * reason. `columns` remains for the layouts that genuinely are a fixed count: a
 * two-up pair of summary cards is two cards, not "as many as fit".
 *
 * When both are given, `min` wins. That is deliberate and it is why `min` is
 * declared after `columns` in the recipe — the later class is the one `cn` keeps,
 * so a caller can set a sensible fixed count and then hand the decision to the
 * content without having to unset anything.
 *
 * **A row is RTL-correct with nothing in it that could be wrong.** Grid flows
 * along the inline axis, which already runs right-to-left in a Hebrew subtree,
 * so the first tile lands under the reading start and `justify-items` means the
 * reading start too. Nothing here asks which locale is active.
 *
 * `min-w-0` on the container and on every direct child is a bug fix rather than
 * a taste, and it is the same bug `Stack` fixes for flex items. A grid item's
 * default minimum size is its content, so one long unbroken string — an address,
 * a Hebrew place name, an item somebody typed themselves — makes its column
 * wider than its share and pushes the whole grid past the viewport. It shows up
 * on the narrowest phone in the fleet and never on the reviewer's laptop.
 * ---------------------------------------------------------------------------
 */

const gridOptions = {
  /**
   * A fixed count, for the layouts that really are a count. Written out per
   * value because Tailwind finds utilities by scanning source text, so
   * `grid-cols-${n}` is a class that never reaches the stylesheet.
   */
  columns: {
    '1': 'grid-cols-1',
    '2': 'grid-cols-2',
    '3': 'grid-cols-3',
    '4': 'grid-cols-4',
    '5': 'grid-cols-5',
    '6': 'grid-cols-6',
  },
  /**
   * The floor a cell may shrink to before a column is dropped. Declared after
   * `columns` so that it overrules it — see the header. The custom property is
   * read inside the arbitrary value rather than interpolated around it, which
   * keeps the whole class a literal while the number stays in the tokens.
   *
   * `min(…, 100%)` is the floor's own floor, and it is not decoration.
   * `auto-fill` always lays at least one track, so a bare `minmax(--tile-lg,
   * 1fr)` in a container narrower than the token produces a column wider than
   * the grid holding it and the whole page scrolls sideways — the failure the
   * header claims this component prevents, arriving through the very mechanism
   * that was supposed to prevent it. `min-w-0` does not reach it: that floors
   * the items, and this is the track.
   */
  min: {
    /** Off: the column count is whatever `columns` says. */
    none: '',
    sm: 'grid-cols-[repeat(auto-fill,minmax(min(var(--tile-sm),100%),1fr))]',
    md: 'grid-cols-[repeat(auto-fill,minmax(min(var(--tile-md),100%),1fr))]',
    lg: 'grid-cols-[repeat(auto-fill,minmax(min(var(--tile-lg),100%),1fr))]',
  },
  /**
   * The space scale, shared with `Stack` rather than restated. A gap token added
   * to one layout primitive and not the other is the drift this import prevents.
   */
  gap: stackGapClasses,
  align: {
    start: 'items-start',
    center: 'items-center',
    end: 'items-end',
    /** The default: tiles in a row are as tall as the tallest of them. */
    stretch: 'items-stretch',
  },
} as const;

export const gridVariants = variants({
  base: 'grid min-w-0 *:min-w-0',
  variants: gridOptions,
  defaults: {
    columns: '2',
    min: 'none',
    // One step tighter than `Stack`'s default. A grid holds gaps on two axes, so
    // the same token spends twice as much of the screen and reads heavier.
    gap: '3',
    align: 'stretch',
  },
});

export type GridVariantProps = VariantProps<typeof gridOptions>;

export interface GridProps
  extends Omit<ComponentProps<'div'>, keyof GridVariantProps>, GridVariantProps {}

export function Grid({ columns, min, gap, align, className, ...rest }: GridProps): ReactElement {
  return <div className={gridVariants({ columns, min, gap, align, className })} {...rest} />;
}
