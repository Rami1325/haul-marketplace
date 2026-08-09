'use client';

import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { variants, type VariantProps } from '../lib/variants.js';
import { controlHeights } from '../tokens/size.js';
import { tabularFiguresClass } from '../tokens/type.js';
import { useDirection } from './direction.js';

/**
 * ---------------------------------------------------------------------------
 * Input
 * ---------------------------------------------------------------------------
 * The field where a Hebrew-first product most easily tells a lie about the data
 * it is holding.
 *
 * Direction is not a page-level setting here, it is a property of what the field
 * contains, and the two answers are genuinely different. Prose must be free: a
 * street name typed in Hebrew has to lay itself out from the end of the line
 * back, and the same field filled in English has to lay itself out the other
 * way, which is what `dir="auto"` is for — the first strong character decides,
 * exactly as every native keyboard on the customer's phone already behaves.
 *
 * Numbers must not be free, and this is the part that bites. A phone number is
 * digits and punctuation with no strong character anywhere in it, so under
 * `auto` it inherits the surrounding Hebrew paragraph and the bidi algorithm
 * resolves the leading `+` to that paragraph's direction: `+972-52-123` is
 * rendered back to its owner as `972-52-123+`. Nobody reading that concludes the
 * stylesheet is wrong. They conclude the number is wrong, delete it, and type it
 * again — and get the same result, because the value in the field was correct
 * the whole time. The same failure puts a minus sign or a ₪ on the wrong side of
 * a price. So numeric content kinds declare `dir="ltr"`, which makes the field's
 * value its own bidi paragraph and takes the ambient direction out of the
 * question entirely.
 *
 * Forcing that direction settles where the value reads and immediately unsettles
 * where it sits, because `text-align: start` resolves against the *element's*
 * own direction and not against the page's. The one declaration that pushes a
 * Hebrew label to the right edge of the form therefore pushes a `dir="ltr"`
 * phone field to the left of it: labels, hints and error sentences hard against
 * one side of the screen, and every value, caret and placeholder against the
 * other. Nobody reads that as a bidi subtlety; they read it as a form that is
 * broken, and on a phone the edge the thumb aims at is the opposite one from
 * where the digits will appear. So the two decisions are separated, and both
 * live in `inputContentDirection`: `dir` comes from what the field holds, and
 * `align` declares whose direction the value answers to. Prose answers to
 * itself — an English street name typed into a Hebrew form should lay out the
 * way the keyboard just typed it. A run whose direction has been forced answers
 * to the page instead, which is why a numeric field on a Hebrew screen aligns to
 * its `end`: once a field has been made LTR, its `end` is the edge the rest of
 * the Hebrew form is already using.
 *
 * The mirror problem is a number quoted *inside* Hebrew prose — a hint that
 * gives an example phone number, a label naming a price. There the run cannot
 * carry the whole element's direction, so it is wrapped in `<bdi>` via `LtrRun`.
 * That is the one element in HTML whose entire purpose is to stop a nested run
 * from reordering the sentence around it, and it is cheaper than every
 * workaround people reach for first.
 *
 * The label is generated an id when the caller does not supply one, because a
 * label that is merely adjacent is not a label: a screen reader announces the
 * field as unnamed, and — the part that is easy to miss because it costs sighted
 * users nothing either — tapping the words does not focus the field, which on a
 * phone turns a 44px target back into a 20px one.
 *
 * The edge of the field is drawn in `ink-3`, not in the `line` hairline, and the
 * distinction is the difference between a rule and a control. A field's fill is
 * 1.09:1 against the page — it is a surface, not a signal — so the border is the
 * only thing telling a customer where the field is, and WCAG 1.4.11 puts that at
 * 3:1. `line` measures 1.41:1 against the fill and 1.29:1 against the page,
 * which is correct for a divider and useless for a boundary: on a glare-washed
 * screen at midday, a field drawn that way is not a field, it is a page.
 * `ink-3` is the tone the palette reserves for exactly this job, and it clears
 * 3:1 against both the fill and the page in both themes.
 *
 * The hint is `ink-2` for the mirror reason. `ink-3` is 4.23:1 on the page
 * ground — under AA for body text — and it passes only when the field happens to
 * sit inside a Card, which is the kind of failure that depends on where a
 * component was dropped and therefore never survives review. A hint is where the
 * format help lives, the example phone number a customer copies the shape of, so
 * the step down from the label is taken in weight rather than in luminance.
 *
 * An error is never signalled by colour alone. Roughly one man in twelve cannot
 * separate the rust tone from the ink beside it, and outdoors in sunlight, which
 * is where the plan says this product gets used, nobody can. So the invalid
 * state thickens the border, adds a glyph and adds a sentence, and a test
 * strips every colour utility from both renderings and asserts they still
 * differ.
 * ---------------------------------------------------------------------------
 */

