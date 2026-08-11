import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectionProvider } from '../components/direction.js';
import {
  RadioGroup,
  firstSelectableIndex,
  nextRadioIndex,
  radioKeyMove,
  type RadioOption,
} from '../components/radio-group.js';
import { MIN_TAP_TARGET_PX, controlHeightsPx } from '../tokens/size.js';
import { lineHeights } from '../tokens/type.js';
import {
  compilesToARule,
  cssFor,
  declaredValue,
  resolvedMinHeightPx,
  themeValue,
} from './helpers/stylesheet.js';

/**
 * Six booking screens are made of this control, and the one that decides its
 * shape is the elevator question: four answers, never a boolean, because
 * "has elevator: yes" is the lie that costs an hour of stair-carrying. So what
 * is asserted here is that a single-select group actually behaves like one —
 * one answer, one tab stop, arrow keys that move the answer, and a "nothing
 * chosen yet" state that is not silently the first option.
 *
 * The direction rule gets its own block. A group whose arrow keys run backwards
 * in Hebrew is a bug nobody working in an English browser will ever see, so it
 * is tested as a pure function first and then through a rendered group in both
 * languages.
 */

afterEach(cleanup);

const ELEVATOR: readonly RadioOption[] = [
  { value: 'none', label: 'אין מעלית' },
  { value: 'small', label: 'מעלית קטנה', detail: 'אנשים, לא ספות' },
  { value: 'standard', label: 'מעלית רגילה' },
  { value: 'service', label: 'מעלית שירות' },
];

function Harness({
  initial = null,
  options = ELEVATOR,
  ...rest
}: {
  initial?: string | null;
  options?: readonly RadioOption[];
} & Partial<Parameters<typeof RadioGroup>[0]>) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <RadioGroup label="מעלית" options={options} value={value} onValueChange={setValue} {...rest} />
  );
}

function radios(): HTMLElement[] {
  return screen.getAllByRole('radio');
}

/** The answer the group is currently holding, read off the element that holds it. */
function checkedValue(): string | null {
  const checked = radios().find((radio) => radio.getAttribute('aria-checked') === 'true');
  return checked?.getAttribute('data-value') ?? null;
}

describe('radioKeyMove — the direction decision, on its own', () => {
  it('reads the block axis the same way in both languages', () => {
    for (const isRtl of [true, false]) {
      expect(radioKeyMove('ArrowDown', isRtl), String(isRtl)).toBe('next');
      expect(radioKeyMove('ArrowUp', isRtl), String(isRtl)).toBe('previous');
    }
  });

  it('mirrors the inline axis, because the inline axis is what mirrors', () => {
    expect(radioKeyMove('ArrowRight', false)).toBe('next');
    expect(radioKeyMove('ArrowLeft', false)).toBe('previous');
    // Hebrew: the next option is to the left, so Right goes back.
    expect(radioKeyMove('ArrowRight', true)).toBe('previous');
    expect(radioKeyMove('ArrowLeft', true)).toBe('next');
  });

  it('sends Home and End to the ends, which do not mirror either', () => {
    for (const isRtl of [true, false]) {
      expect(radioKeyMove('Home', isRtl)).toBe('first');
      expect(radioKeyMove('End', isRtl)).toBe('last');
    }
  });

  it('claims no other key', () => {
    for (const key of ['Tab', 'Enter', ' ', 'PageDown', 'a', 'Escape']) {
      expect(radioKeyMove(key, true), key).toBeNull();
    }
  });
});

describe('nextRadioIndex — wrapping and refusal, on their own', () => {
  const all = [true, true, true, true];

  it('steps and wraps at both ends', () => {
    expect(nextRadioIndex(0, 'next', all)).toBe(1);
    expect(nextRadioIndex(3, 'next', all)).toBe(0);
    expect(nextRadioIndex(0, 'previous', all)).toBe(3);
    expect(nextRadioIndex(2, 'previous', all)).toBe(1);
  });

  it('goes to the ends', () => {
    expect(nextRadioIndex(2, 'first', all)).toBe(0);
    expect(nextRadioIndex(2, 'last', all)).toBe(3);
  });

  it('steps over a refused option instead of landing on it', () => {
    // Landing on one and doing nothing is indistinguishable from a broken key.
    const middleRefused = [true, false, false, true];
    expect(nextRadioIndex(0, 'next', middleRefused)).toBe(3);
    expect(nextRadioIndex(3, 'previous', middleRefused)).toBe(0);
    expect(nextRadioIndex(2, 'first', middleRefused)).toBe(0);
    expect(nextRadioIndex(2, 'last', middleRefused)).toBe(3);
  });

  it('has nowhere to go when nothing can be chosen', () => {
    expect(nextRadioIndex(0, 'next', [false, false])).toBeNull();
    expect(nextRadioIndex(0, 'first', [false, false])).toBeNull();
    expect(nextRadioIndex(0, 'next', [])).toBeNull();
  });

  it('finds the first option that can be chosen', () => {
    expect(firstSelectableIndex([false, false, true, true])).toBe(2);
    expect(firstSelectableIndex([false])).toBeNull();
    expect(firstSelectableIndex([])).toBeNull();
  });
});

