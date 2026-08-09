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
export { variants, type VariantFn, type VariantProps, type VariantRecipe } from './lib/variants.js';

// --- direction: Hebrew and RTL are the default ------------------------------

export {
  DEFAULT_DIRECTION,
  DirectionProvider,
  directionAttributes,
  directionValueFor,
  useDirection,
  type DirectionContextValue,
  type DirectionProviderProps,
} from './components/direction.js';

// --- layout -----------------------------------------------------------------

export {
  Stack,
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
