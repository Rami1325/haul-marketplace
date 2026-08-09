import type { ComponentPropsWithRef, ReactNode } from 'react';
import { variants } from '../lib/variants.js';

/**
 * ---------------------------------------------------------------------------
 * Chip
 * ---------------------------------------------------------------------------
 * The affordance the customer touches most before they ever see a price: item
 * quantities on the first screen and the preset bundles beside them
 * (דירת 3 חדרים and its siblings). Thirty of these can sit on one screen, so
 * what a chip gets wrong is wrong thirty times.
 *
 * **Selection is never carried by colour alone.** Three channels change together
 * — a check glyph appears, the border doubles in weight, and the label steps up
 * in weight — so the state survives a colour-blind user, a sunlit screen, and a
 * cheap phone panel that flattens saturation. This is the part of the component
 * a test can hold on to, and it does: the assertion is not "the classes changed"
 * but "at least one channel that is not colour changed".
 *
 * **`aria-pressed`, deliberately, and not `role="option"`.** An option only means
 * anything inside an owning listbox, with roving focus and arrow-key navigation
 * supplied by a parent this primitive does not have and should not require. The
 * chips here are independent toggles — adding a third chair does not deselect the
 * sofa — and a toggle button is exactly what that is. A future single-select
 * group is a *different* component that composes this one's styling, not a prop
 * that silently changes what every existing chip announces.
 *
 * Heights come from the control token, so a chip clears the same 44px floor as a
 * button. A grid of small targets is precisely where that floor stops being
 * theoretical: the mis-tap here does not annoy the customer, it silently adds an
 * item to a move and changes the price they were about to lock.
 * ---------------------------------------------------------------------------
 */

const CHIP_BASE = [
  'relative inline-flex select-none items-center justify-center gap-2 rounded-sm border text-step-0 leading-none',
  'transition-[background-color,border-color,box-shadow] duration-quick ease-weighted motion-reduce:transition-none',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-2 focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
  'data-disabled:border-line data-disabled:bg-paper-2 data-disabled:text-ink-3',
];

const CHIP_VARIANTS = {
  state: {
    idle: 'border-ink-3 bg-card font-medium text-ink hover:bg-paper-2',
    selected: 'border-2 border-route-deep bg-route font-semibold text-on-route hover:bg-route-deep',
  },
  size: {
    // Literal, not interpolated — see the note in button.tsx. A class built at
    // runtime is invisible to Tailwind's source scanner and compiles to nothing.
    sm: 'min-h-(--control-sm) ps-3 pe-3',
    md: 'min-h-(--control-md) ps-4 pe-4',
  },
} as const;

export const chipVariants = variants({
  base: CHIP_BASE,
  variants: CHIP_VARIANTS,
  defaults: { state: 'idle', size: 'md' },
});

export type ChipSize = keyof (typeof CHIP_VARIANTS)['size'];

export type ChipProps = Omit<ComponentPropsWithRef<'button'>, 'className' | 'children'> & {
  selected?: boolean;
  size?: ChipSize;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
};

export function Chip({
  selected = false,
  size,
  disabled = false,
  className,
  children,
  ...rest
}: ChipProps) {
  return (
    <button
      type="button"
      {...rest}
      className={chipVariants({ state: selected ? 'selected' : 'idle', size, className })}
      aria-pressed={selected}
      disabled={disabled}
      data-disabled={disabled ? '' : undefined}
      data-selected={selected ? '' : undefined}
    >
      {selected ? (
        <svg
          data-chip-check=""
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          className="size-(--icon-sm) shrink-0"
        >
          <path
            d="M3 8.4 6.4 11.8 13 4.6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
      {children}
    </button>
  );
}