describe('RadioGroup — what assistive tech is told', () => {
  it('is a named group of radios, not a row of toggle buttons', () => {
    render(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'מעלית' });
    expect(group).toBeInTheDocument();
    expect(radios()).toHaveLength(ELEVATOR.length);
    // `aria-pressed` would say these are independent toggles, which is exactly
    // what an elevator answer is not.
    for (const radio of radios()) expect(radio).not.toHaveAttribute('aria-pressed');
  });

  it('states the unchecked options rather than omitting them', () => {
    render(<Harness initial="small" />);
    expect(screen.getAllByRole('radio', { checked: false })).toHaveLength(ELEVATOR.length - 1);
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1);
  });

  it('publishes the axis it is laid out on', () => {
    render(<Harness orientation="horizontal" />);
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-orientation', 'horizontal');
  });

  it('names the group even when the question is not shown', () => {
    render(<Harness showLabel={false} />);
    expect(screen.getByRole('radiogroup', { name: 'מעלית' })).toBeInTheDocument();
    expect(screen.getByText('מעלית')).toHaveClass('sr-only');
  });

  it('ships no words of its own in either language', () => {
    // Every label on screen came from the caller. A Hebrew-first product cannot
    // have English chrome leaking out of its design system.
    render(<Harness options={[{ value: 'a', label: 'Alpha' }]} />);
    expect(screen.getByRole('radiogroup').textContent).toBe('Alpha');
  });
});

describe('RadioGroup — one answer, and "no answer" is a real state', () => {
  it('starts with nothing checked, rather than pretending the first is chosen', () => {
    // A booking flow has to tell "no lift" from "hasn't answered yet", because
    // only one of those may be priced.
    render(<Harness />);
    expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0);
  });

  it('reports the choice once, when it changes', () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup label="מעלית" options={ELEVATOR} value={null} onValueChange={onValueChange} />,
    );

    fireEvent.click(radios()[1] as HTMLElement);
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('small');
  });

  it('does not re-report a choice that is already the answer', () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup label="מעלית" options={ELEVATOR} value="small" onValueChange={onValueChange} />,
    );
    fireEvent.click(radios()[1] as HTMLElement);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('replaces the answer rather than adding to it', () => {
    render(<Harness />);
    fireEvent.click(radios()[0] as HTMLElement);
    expect(checkedValue()).toBe('none');

    fireEvent.click(radios()[3] as HTMLElement);
    expect(checkedValue()).toBe('service');
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1);
  });
});

