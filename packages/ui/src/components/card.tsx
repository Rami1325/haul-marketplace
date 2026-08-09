import type { ComponentPropsWithRef, ReactNode } from 'react';
import { variants, type VariantProps } from '../lib/variants.js';

/**
 * ---------------------------------------------------------------------------
 * Card
 * ---------------------------------------------------------------------------
 * The raised surface everything else in the product sits on, and deliberately
 * the quietest component in this package.
 *
 * That restraint is the whole point of the module. `PLAN.html` names the Price
 * Card as the signature object — *"when one component carries the product's core
 * promise, it should be the most crafted thing in the codebase"* — and a
 * signature only reads as one if nothing around it is competing. So Card ships
 * no accent bar, no filled tone, no amber, and no `emphasis` prop. The moment
 * such a prop exists, every screen's author reaches for it in good faith, and
 * within a release the product has eleven loud surfaces and no signature.
 * A screen that needs more weight gets it from composition and from being the
 * only thing on the step, which is what "one decision per screen" already asks
 * for.
 *
 * The hairline is not decoration and is not optional. `__tests__/contrast.test.ts`
 * measures `card` against `paper` at 1.09:1 in both themes and records why that
 * is correct — at 3:1 a raised surface stops being a surface and starts being a
 * block — which leaves a drawn edge as the only thing identifying the boundary.
 * Remove the border and the card does not look flatter, it stops existing for
 * anyone on a dim panel or in sunlight.
 *
 * Elevation is therefore the one escalation on offer, and it is a shallow one:
 * a shadow says *raised*, never *important*.
 * ---------------------------------------------------------------------------
 */

const CARD_BASE = 'rounded-lg border border-line bg-card text-ink';

const CARD_VARIANTS = {
  elevation: {
    /** The default. A hairline is enough to say "surface". */
    flat: 'shadow-none',
    raised: 'shadow-xs',
  },
  padding: {
    /** For a card whose children own their own gutters — a list, a media block. */
    none: '',
    snug: 'p-4',
    roomy: 'p-6',
  },
} as const;

export const cardVariants = variants({
  base: CARD_BASE,
  variants: CARD_VARIANTS,
  defaults: { elevation: 'flat', padding: 'roomy' },
});

export type CardProps = Omit<ComponentPropsWithRef<'div'>, 'className' | 'children'> &
  VariantProps<typeof CARD_VARIANTS> & {
    className?: string;
    children?: ReactNode;
  };

export function Card({ elevation, padding, className, children, ...rest }: CardProps) {
  return (
    <div {...rest} className={cardVariants({ elevation, padding, className })}>
      {children}
    </div>
  );
}