/**
 * What the field holds — which is the same question as which direction its value
 * has to be laid out in. Naming the content rather than the direction keeps the
 * decision at the call site honest: a caller knows it is asking for a phone
 * number, and is not always in a position to know what that implies for bidi.
 */
export const InputContent = {
  /** Prose: a name, a street, a note. Direction follows what is typed. */
  Text: 'text',
  /** `+972-52-123-4567`. */
  Phone: 'phone',
  /** A shekel figure the customer types — a tip, a declared value. */
  Money: 'money',
  /** A bare count: floor, flights, apartment number. */
  Digits: 'digits',
} as const;

export type InputContent = (typeof InputContent)[keyof typeof InputContent];

/** One content kind's two bidi answers, which are not the same answer. */
export interface InputContentBidi {
  /**
   * The `dir` the field carries. `ltr` makes the value its own bidi paragraph;
   * `auto` lets the first strong character decide.
   */
  readonly dir: 'auto' | 'ltr';
  /**
   * Whose direction the value's alignment answers to. `content` means the
   * field's own — `text-align: start`, which is what a value under `dir="auto"`
   * wants. `page` means the direction of the form around it, which is the only
   * correct answer once `dir` has been forced, because from that moment the
   * field's start edge and the page's are opposite edges.
   */
  readonly align: 'content' | 'page';
}

/**
 * The whole bidi decision, as a table. Exported because it is the module's one
 * real claim about the world and a test asserts it directly rather than through
 * a rendered field.
 *
 * The two columns are locked to each other: a field that forces its direction
 * has given up the right to take its alignment from itself.
 */
export const inputContentDirection = {
  text: { dir: 'auto', align: 'content' },
  phone: { dir: 'ltr', align: 'page' },
  money: { dir: 'ltr', align: 'page' },
  digits: { dir: 'ltr', align: 'page' },
} as const satisfies Readonly<Record<InputContent, InputContentBidi>>;

/**
 * The alignment utility for one content kind on a page reading a given way.
 *
 * Both results are logical utilities and that is the whole trick: on a field
 * that has been forced to `dir="ltr"`, `text-end` is the right-hand edge, which
 * is precisely where a right-to-left form puts everything else. Writing the
 * physical value instead would say the same thing today and stop being true the
 * moment the surrounding direction is not the one it was written for.
 */
export function inputAlignmentClass(content: InputContent, isRtl: boolean): string {
  return inputContentDirection[content].align === 'page' && isRtl ? 'text-end' : 'text-start';
}

/**
 * Which soft keyboard the phone raises. Wrong here is not a rendering bug, it is
 * a customer hunting for the digit layer while standing in a stairwell.
 */
export const inputContentMode = {
  text: 'text',
  phone: 'tel',
  money: 'decimal',
  digits: 'numeric',
} as const satisfies Readonly<Record<InputContent, 'text' | 'tel' | 'decimal' | 'numeric'>>;

const inputConfig = {
  size: {
    md: 'text-step-0 ps-4 pe-4',
    lg: 'text-step-1 ps-5 pe-5',
  },
  state: {
    /** `ink-3` and not `line`: a control's boundary has to identify it. */
    normal: 'border-ink-3',
    /**
     * Two signals beyond colour: the border doubles in weight and the field sits
     * on its own ground. The glyph and the sentence below carry the rest.
     */
    invalid: 'border-2 border-rust bg-rust-soft',
  },
} as const;

