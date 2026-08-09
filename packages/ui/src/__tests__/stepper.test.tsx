import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectionProvider } from '../components/direction.js';
import {
  MIN_TARGET_SEPARATION_PX,
  STEPPER_COPY,
  Stepper,
  clampStepperValue,
} from '../components/stepper.js';
import { MIN_TAP_TARGET_PX } from '../tokens/size.js';
import { compilesToARule } from './helpers/stylesheet.js';

afterEach(cleanup);

/** Any Hebrew letter. Used to prove an English surface says none of them. */
const HEBREW = /[֐-׿]/;

function StepperHarness({
  initial = 0,
  min,
  max,
}: {
  initial?: number;
  min?: number;
  max?: number;
}) {
  const [value, setValue] = useState(initial);
  return <Stepper label="ארגז" value={value} onValueChange={setValue} min={min} max={max} />;
}

function targets(): { remove: HTMLElement; add: HTMLElement } {
  return {
    remove: screen.getByRole('button', { name: 'הסרת ארגז' }),
    add: screen.getByRole('button', { name: 'הוספת ארגז' }),
  };
}

/** The digit a person actually sees, as opposed to the sentence beside it. */
function shownDigit(): string {
  const live = screen.getByRole('status');
  return live.querySelector('[aria-hidden="true"]')?.textContent ?? '';
}

/**
 * A control that will not act, stated the only way that keeps it focusable.
 *
 * `toBeEnabled` is the load-bearing half: the native attribute is what takes
 * focus off the element holding it, which is the failure this whole shape
 * exists to avoid.
 */
function expectRefusing(control: HTMLElement): void {
  expect(control).toHaveAttribute('aria-disabled', 'true');
  expect(control).toBeEnabled();
}

function expectOffering(control: HTMLElement): void {
  expect(control).not.toHaveAttribute('aria-disabled');
  expect(control).toBeEnabled();
}

describe('clampStepperValue — the arithmetic, on its own', () => {
  it('never returns a value outside the declared range', () => {
    for (let raw = -5; raw <= 10; raw += 1) {
      const clamped = clampStepperValue(raw, 0, 4);
      expect(clamped).toBeGreaterThanOrEqual(0);
      expect(clamped).toBeLessThanOrEqual(4);
    }
  });

  it('never goes negative', () => {
    expect(clampStepperValue(-1, 0, 99)).toBe(0);
    expect(clampStepperValue(-1000, 0, 99)).toBe(0);
  });

  it('holds a floor above zero for a control whose lowest legitimate answer is not zero', () => {
    expect(clampStepperValue(1, 2, 4)).toBe(2);
    expect(clampStepperValue(9, 2, 4)).toBe(4);
  });

  it('counts whole things', () => {
    expect(clampStepperValue(2.4, 0, 9)).toBe(2);
    expect(clampStepperValue(2.5, 0, 9)).toBe(3);
    expect(clampStepperValue(Number.NaN, 2, 4)).toBe(2);
  });

  it('refuses an impossible range rather than inventing an answer', () => {
    expect(() => clampStepperValue(3, 5, 1)).toThrow(RangeError);
  });
});

