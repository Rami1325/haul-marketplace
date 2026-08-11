/**
 * @haul/ui — the design system.
 *
 * One brand definition for three surfaces. The tokens are plain TypeScript and
 * are the only place a colour, a size, a duration or a face is decided; the web
 * stylesheet (`styles/theme.css`) and the native theme (`tokens/native-theme.ts`)
 * are both generated from them, so Tailwind and NativeWind cannot drift apart
 * and neither can drift from the numbers a test asserts.
 *
 * Two rules run through everything below, and both are enforced by tests rather
 * than described in comments. Every component is written in logical properties,
 * because Hebrew is this product's reference implementation and RTL is not a
 * mode it switches into. And every class a component renders is a literal the
 * Tailwind scanner can find — a class assembled at runtime compiles to no CSS
 * at all, which is a failure that renders correctly in jsdom and is invisible
 * until it reaches a browser.
 *
 * The Price Card is the reason the rest of this package exists. It carries the
 * one promise the company is built on, so it is the most tested thing here.
 */

// --- tokens: the single source for every design decision --------------------

export * from './tokens/index.js';

// --- composition helpers ----------------------------------------------------

export { cn, type ClassValue } from './lib/cn.js';
export { percentLabel } from './lib/percent.js';
export { variants, type VariantFn, type VariantProps, type VariantRecipe } from './lib/variants.js';

// --- the glyph set ----------------------------------------------------------

export {
  FALLBACK_ICON,
  ICON_GLYPHS,
  ICON_STROKE_WIDTH,
  ICON_VIEWBOX,
  glyphFor,
  iconNames,
  isDirectionalGlyph,
  isIconName,
  resolveIconName,
  type DirectionalGlyph,
  type IconDefinition,
  type IconGlyph,
  type IconName,
} from './icons/index.js';

// --- direction: Hebrew and RTL are the default ------------------------------

// `directionAttributes` is exported from `lib/`, on its own line, because it is
// the one piece of this area a Server Component calls rather than renders — and
// `components/direction.js` is a `'use client'` module, which makes every export
// of it a client reference. Folding it back into the block below compiles
// perfectly and fails at the first `<html {...directionAttributes(locale)}>`.
export { directionAttributes } from './lib/direction-attributes.js';
export {
  DEFAULT_DIRECTION,
  DirectionProvider,
  directionValueFor,
  useDirection,
  type DirectionContextValue,
  type DirectionProviderProps,
} from './components/direction.js';

// --- layout -----------------------------------------------------------------

export { Grid, gridVariants, type GridProps, type GridVariantProps } from './components/grid.js';
export {
  Stack,
  stackGapClasses,
  stackVariants,
  type StackProps,
  type StackVariantProps,
} from './components/stack.js';

// --- primitives -------------------------------------------------------------

export {
  Button,
  buttonTones,
  buttonVariants,
  type ButtonOwnProps,
  type ButtonProps,
  type ButtonTone,
} from './components/button.js';
export { Card, cardVariants, type CardProps } from './components/card.js';
export { Chip, chipVariants, type ChipProps, type ChipSize } from './components/chip.js';
export {
  COUNTDOWN_COPY,
  COUNTDOWN_THRESHOLDS_SECONDS,
  Countdown,
  announcedThreshold,
  countdownAnnouncement,
  formatClock,
  remainingTime,
  type CountdownPhrase,
  type CountdownProps,
  type RemainingTime,
} from './components/countdown.js';
export { Icon, iconSizeClasses, type IconProps } from './components/icon.js';
export {
  Input,
  InputContent,
  LtrRun,
  inputAlignmentClass,
  inputContentDirection,
  inputContentMode,
  type InputContentBidi,
  type InputProps,
  type InputSize,
} from './components/input.js';
export {
  LiveRegion,
  LiveRegionProvider,
  useAnnounce,
  type Announce,
  type LiveRegionProps,
  type LiveRegionProviderProps,
  type Politeness,
} from './components/live-region.js';
export {
  Progress,
  progressVariants,
  type ProgressProps,
  type ProgressSize,
  type ProgressVariants,
} from './components/progress.js';
export {
  RadioGroup,
  firstSelectableIndex,
  nextRadioIndex,
  radioKeyMove,
  type RadioGroupProps,
  type RadioMove,
  type RadioOption,
} from './components/radio-group.js';
export {
  SHEET_COPY,
  Sheet,
  usePrefersReducedMotion,
  type SheetProps,
  type SheetVariants,
} from './components/sheet.js';
export {
  MIN_TARGET_SEPARATION_PX,
  STEPPER_COPY,
  Stepper,
  clampStepperValue,
  type StepperProps,
  type StepperSize,
  type StepperVariants,
} from './components/stepper.js';

// --- money ------------------------------------------------------------------

export {
  MONEY_CLASS,
  Money,
  moneyVariants,
  type MoneyProps,
  type MoneyVariantProps,
} from './components/money.js';

// --- the signature object ---------------------------------------------------

export {
  PRICE_CARD_COPY,
  PriceCard,
  adjustmentReasonText,
  displayedLines,
  displayedTotal,
  priceCardSurfaces,
  priceCardVariantNames,
  priceCardVariants,
  visibleLines,
  type AdjustmentTerms,
  type DisplayedLine,
  type DisplaySpace,
  type PriceCardProps,
  type PriceCardVariant,
} from './components/price-card.js';
