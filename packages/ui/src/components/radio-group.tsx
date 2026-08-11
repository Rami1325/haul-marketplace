'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { chipVariants, type ChipSize } from './chip.js';
import { useDirection } from './direction.js';
import { Icon } from './icon.js';

/**
 * ---------------------------------------------------------------------------
 * RadioGroup
 * ---------------------------------------------------------------------------
 * The control six booking screens are made of: elevator (four answers, and
 * never a boolean — a מעלית קטנה takes people, not sofas), parking (five), crane
 * (three), protection tier, truck class, and Now / Today / Later. `Chip`'s own
 * header predicted this component and refused to become it: chips are
 * independent toggles that announce `aria-pressed`, and adding a `group` prop to
 * them would have silently changed what every existing chip says about itself.
 * So this is a different component that composes the same styling — the chip
 * recipe is imported, not reimplemented, which is what keeps the two from
 * drifting into two visual languages for one gesture.
 *
 * ## Why the whole keyboard contract lives here
 *
 * Native `<input type="radio">` would supply arrow keys for free and is the
 * wrong trade twice over. It cannot wear the chip's treatment without the
 * appearance hacks that break the moment a browser changes its shadow DOM, and
 * — the part that actually decides it — browsers move native radio selection in
 * *document* order, so ArrowRight advances to the next option on a Hebrew screen
 * where the next option is to the *left*. A control that moves the wrong way
 * under the arrow keys is worse than one with no arrow keys at all, because the
 * user has already been taught to trust it.
 *
 * So the ARIA radio-group pattern is implemented directly, and RTL is a decision
 * made once in `radioKeyMove`. ArrowDown and ArrowUp mean next and previous in
 * both languages, because the block axis does not mirror. ArrowRight and
 * ArrowLeft do mirror, and which is which comes from `useDirection().isRtl`
 * rather than from a locale check written at the call site.
 *
 * **Roving tabindex, not a tab stop per option.** A radio group is one answer,
 * so it is one stop in the tab order: the chosen option holds `tabindex="0"` and
 * the rest hold `-1`. With nothing chosen yet the first choosable option holds
 * it, which is what keeps a customer who has answered nothing from having to tab
 * through five parking options to reach the button underneath them. Arrow keys
 * then move focus and the selection together, which is the pattern's own model
 * and the one screen-reader users expect from a radio group.
 *
 * **A refused option keeps its place in the document and loses it in the ring.**
 * `aria-disabled` rather than the native attribute, for the reason `Stepper`'s
 * header sets out at length: disabling the element that holds focus is how a
 * browser is told to drop focus to `<body>`, and inside a `Sheet` that walks the
 * user straight past the focus trap into the form behind the modal. Arrow
 * navigation skips it instead.
 *
 * ## Selection is never colour alone
 *
 * Three channels move together, exactly as on a chip: a check glyph appears, the
 * border doubles in weight, and the label steps up in weight. That is why the
 * option's own label carries no font weight of its own — it inherits the chip's,
 * so the weight channel keeps working. A `detail` line sits underneath at
 * `font-normal` and in the same colour, because on a selected option the ground
 * is route green and a quieter *tone* there would be a contrast failure rather
 * than a hierarchy. Stacking those two lines is also the one thing the chip
 * recipe was not written for, so the vertical option takes the type scale's own
 * leading back from it — a taller option, and no descender through the line
 * below.
 *
 * Every option clears the 44px floor because the chip recipe already does, which
 * matters most here: this is a grid of adjacent targets where a mis-tap does not
 * annoy the customer, it silently answers a different question about their move
 * and changes the price they are about to lock.
 * ---------------------------------------------------------------------------
 */

/** What an arrow, Home or End means, once the reading direction has been applied. */
export type RadioMove = 'next' | 'previous' | 'first' | 'last';

/**
 * The one place the reading direction enters this component.
 *
 * The block axis never mirrors, so Down is always onward. The inline axis always
 * does, so Right is onward in English and back in Hebrew — get this backwards
 * and every Israeli customer's arrow keys run the wrong way, which is a bug
 * nobody working in an English browser will ever see.
 */
export function radioKeyMove(key: string, isRtl: boolean): RadioMove | null {
  switch (key) {
    case 'ArrowDown':
      return 'next';
    case 'ArrowUp':
      return 'previous';
    case 'ArrowRight':
      return isRtl ? 'previous' : 'next';
    case 'ArrowLeft':
      return isRtl ? 'next' : 'previous';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    default:
      return null;
  }
}

/** The first index that can actually be chosen, or null when none can. */
export function firstSelectableIndex(selectable: readonly boolean[]): number | null {
  for (let index = 0; index < selectable.length; index += 1) {
    if (selectable[index] === true) return index;
  }
  return null;
}