describe('Stepper — clamping at both ends', () => {
  it('counts up and down', () => {
    render(<StepperHarness initial={2} />);
    const { remove, add } = targets();

    fireEvent.click(add);
    expect(shownDigit()).toBe('3');

    fireEvent.click(remove);
    expect(shownDigit()).toBe('2');
  });

  it('refuses the decrement at the minimum instead of letting it do nothing', () => {
    const onValueChange = vi.fn();
    render(<Stepper label="ארגז" value={0} onValueChange={onValueChange} />);
    const { remove, add } = targets();

    expectRefusing(remove);
    expectOffering(add);

    fireEvent.click(remove);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('refuses the increment at the maximum', () => {
    const onValueChange = vi.fn();
    render(<Stepper label="ארגז" value={4} onValueChange={onValueChange} min={2} max={4} />);
    const { remove, add } = targets();

    expectRefusing(add);
    expectOffering(remove);

    fireEvent.click(add);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('refuses both ends while the caller has the whole control switched off', () => {
    const onValueChange = vi.fn();
    render(<Stepper label="ארגז" value={2} onValueChange={onValueChange} disabled />);
    const { remove, add } = targets();

    expectRefusing(remove);
    expectRefusing(add);

    fireEvent.click(remove);
    fireEvent.click(add);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('never emits a value outside the range, even from a value that already was', () => {
    const onValueChange = vi.fn();
    render(<Stepper label="ארגז" value={-3} onValueChange={onValueChange} />);

    // The screen says 0, so `+` means one more than 0. Not -2, and not 0 either:
    // a press that left the digit where it is would read as a dead button.
    expect(shownDigit()).toBe('0');
    fireEvent.click(targets().add);
    expect(onValueChange).toHaveBeenCalledWith(1);

    expectRefusing(targets().remove);
  });

  it('walks the whole range without ever leaving it', () => {
    render(<StepperHarness initial={2} min={2} max={4} />);
    const { remove, add } = targets();

    for (let press = 0; press < 6; press += 1) fireEvent.click(add);
    expect(shownDigit()).toBe('4');

    for (let press = 0; press < 6; press += 1) fireEvent.click(remove);
    expect(shownDigit()).toBe('2');
  });
});

/**
 * Finding 7. Disabling the element under focus is how a browser is told to hand
 * focus to `<body>`, and inside a Sheet that is a walk straight past the focus
 * trap — the trap only hears Tab while focus is still in its own subtree.
 */
describe('Stepper — focus is never taken away', () => {
  it('keeps focus on the button that just hit the minimum', () => {
    render(<StepperHarness initial={1} />);
    const { remove, add } = targets();

    remove.focus();
    expect(document.activeElement).toBe(remove);

    fireEvent.click(remove);
    expect(shownDigit()).toBe('0');
    expectRefusing(remove);
    expect(document.activeElement).toBe(remove);

    // The assertion that does the work. jsdom does not implement the browser's
    // "unfocus a disabled element" step, so `activeElement` reads as unmoved
    // even under the bug; what a native `disabled` costs in jsdom and in a
    // browser alike is the ability to be focused at all.
    add.focus();
    remove.focus();
    expect(document.activeElement).toBe(remove);
  });

  it('keeps focus on the button that just hit the maximum', () => {
    render(<StepperHarness initial={3} min={2} max={4} />);
    const { remove, add } = targets();

    add.focus();
    expect(document.activeElement).toBe(add);

    fireEvent.click(add);
    expect(shownDigit()).toBe('4');
    expectRefusing(add);
    expect(document.activeElement).toBe(add);

    remove.focus();
    add.focus();
    expect(document.activeElement).toBe(add);
  });

  it('leaves a switched-off control in the tab order rather than removing it', () => {
    render(<Stepper label="ארגז" value={2} onValueChange={() => undefined} disabled />);
    const { remove, add } = targets();

    for (const control of [remove, add]) {
      expect(control).not.toHaveAttribute('tabindex');
      control.focus();
      expect(document.activeElement).toBe(control);
    }
  });
});

/**
 * Finding 13. The header claims a fractional or out-of-range value is resolved
 * rather than rendered, so the rendered digit is what gets asserted.
 */
describe('Stepper — what is on screen is what the buttons operate on', () => {
  it('resolves a fractional value instead of displaying it', () => {
    render(<Stepper label="ארגז" value={2.5} onValueChange={() => undefined} />);
    expect(shownDigit()).toBe('3');
    expect(screen.getByRole('status')).toHaveTextContent('3 × ארגז');
  });

  it('shows the floor while a caller is still below it, and counts on from there', () => {
    const onValueChange = vi.fn();
    render(
      <Stepper
        label="גודל צוות"
        value={0}
        min={2}
        max={4}
        onValueChange={onValueChange}
        formatValue={(crew) => `${crew} מובילים`}
      />,
    );

    // Never "0 מובילים" with the minus already refusing — the state that reads
    // as a broken control on the frame before the quote's crew size arrives.
    expect(shownDigit()).toBe('2');
    expect(screen.getByRole('status')).toHaveTextContent('2 מובילים');
    expectRefusing(screen.getByRole('button', { name: 'הסרת גודל צוות' }));

    fireEvent.click(screen.getByRole('button', { name: 'הוספת גודל צוות' }));
    expect(onValueChange).toHaveBeenCalledWith(3);
  });

  it('shows the ceiling while a caller is still above it', () => {
    render(<Stepper label="ארגז" value={12} max={4} onValueChange={() => undefined} />);
    expect(shownDigit()).toBe('4');
    expectRefusing(targets().add);
  });
});

/**
 * Finding 21. The two default names are the only copy this component authors,
 * and copy that cannot switch language is copy that announces Hebrew to an
 * English screen reader.
 */
describe('Stepper — the words it authors', () => {
  it('says both of them in both languages', () => {
    for (const [name, phrase] of Object.entries(STEPPER_COPY)) {
      // A Latin label, so what is being measured is the verb rather than the noun.
      expect(phrase.he('X'), name).toMatch(HEBREW);
      expect(phrase.en('X'), name).not.toMatch(HEBREW);
    }
  });

  it('defaults to Hebrew with no provider above it, because that is the product', () => {
    render(<StepperHarness />);
    expect(screen.getByRole('button', { name: 'הסרת ארגז' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הוספת ארגז' })).toBeInTheDocument();
  });

  it('announces no Hebrew at all on an English surface', () => {
    render(
      <DirectionProvider locale="en">
        <Stepper label="Boxes" value={1} onValueChange={() => undefined} showLabel />
      </DirectionProvider>,
    );

    expect(screen.getByRole('button', { name: 'Remove Boxes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Boxes' })).toBeInTheDocument();

    const spoken = [
      ...screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? ''),
      screen.getByRole('group').textContent ?? '',
      screen.getByRole('status').textContent ?? '',
    ];
    for (const phrase of spoken) expect(phrase).not.toMatch(HEBREW);
  });

  it('takes the locale from a prop when the surrounding one is not the right answer', () => {
    render(
      <DirectionProvider locale="he">
        <Stepper label="Pallets" value={1} onValueChange={() => undefined} locale="en" />
      </DirectionProvider>,
    );

    expect(screen.getByRole('button', { name: 'Remove Pallets' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Pallets' })).toBeInTheDocument();
  });

  it('still lets a caller say what the generic form cannot', () => {
    render(
      <DirectionProvider locale="en">
        <Stepper
          label="Crew size"
          value={2}
          min={2}
          max={4}
          onValueChange={() => undefined}
          addLabel="צוות גדול יותר"
          removeLabel="צוות קטן יותר"
        />
      </DirectionProvider>,
    );

    expect(screen.getByRole('button', { name: 'צוות גדול יותר' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'צוות קטן יותר' })).toBeInTheDocument();
  });
});

describe('Stepper — announcement', () => {
  it('carries the new value in a polite live region', () => {
    render(<StepperHarness initial={2} />);
    const live = screen.getByRole('status');

    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveAttribute('aria-atomic', 'true');
    expect(live).toHaveTextContent('2 × ארגז');

    fireEvent.click(targets().add);
    expect(live).toHaveTextContent('3 × ארגז');
  });

  it('lets the crew control say something a quantity sentence cannot', () => {
    render(
      <Stepper
        label="גודל צוות"
        value={2}
        min={2}
        max={4}
        onValueChange={() => undefined}
        addLabel="צוות גדול יותר"
        removeLabel="צוות קטן יותר"
        formatValue={(value) => `${value} מובילים`}
        size="lg"
        showLabel
      />,
    );

    expect(screen.getByRole('group', { name: 'גודל צוות' })).toBeInTheDocument();
    expectOffering(screen.getByRole('button', { name: 'צוות גדול יותר' }));
    expectRefusing(screen.getByRole('button', { name: 'צוות קטן יותר' }));
    expect(screen.getByRole('status')).toHaveTextContent('2 מובילים');
  });

  it('names the group even when the label is not shown', () => {
    render(<StepperHarness />);
    expect(screen.getByRole('group', { name: 'ארגז' })).toBeInTheDocument();
    expect(screen.getByText('ארגז')).toHaveClass('sr-only');
  });
});

describe('Stepper — one-handed geometry', () => {
  it('gives both targets at least the tap-target floor', () => {
    render(<StepperHarness />);
    const { remove, add } = targets();

    for (const target of [remove, add]) {
      expect(Number.parseFloat(target.style.minInlineSize)).toBeGreaterThanOrEqual(
        MIN_TAP_TARGET_PX,
      );
      expect(Number.parseFloat(target.style.minBlockSize)).toBeGreaterThanOrEqual(
        MIN_TAP_TARGET_PX,
      );
    }
  });

  it('keeps a full target width of clear space between them', () => {
    render(<StepperHarness />);
    const separation = Number.parseFloat(screen.getByRole('status').style.minInlineSize);

    expect(separation).toBeGreaterThanOrEqual(MIN_TARGET_SEPARATION_PX);
    expect(MIN_TARGET_SEPARATION_PX).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
  });
});

/**
 * The refusal is a visual state as well as an ARIA one, and it is drawn from
 * `data-disabled` rather than `:disabled` — a variant the compiler has to agree
 * exists, since a class that emits nothing would leave a refused button looking
 * exactly like one that will act.
 */
describe('Stepper — the refusal has CSS behind it', () => {
  it('renders no class without a rule behind it', () => {
    render(<StepperHarness />);
    const { remove, add } = targets();

    const rendered = [remove, add]
      .flatMap((element) => element.className.split(/\s+/))
      .filter(Boolean);
    const dead = [...new Set(rendered)].filter((className) => !compilesToARule(className));

    expect(dead, `classes with no CSS behind them: ${dead.join(', ')}`).toEqual([]);
  });

  it('draws the refused edge, and cancels the hover and press states under it', () => {
    for (const className of [
      'data-disabled:text-ink-3',
      'data-disabled:cursor-not-allowed',
      'data-disabled:hover:bg-transparent',
      'data-disabled:active:bg-transparent',
    ]) {
      expect(compilesToARule(className), className).toBe(true);
    }
  });
});
