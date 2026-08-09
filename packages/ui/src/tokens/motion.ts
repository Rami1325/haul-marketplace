/**
 * ---------------------------------------------------------------------------
 * Motion
 * ---------------------------------------------------------------------------
 * From `PLAN.html`: *"200–280ms, weighted easing, spring on sheets. Things in
 * this app are heavy; the interface should agree."*
 *
 * That is not decoration, it is the product telling the truth about itself. The
 * customer is booking a truck to carry a sofa down four flights of stairs. If a
 * sheet snaps open in 90ms with a linear curve, the interface is behaving like
 * something weightless, and every element of the design that says *sturdy* is
 * being contradicted by the one channel the user cannot consciously inspect.
 * Motion is where an interface accidentally admits it is a web page.
 *
 * So the curves carry mass. `weighted` is the default and it is neither linear
 * nor the browser's `ease-in-out`: the first tenth of the duration covers about
 * six percent of the distance and the last quarter covers about six percent,
 * with the middle moving fast. Resistance at the start, momentum bleeding off at
 * the end — which is what a heavy object does, and what an evenly-paced curve
 * conspicuously does not.
 *
 * Sheets get a real spring rather than a curve that looks like one. The
 * `linear()` stops below were sampled from a damped harmonic oscillator with
 * stiffness 543, damping 35 and unit mass — around 0.75 of critical, which
 * overshoots by 2.8% at roughly 200ms and is settled by 400ms. A visible but
 * small overshoot reads as something with inertia arriving; more than that reads
 * as bounce, which is a toy. `sheetSpring` publishes the same physics as numbers
 * so React Native's spring animations run the identical motion rather than an
 * eyeballed approximation of it.
 *
 * The four duration names are fixed by `lib/cn.ts`, which declares them to
 * tailwind-merge so `duration-base` and `duration-settle` de-conflict. Renaming
 * one here does not break the build; it silently stops `className` overrides
 * from resolving, which is worse. A test asserts the two lists agree.
 *
 * `quick` sits below the plan's band on purpose. 200ms is the floor for
 * *movement* — something travelling across the screen. A press state or a focus
 * ring is not movement, it is feedback, and feedback slower than about 150ms
 * feels like input lag rather than weight.
 *
 * Every consumer of these tokens must still honour `prefers-reduced-motion`.
 * A weighted curve is a vestibular problem for some users, not a flourish.
 * ---------------------------------------------------------------------------
 */

/** Names fixed by `lib/cn.ts`. See the header. */
export const durationTokens = ['quick', 'base', 'settle', 'sheet'] as const;

export type MotionDurationToken = (typeof durationTokens)[number];

export const durations = {
  /** Feedback, not movement: press, hover, focus ring, checkbox tick. */
  quick: '140ms',
  /** The default for anything that moves. */
  base: '220ms',
  /** Larger travel — a card expanding, a step transition. */
  settle: '260ms',
  /** Sheets and modals, paired with `easings.sheet`. */
  sheet: '400ms',
} as const satisfies Readonly<Record<MotionDurationToken, string>>;

/** For React Native and for anything scheduling a timeout against an animation. */
export const durationMs = {
  quick: 140,
  base: 220,
  settle: 260,
  sheet: 400,
} as const satisfies Readonly<Record<MotionDurationToken, number>>;

/** The band `PLAN.html` specifies for motion that actually travels. */
export const MOTION_BAND_MS = { min: 200, max: 280 } as const;

export const easings = {
  /** The default. Resistance in, momentum out. */
  weighted: 'cubic-bezier(0.25, 0.02, 0.35, 1)',
  /** Something arriving: it is already moving when it enters the frame. */
  entrance: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  /** Something leaving: it should get out of the way, not be admired. */
  exit: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
  /** A sampled spring — see `sheetSpring` for the physics it came from. */
  sheet:
    'linear(0, 0.0619, 0.2024, 0.3709, 0.536, 0.6806, 0.7974, 0.8855, 0.9476, 0.9882, 1.0123, 1.0243, 1.0283, 1.0273, 1.0237, 1.019, 1.0142, 1.0099, 1.0064, 1.0038, 1.0018, 1.0006, 0.9998, 0.9994, 1)',
} as const;

export type EasingToken = keyof typeof easings;

/**
 * Control points for the three bezier curves, for platforms that take numbers
 * rather than a CSS string — React Native's `Easing.bezier(x1, y1, x2, y2)` and
 * Reanimated both want exactly this. `sheet` is absent because it is a spring,
 * not a bezier; use `sheetSpring`.
 */
export const easingCurves = {
  weighted: [0.25, 0.02, 0.35, 1],
  entrance: [0.05, 0.7, 0.1, 1],
  exit: [0.3, 0, 0.8, 0.15],
} as const;

/**
 * The oscillator `easings.sheet` was sampled from. Damping ratio is about 0.75
 * of critical: heavy enough to settle without bouncing, loose enough that the
 * sheet reads as an object with inertia rather than a panel being drawn.
 */
export const sheetSpring = {
  stiffness: 543,
  damping: 35,
  mass: 1,
  /** Where the curve peaks, as a fraction of the travel. Kept honest by test. */
  overshoot: 1.0283,
} as const;