describe('RadioGroup — roving tabindex', () => {
  it('is one stop in the tab order, not one per option', () => {
    render(<Harness initial="standard" />);
    const stops = radios().filter((radio) => radio.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
    expect(stops[0]?.textContent).toBe('מעלית רגילה');
  });

  it('gives the stop to the first choosable option when nothing is chosen', () => {
    // Otherwise a customer who has answered nothing tabs through five parking
    // options to reach the button underneath them.
    render(<Harness />);
    expect(radios()[0]).toHaveAttribute('tabindex', '0');
    for (const radio of radios().slice(1)) expect(radio).toHaveAttribute('tabindex', '-1');
  });

  it('skips a refused option when handing out the stop', () => {
    render(
      <Harness
        options={[
          { value: 'none', label: 'אין מעלית', disabled: true },
          { value: 'small', label: 'מעלית קטנה' },
        ]}
      />,
    );
    expect(radios()[0]).toHaveAttribute('tabindex', '-1');
    expect(radios()[1]).toHaveAttribute('tabindex', '0');
  });

  it('moves the stop with the answer', () => {
    render(<Harness />);
    fireEvent.click(radios()[2] as HTMLElement);
    expect(radios()[2]).toHaveAttribute('tabindex', '0');
    expect(radios()[0]).toHaveAttribute('tabindex', '-1');
  });
});

describe('RadioGroup — the keyboard moves the answer, RTL-correctly', () => {
  function press(key: string) {
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key });
  }

  it('Hebrew: ArrowLeft goes to the next option, because the next one is to the left', () => {
    render(
      <DirectionProvider locale="he">
        <Harness initial="none" />
      </DirectionProvider>,
    );
    press('ArrowLeft');
    expect(checkedValue()).toBe('small');
    press('ArrowRight');
    expect(checkedValue()).toBe('none');
  });

  it('English: ArrowRight goes to the next option', () => {
    render(
      <DirectionProvider locale="en">
        <Harness initial="none" />
      </DirectionProvider>,
    );
    press('ArrowRight');
    expect(checkedValue()).toBe('small');
    press('ArrowLeft');
    expect(checkedValue()).toBe('none');
  });

  it('defaults to Hebrew with no provider above it, because that is the product', () => {
    render(<Harness initial="none" />);
    press('ArrowLeft');
    expect(checkedValue()).toBe('small');
  });

  it('moves down and up regardless of language', () => {
    render(
      <DirectionProvider locale="he">
        <Harness initial="none" />
      </DirectionProvider>,
    );
    press('ArrowDown');
    expect(checkedValue()).toBe('small');
    press('ArrowUp');
    expect(checkedValue()).toBe('none');
  });

  it('wraps at both ends', () => {
    render(<Harness initial="none" />);
    press('ArrowUp');
    expect(checkedValue()).toBe('service');
    press('ArrowDown');
    expect(checkedValue()).toBe('none');
  });

  it('jumps to the ends with Home and End', () => {
    render(<Harness initial="small" />);
    press('End');
    expect(checkedValue()).toBe('service');
    press('Home');
    expect(checkedValue()).toBe('none');
  });

  it('takes the focus with the answer, so the two never disagree', () => {
    render(<Harness initial="none" />);
    (radios()[0] as HTMLElement).focus();
    press('ArrowDown');
    expect(document.activeElement).toBe(radios()[1]);
    expect(radios()[1]).toHaveAttribute('aria-checked', 'true');
  });

  it('starts from the tab stop when nothing has been chosen yet', () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowDown' });
    expect(checkedValue()).toBe('small');
  });

  it('leaves a key it does not own to the page behind it', () => {
    render(<Harness initial="none" />);
    const event = fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'PageDown' });
    expect(event).toBe(true);
    expect(checkedValue()).toBe('none');
  });

  it('is selected by Space and Enter, which a native button already does', () => {
    render(<Harness />);
    fireEvent.click(radios()[2] as HTMLElement);
    expect(checkedValue()).toBe('standard');
    expect(radios()[2]).toHaveAttribute('type', 'button');
  });
});

