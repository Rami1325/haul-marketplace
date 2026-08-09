/**
 * ---------------------------------------------------------------------------
 * Radius
 * ---------------------------------------------------------------------------
 * Corner radius is where a calm product and a playful one visibly diverge, so
 * the scale is short and it stops well short of the pill for anything that holds
 * content. HAUL's open position is a competent person arriving on time; heavily
 * rounded cards read as a consumer toy, and square corners read as an enterprise
 * console. The middle of that range is deliberate rather than defaulted.
 *
 * Radii scale with the root font size for the same reason spacing does: at large
 * dynamic type a fixed 12px corner on a grown card looks like a rendering
 * mistake. `pill` is the exception and is intentionally a large absolute value —
 * a pill is a shape, not a measurement, and it must survive any container height
 * without being recomputed.
 * ---------------------------------------------------------------------------
 */

export const radius = {
  none: '0',
  /** Chips, badges, the amber money chip's hairline. */
  sm: '0.375rem',
  /** Inputs, buttons — the default for anything a finger touches. */
  md: '0.625rem',
  /** Cards, including the Price Card. */
  lg: '0.875rem',
  /** Sheets and modals, where the corner reads against the whole page. */
  xl: '1.25rem',
  pill: '9999px',
} as const;

export type RadiusToken = keyof typeof radius;

/** For React Native. `pill` is capped at a value no control will exceed in height. */
export const radiusPx = {
  none: 0,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 9999,
} as const satisfies Readonly<Record<RadiusToken, number>>;

export const radiusTokens = [
  'none',
  'sm',
  'md',
  'lg',
  'xl',
  'pill',
] as const satisfies readonly RadiusToken[];
