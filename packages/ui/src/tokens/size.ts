/**
 * ---------------------------------------------------------------------------
 * Size
 * ---------------------------------------------------------------------------
 * `PLAN.html` asks for 44px minimum targets, and this module exists so that
 * asking is not what enforces it.
 *
 * The usual way a design system loses that rule is not by disagreeing with it.
 * It is by adding a `size="xs"` variant six months later for a dense table row,
 * because in that one screen 32px looks better — and nobody re-reads the plan
 * while adding a variant. So the floor is not written in the heights, it is
 * written in the function that produces them: `atLeastTapTarget` clamps, every
 * control height is passed through it, and a future `xs` at 32px silently
 * becomes 44px instead of silently shipping. The value a designer asked for is
 * an input, not the answer.
 *
 * This matters most for the audience the plan names: the driver app is used in
 * a truck cab, in sunlight, by someone wearing work gloves with one hand on a
 * dolly. A missed tap there is not a UX blemish, it is a person stopping what
 * they are carrying.
 *
 * Heights are px, not rem, and that is the one place this system departs from
 * scaling with the root font size. 44px is a physical claim about a fingertip,
 * and a user who *reduces* their text size has not thereby acquired smaller
 * hands — expressed in rem, the floor would quietly fall to 33px at a 12px root.
 * Controls still grow for large type, because their padding and label are rem
 * and the height is a minimum rather than a fixed box.
 *
 * Icon sizes are not tap targets and are deliberately smaller. An icon-only
 * control still takes a full control height around its icon; the glyph is what
 * you see, the target is what you hit, and they are not the same measurement.
 * ---------------------------------------------------------------------------
 */

/**
 * WCAG 2.5.5 (AAA) asks for 44×44 CSS px; 2.5.8 (AA) settles for 24. We take the
 * stricter number because of where this product is used, not because of the
 * conformance level we are claiming.
 */
export const MIN_TAP_TARGET_PX = 44;

export const MIN_TAP_TARGET = '44px';

/**
 * The floor, as a function. Every control height goes through here, so a height
 * below the minimum is not a bug that can be introduced — it is an input that
 * gets corrected.
 */
export function atLeastTapTarget(px: number): number {
  return Math.max(px, MIN_TAP_TARGET_PX);
}

/**
 * What each size is *for*, before the floor is applied. `sm` asks for 36 and
 * will not get it; that is the mechanism working, and it is left visible here
 * rather than pre-rounded so the next person can see the clamp bite.
 */
const REQUESTED_CONTROL_PX = {
  sm: 36,
  md: 48,
  lg: 56,
  /** The primary action on the Price Card — the one button that carries the promise. */
  xl: 64,
} as const;

export type ControlSize = keyof typeof REQUESTED_CONTROL_PX;

export const controlSizes = ['sm', 'md', 'lg', 'xl'] as const satisfies readonly ControlSize[];

export const controlHeightsPx: Readonly<Record<ControlSize, number>> = {
  sm: atLeastTapTarget(REQUESTED_CONTROL_PX.sm),
  md: atLeastTapTarget(REQUESTED_CONTROL_PX.md),
  lg: atLeastTapTarget(REQUESTED_CONTROL_PX.lg),
  xl: atLeastTapTarget(REQUESTED_CONTROL_PX.xl),
};

export const controlHeights: Readonly<Record<ControlSize, string>> = {
  sm: `${controlHeightsPx.sm}px`,
  md: `${controlHeightsPx.md}px`,
  lg: `${controlHeightsPx.lg}px`,
  xl: `${controlHeightsPx.xl}px`,
};

export const iconSizesPx = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

export type IconSize = keyof typeof iconSizesPx;

export const iconSizes = {
  sm: '16px',
  md: '20px',
  lg: '24px',
  xl: '32px',
} as const satisfies Readonly<Record<IconSize, string>>;