describe('RadioGroup — a refused option', () => {
  const withRefusal: readonly RadioOption[] = [
    { value: 'none', label: 'אין מעלית' },
    { value: 'small', label: 'מעלית קטנה', disabled: true },
    { value: 'standard', label: 'מעלית רגילה' },
  ];

  it('says it is unavailable without leaving the document', () => {
    render(<Harness options={withRefusal} initial="none" />);
    // Never the native attribute: disabling the element that holds focus is how
    // a browser is told to drop focus to <body>, which walks a user straight
    // past a Sheet's focus trap.
    expect(radios()[1]).toHaveAttribute('aria-disabled', 'true');
    expect(radios()[1]).toBeEnabled();
  });

  it('is stepped over by the arrow keys', () => {
    render(<Harness options={withRefusal} initial="none" />);
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowDown' });
    expect(checkedValue()).toBe('standard');
  });

  it('refuses a click rather than acting on it', () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup label="מעלית" options={withRefusal} value="none" onValueChange={onValueChange} />,
    );
    fireEvent.click(radios()[1] as HTMLElement);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('refuses every option when the whole group is switched off', () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup
        label="מעלית"
        options={ELEVATOR}
        value="none"
        onValueChange={onValueChange}
        disabled
      />,
    );
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-disabled', 'true');
    for (const radio of radios()) {
      expect(radio).toHaveAttribute('aria-disabled', 'true');
      expect(radio).toBeEnabled();
    }

    fireEvent.click(radios()[2] as HTMLElement);
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowDown' });
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe('RadioGroup — selection is not carried by colour alone', () => {
  function classesOf(element: HTMLElement): Set<string> {
    return new Set(element.className.split(/\s+/).filter(Boolean));
  }

  it('adds a mark that survives a greyscale screen', () => {
    render(<Harness initial="small" />);
    const checked = radios()[1] as HTMLElement;
    expect(checked.querySelector('[data-icon="check"]')).not.toBeNull();
    expect((radios()[0] as HTMLElement).querySelector('[data-icon="check"]')).toBeNull();
  });

  it('hides that mark from assistive tech, which already has aria-checked', () => {
    render(<Harness initial="small" />);
    expect((radios()[1] as HTMLElement).querySelector('[data-icon="check"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('changes at least one channel that is not colour', () => {
    render(<Harness initial="none" />);
    const idle = classesOf(radios()[1] as HTMLElement);
    const selected = classesOf(radios()[0] as HTMLElement);
    const changed = [...selected].filter((token) => !idle.has(token));

    const colourless = changed.filter((token) => /^(?:border-\d|font-)/.test(token));
    expect(
      colourless.length,
      `selection changed only colour: ${changed.join(' ')}`,
    ).toBeGreaterThan(0);
  });

  it('leaves the label’s weight to the chip recipe, so the weight step still happens', () => {
    // A `font-medium` written onto the label would override the recipe and quietly
    // delete one of the three non-colour channels.
    render(<Harness initial="small" />);
    const label = (radios()[1] as HTMLElement).querySelector('span > span');
    expect(label?.className ?? '').not.toMatch(/font-/);
  });
});

describe('RadioGroup — built for bad conditions', () => {
  it.each(['sm', 'md'] as const)('%s clears the 44px tap-target floor', (size) => {
    // A grid of adjacent targets is exactly where the floor stops being
    // theoretical: a mis-tap here answers a different question about the move.
    render(<Harness size={size} />);
    const height = resolvedMinHeightPx((radios()[0] as HTMLElement).className);
    expect(height, 'no class compiles to a min-height').not.toBeNull();
    expect(height).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
    expect(height).toBe(controlHeightsPx[size]);
  });

  it('renders no class without a rule behind it', () => {
    render(<Harness initial="small" orientation="vertical" />);
    const rendered = radios()
      .flatMap((radio) => radio.className.split(/\s+/))
      .filter(Boolean);
    const dead = [...new Set(rendered)].filter((className) => !compilesToARule(className));
    expect(dead, `classes with no CSS behind them: ${dead.join(', ')}`).toEqual([]);
  });

  it('carries a focus-visible ring, inherited from the chip recipe', () => {
    render(<Harness />);
    const classes = (radios()[0] as HTMLElement).classList;
    expect(classes.contains('focus-visible:ring-2')).toBe(true);
    expect(classes.contains('focus-visible:ring-ink-2')).toBe(true);
  });

  it('lays a vertical option out along the reading direction, never a physical one', () => {
    render(<Harness orientation="vertical" />);
    const classes = (radios()[0] as HTMLElement).classList;
    expect(classes.contains('text-start')).toBe(true);
    expect(classes.contains('justify-start')).toBe(true);
    expect(classes.contains('w-full')).toBe(true);
  });

  it('shows the detail line a four-answer question needs', () => {
    render(<Harness />);
    expect(screen.getByText('אנשים, לא ספות')).toBeInTheDocument();
  });

  it('gives a two-line option leading, which only the compiled sheet can witness', () => {
    // The chip recipe ends `text-step-0 leading-none`, which is a line box for
    // a single-line chip. Composed unchanged it stacks both lines of a vertical
    // option in 17px boxes for 17px text, and Hebrew descenders — ק, ן, ך, ף —
    // land on the letters of the line below. That is the elevator question this
    // component was written for. jsdom lays out no text, so the class attribute
    // cannot be asked and the stylesheet has to be.
    render(<Harness orientation="vertical" />);
    const option = radios()[1] as HTMLElement;
    expect(option).toHaveTextContent('אנשים, לא ספות');

    const declarations = option.className
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((token) => {
        const value = declaredValue(token, 'line-height');
        return value === null ? [] : [{ token, value }];
      });

    expect(declarations.length, 'nothing on the option declares a line-height').toBeGreaterThan(0);
    for (const { token, value } of declarations) {
      expect(resolvedLeading(token, value), token).toBe(lineHeights['step-0']);
    }
    // 1 is what `leading-none` declared, and the difference is the collision.
    expect(lineHeights['step-0']).toBeGreaterThan(1);
  });
});

/**
 * A declared `line-height`, followed through the theme to the number a browser
 * would use. `text-step-0` writes its own as
 * `var(--tw-leading, var(--text-step-0--line-height))`, so the innermost
 * variable is the one that decides it while no `leading-*` utility has set
 * `--tw-leading` — and a utility that sets one is read the same way.
 */
function resolvedLeading(className: string, declared: string): number {
  const innermost = [...declared.matchAll(/--[\w-]+/g)].map(([name]) => name).at(-1);
  if (innermost === undefined) return Number.parseFloat(declared);
  return Number.parseFloat(themeValue(innermost, cssFor([className])) ?? 'NaN');
}