type InputVariants = VariantProps<typeof inputConfig>;

export type InputSize = NonNullable<InputVariants['size']>;

const inputField = variants({
  // No `text-*` alignment here on purpose: it is decided once, in the component,
  // against the page's direction rather than the field's.
  base: cn(
    'w-full rounded-md border bg-card font-body text-ink',
    'placeholder:text-ink-3 caret-route',
    'transition-colors duration-quick',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-route',
    'disabled:cursor-not-allowed disabled:bg-paper-2 disabled:text-ink-3',
  ),
  variants: inputConfig,
  defaults: { size: 'md', state: 'normal' },
});

export interface InputProps extends Omit<ComponentPropsWithRef<'input'>, 'size' | 'children'> {
  /** Required. A field without a programmatic label is a field without a name. */
  label: ReactNode;
  /** Format help, examples, units. Stays visible when an error appears. */
  hint?: ReactNode;
  /** Presence is the invalid state; there is no separate `invalid` flag to disagree with it. */
  error?: ReactNode;
  content?: InputContent;
  size?: InputSize;
  /** Classes for the outer field group. The input itself takes `inputClassName`. */
  className?: string;
  inputClassName?: string;
}

export function Input({
  label,
  hint,
  error,
  content = InputContent.Text,
  size = 'md',
  className,
  inputClassName,
  id,
  dir,
  inputMode,
  'aria-describedby': describedBy,
  ...rest
}: InputProps) {
  const { isRtl } = useDirection();
  const generatedId = useId();
  const fieldId = id ?? `${generatedId}-field`;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const invalid = error !== undefined && error !== null && error !== false;

  const describedByIds = [describedBy, hint ? hintId : undefined, invalid ? errorId : undefined]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ');

  return (
    <div
      className={cn('flex flex-col gap-2', className)}
      data-invalid={invalid ? 'true' : undefined}
    >
      <label htmlFor={fieldId} className="font-body text-step-0 font-medium text-ink-2 text-start">
        {label}
      </label>

      <input
        {...rest}
        id={fieldId}
        dir={dir ?? inputContentDirection[content].dir}
        inputMode={inputMode ?? inputContentMode[content]}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedByIds === '' ? undefined : describedByIds}
        data-content={content}
        className={inputField({
          size,
          state: invalid ? 'invalid' : 'normal',
          // Alignment before the caller's classes, so `inputClassName` can still
          // overrule it for the field this table cannot describe.
          className: cn(inputAlignmentClass(content, isRtl), inputClassName),
        })}
        // The 44px floor lives in the token, not in a utility class, so a future
        // restyle cannot quietly shrink the target below it.
        style={{ minBlockSize: controlHeights[size] }}
      />

      {hint ? (
        <p id={hintId} className="font-body text-ink-2 text-start">
          {hint}
        </p>
      ) : null}

      {invalid ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-center gap-2 font-body text-rust text-start"
        >
          <ErrorMark />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The non-colour half of the error signal. Decorative to assistive technology —
 * the sentence beside it is the message — and present so that a field read in
 * sunlight or by someone who cannot separate rust from ink still shows that
 * something is wrong before it is read.
 */
function ErrorMark() {
  return (
    <svg viewBox="0 0 20 20" className="size-5 shrink-0" aria-hidden="true" focusable="false">
      <path
        d="M10 2.75 18.25 17H1.75L10 2.75Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M10 8v3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="10" cy="14.2" r="0.9" fill="currentColor" />
    </svg>
  );
}

/**
 * An island of LTR inside a Hebrew sentence: a phone number in a hint,
 * an order reference in a label, a price quoted mid-paragraph.
 *
 * `<bdi>` is doing the work, not the `dir` attribute — the element isolates its
 * contents from the bidi resolution of the sentence containing it, so the run
 * cannot reorder the words around it and the words around it cannot reorder the
 * run. Writing the isolation with a `<span dir="ltr">` instead is the common
 * near-miss: it directs the inside and leaves the outside to be rearranged.
 */
export function LtrRun({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={cn(tabularFiguresClass, className)}>
      {children}
    </bdi>
  );
}