/**
 * Where a move lands: the next choosable option in that direction, wrapping at
 * both ends, or null when there is nothing to land on.
 *
 * Wrapping is the pattern's own behaviour and it is also the humane one on a
 * phone — a customer holding the arrow key on a five-option parking question
 * should not have to notice which end they started from. Refused options are
 * stepped over rather than landed on and refused, because landing on one and
 * doing nothing is indistinguishable from a broken key.
 */
export function nextRadioIndex(
  from: number,
  move: RadioMove,
  selectable: readonly boolean[],
): number | null {
  const count = selectable.length;
  if (count === 0) return null;

  if (move === 'first') return firstSelectableIndex(selectable);
  if (move === 'last') {
    for (let index = count - 1; index >= 0; index -= 1) {
      if (selectable[index] === true) return index;
    }
    return null;
  }

  const step = move === 'next' ? 1 : -1;
  let index = from;
  for (let hop = 0; hop < count; hop += 1) {
    index = (index + step + count) % count;
    if (selectable[index] === true) return index;
  }
  return null;
}

export interface RadioOption<Value extends string = string> {
  readonly value: Value;
  /** What the customer reads. */
  readonly label: ReactNode;
  /** The second line — "מעלית קטנה: אנשים, לא ספות". */
  readonly detail?: ReactNode;
  readonly disabled?: boolean;
}

export interface RadioGroupProps<Value extends string = string> {
  /** Required. A group of radios with no name is a group of unnamed radios. */
  label: ReactNode;
  options: readonly RadioOption<Value>[];
  /**
   * `null` means nothing chosen, which is a real state and is not the same as
   * the first option — a booking flow must be able to tell "no lift" from
   * "hasn't answered yet", because only one of those may be priced.
   */
  value: Value | null;
  onValueChange: (value: Value) => void;
  /**
   * Vertical for answers that need a sentence of explanation; horizontal for a
   * short row of words. Also published as `aria-orientation`.
   */
  orientation?: 'horizontal' | 'vertical';
  size?: ChipSize;
  /** On by default: the question is the point of the screen. */
  showLabel?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function RadioGroup<Value extends string = string>({
  label,
  options,
  value,
  onValueChange,
  orientation = 'vertical',
  size = 'md',
  showLabel = true,
  disabled = false,
  id,
  className,
}: RadioGroupProps<Value>) {
  const { isRtl } = useDirection();
  const generatedId = useId();
  const groupId = id ?? `${generatedId}-radiogroup`;
  const labelId = `${groupId}-label`;

  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const selectable = options.map((option) => !disabled && option.disabled !== true);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const tabStop = selectedIndex >= 0 ? selectedIndex : (firstSelectableIndex(selectable) ?? 0);

  const choose = (index: number) => {
    const option = options[index];
    if (option === undefined || selectable[index] !== true) return;
    buttons.current[index]?.focus();
    if (option.value !== value) onValueChange(option.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = radioKeyMove(event.key, isRtl);
    if (move === null) return;
    const landing = nextRadioIndex(selectedIndex >= 0 ? selectedIndex : tabStop, move, selectable);
    if (landing === null) return;
    // Only once a landing exists: an arrow key that this group cannot act on
    // belongs to whatever scrolls the page behind it.
    event.preventDefault();
    choose(landing);
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <span id={labelId} className={showLabel ? 'font-body text-ink-2 text-start' : 'sr-only'}>
        {label}
      </span>

      <div
        id={groupId}
        role="radiogroup"
        aria-labelledby={labelId}
        aria-orientation={orientation}
        aria-disabled={disabled ? true : undefined}
        onKeyDown={onKeyDown}
        className={orientation === 'vertical' ? 'flex flex-col gap-2' : 'flex flex-wrap gap-2'}
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          const refused = selectable[index] !== true;

          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={refused ? true : undefined}
              // The answer, on the element, for an end-to-end selector and for
              // analytics that must not have to parse a Hebrew label back into
              // the enum the booking flow actually stores.
              data-value={option.value}
              data-disabled={refused ? '' : undefined}
              data-selected={selected ? '' : undefined}
              tabIndex={index === tabStop ? 0 : -1}
              ref={(node) => {
                buttons.current[index] = node;
              }}
              onClick={() => choose(index)}
              className={cn(
                chipVariants({ state: selected ? 'selected' : 'idle', size }),
                // The leading is put back deliberately: the chip recipe ends
                // `leading-none`, which is a line box measured for a chip's one
                // line, and a vertical option stacks a label above a detail. At
                // 17px of leading for 17px of text the Hebrew descenders —
                // ק, ן, ך, ף — come down through the line underneath.
                orientation === 'vertical'
                  ? 'w-full justify-start pt-3 pb-3 text-start leading-(--text-step-0--line-height)'
                  : '',
              )}
            >
              {selected ? <Icon name="check" size="sm" /> : null}
              <span className="flex min-w-0 flex-col">
                {/* No weight of its own: the chip recipe's weight step is one of
                    the three channels that carry selection without colour. */}
                <span>{option.label}</span>
                {option.detail === undefined ? null : (
                  <span className="font-normal">{option.detail}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
