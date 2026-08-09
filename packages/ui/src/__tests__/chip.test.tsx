import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chip, chipVariants } from '../components/chip.js';
import { MIN_TAP_TARGET_PX, controlHeightsPx } from '../tokens/size.js';
import { resolvedMinHeightPx } from './helpers/stylesheet.js';

/**
 * The two things a chip must never get wrong: it has to announce whether it is
 * selected, and it has to *show* that without spending the whole signal on
 * colour. Both are asserted here as behaviour — what assistive tech is told, and
 * whether a channel other than colour actually changed — rather than as a
 * snapshot of the classes that happen to be on it today.
 */

afterEach(cleanup);

function classesOf(element: HTMLElement): Set<string> {
  return new Set(element.className.split(/\s+/).filter(Boolean));
}

/** Resolved through the compiled stylesheet — see the note in button.test.tsx. */
function minHeightPx(element: HTMLElement): number {
  const height = resolvedMinHeightPx(element.className);
  expect(height, `no class on "${element.className}" compiles to a min-height`).not.toBeNull();
  return height as number;
}

describe('Chip — what assistive tech is told', () => {
  it('is a toggle button carrying its own pressed state', () => {
    render(<Chip selected>ספה תלת-מושבית</Chip>);
    // aria-pressed, deliberately, and not role="option": these chips are
    // independent toggles with no owning listbox to supply roving focus.
    expect(
      screen.getByRole('button', { name: 'ספה תלת-מושבית', pressed: true }),
    ).toBeInTheDocument();
  });

  it('announces the unselected state rather than omitting it', () => {
    render(<Chip>ספה תלת-מושבית</Chip>);
    // An absent aria-pressed is a plain button, not an unpressed toggle, and a
    // screen-reader user would never learn the control is selectable.
    expect(screen.getByRole('button', { pressed: false })).toBeInTheDocument();
  });

  it('follows the selection it is given', () => {
    const onClick = vi.fn();
    function Toggle() {
      const [on, setOn] = useState(false);
      return (
        <Chip
          selected={on}
          onClick={() => {
            setOn(!on);
            onClick();
          }}
        >
          מיטה וחצי
        </Chip>
      );
    }

    render(<Toggle />);
    const chip = screen.getByRole('button');
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick while disabled', () => {
    const onClick = vi.fn();
    render(
      <Chip disabled onClick={onClick}>
        פסנתר כנף
      </Chip>,
    );
    const chip = screen.getByRole('button');
    expect(chip).toBeDisabled();
    fireEvent.click(chip);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Chip — selection is not carried by colour alone', () => {
  it('adds a mark that survives a greyscale screen', () => {
    const selected = render(<Chip selected>ארון 3 דלתות</Chip>).container;
    expect(selected.querySelector('[data-chip-check]')).not.toBeNull();

    cleanup();

    const idle = render(<Chip>ארון 3 דלתות</Chip>).container;
    expect(idle.querySelector('[data-chip-check]')).toBeNull();
  });

  it('hides that mark from assistive tech, which already has aria-pressed', () => {
    const { container } = render(<Chip selected>ארון 3 דלתות</Chip>);
    expect(container.querySelector('[data-chip-check]')).toHaveAttribute('aria-hidden', 'true');
  });

  it('changes at least one channel that is not colour', () => {
    // Diff the two rendered states and throw away everything that is only a
    // colour. Something has to survive. If a future restyle expresses selection
    // purely as a fill, this fails — which is the point of computing it rather
    // than asserting the classes someone wrote today.
    render(<Chip>ארון 3 דלתות</Chip>);
    const idle = classesOf(screen.getByRole('button'));
    cleanup();

    render(<Chip selected>ארון 3 דלתות</Chip>);
    const changed = [...classesOf(screen.getByRole('button'))].filter((token) => !idle.has(token));

    const colourless = changed.filter((token) => /^(?:border-\d|font-)/.test(token));
    expect(
      colourless.length,
      `selection changed only colour: ${changed.join(' ')}`,
    ).toBeGreaterThan(0);
  });

  it('never renders amber — a selected chip is not money', () => {
    expect(chipVariants({ state: 'selected' })).not.toContain('hivis');
    expect(chipVariants({ state: 'idle' })).not.toContain('hivis');
  });
});

describe('Chip — built for bad conditions', () => {
  it.each(['sm', 'md'] as const)('%s clears the 44px tap-target floor', (size) => {
    render(<Chip size={size}>שולחן</Chip>);
    const height = minHeightPx(screen.getByRole('button'));

    expect(height).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
    expect(height).toBe(controlHeightsPx[size]);
  });

  it('carries a focus-visible ring', () => {
    render(<Chip>שולחן</Chip>);
    const classes = screen.getByRole('button').classList;
    expect(classes.contains('focus-visible:ring-2')).toBe(true);
    expect(classes.contains('focus-visible:ring-ink-2')).toBe(true);
  });

  it('lets a caller’s className override the chip’s own background', () => {
    render(
      <Chip selected className="bg-card">
        שולחן
      </Chip>,
    );
    const classes = screen.getByRole('button').classList;

    expect(classes.contains('bg-card')).toBe(true);
    expect(classes.contains('bg-route')).toBe(false);
    // ...and leaves the groups the caller did not touch alone.
    expect(classes.contains('text-on-route')).toBe(true);
  });
});
