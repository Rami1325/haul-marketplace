import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, buttonTones, buttonVariants, type ButtonTone } from '../components/button.js';
import { colorThemes, type ColorToken, type ThemeName } from '../tokens/color.js';
import { contrastRatio, meetsAA, meetsNonText } from '../tokens/contrast.js';
import { MIN_TAP_TARGET_PX, controlHeightsPx, controlSizes } from '../tokens/size.js';
import { declaresFixedHeightPx, resolvedMinHeightPx } from './helpers/stylesheet.js';

/**
 * Behaviour, not markup. Almost nothing here would fail if the button were
 * restyled, and everything here would fail if it stopped doing its job: refusing
 * a second click while a payment authorization is in flight, keeping its name
 * while busy, reporting its progress somewhere assistive technology can actually
 * reach, staying above the tap-target floor, and letting a caller's `className`
 * actually win.
 *
 * The contrast blocks compute rather than claim. A tone whose label stops
 * clearing AA, or a focus ring that disappears against a tone's fill, is a
 * failing test in this file rather than a discovery made outdoors.
 */

afterEach(cleanup);

const THEMES: readonly ThemeName[] = ['light', 'dark'];

/** The ground each tone puts its label on. Ghost has no fill of its own. */
const TONE_FILL: Readonly<Record<ButtonTone, ColorToken>> = {
  route: 'route',
  quiet: 'card',
  ghost: 'paper',
  destructive: 'rust',
};

/** The label tone each fill carries. */
const TONE_LABEL: Readonly<Record<ButtonTone, ColorToken>> = {
  route: 'onRoute',
  quiet: 'route',
  ghost: 'route',
  destructive: 'onRoute',
};

function ratio(theme: ThemeName, a: ColorToken, b: ColorToken): number {
  const scale = colorThemes[theme];
  return contrastRatio(scale[a], scale[b]);
}

/**
 * Resolved through the compiled stylesheet rather than read back out of the
 * class attribute. A regex over `className` only proves a string was written —
 * it passed for every size while the button had no height rule whatsoever.
 */
function minHeightPx(element: HTMLElement): number {
  const height = resolvedMinHeightPx(element.className);
  expect(height, `no class on "${element.className}" compiles to a min-height`).not.toBeNull();
  return height as number;
}

describe('Button — the action', () => {
  it('renders a native button with its label as the accessible name', () => {
    render(<Button>המשך</Button>);
    expect(screen.getByRole('button', { name: 'המשך' })).toHaveAttribute('type', 'button');
  });

  it('does not submit a surrounding form unless the caller asks it to', () => {
    render(<Button type="submit">שלח</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('fires onClick when it is idle and enabled', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Continue</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('Button — the states that cost money when they are wrong', () => {
  it('does not fire onClick while disabled', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Continue
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not fire onClick while loading', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Matching
      </Button>,
    );
    const button = screen.getByRole('button');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('authorizes once when Book this move is double-tapped', () => {
    // The real failure mode: the first tap is accepted, the button turns busy,
    // and the second tap of an impatient thumb lands before the screen changes.
    // Two authorizations is two holds on somebody's card.
    const authorize = vi.fn();

    function BookThisMove() {
      const [busy, setBusy] = useState(false);
      return (
        <Button
          loading={busy}
          onClick={() => {
            setBusy(true);
            authorize();
          }}
        >
          הזמנת ההובלה
        </Button>
      );
    }

    render(<BookThisMove />);
    const button = screen.getByRole('button', { name: 'הזמנת ההובלה' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(authorize).toHaveBeenCalledTimes(1);
  });

  it('stays focusable and keeps its accessible name while busy', () => {
    render(<Button loading>הזמנת ההובלה</Button>);
    const button = screen.getByRole('button', { name: 'הזמנת ההובלה' });

    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    // Not `disabled`: a disabled element drops focus, and a screen-reader user
    // is told the control vanished rather than that it is working.
    expect(button).not.toBeDisabled();
    button.focus();
    expect(button).toHaveFocus();
  });

  it('does not hand a ghost button a surface on the way to being disabled', () => {
    // The filled disabled treatment would leave a disabled ghost looking more
    // present than an enabled one. The compound rule must replace it, not stack
    // with it — if both survive, the winner is stylesheet order.
    const ghost = new Set(buttonVariants({ tone: 'ghost' }).split(/\s+/).filter(Boolean));
    expect(ghost.has('data-disabled:bg-transparent')).toBe(true);
    expect(ghost.has('data-disabled:bg-paper-2')).toBe(false);

    const filled = new Set(buttonVariants({ tone: 'route' }).split(/\s+/).filter(Boolean));
    expect(filled.has('data-disabled:bg-paper-2')).toBe(true);
  });

  it('is not busy or disabled when it is neither', () => {
    render(<Button>Continue</Button>);
    const button = screen.getByRole('button');
    expect(button).not.toHaveAttribute('aria-busy');
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).not.toHaveAttribute('data-loading');
  });
});

/**
 * The progress has to reach the accessibility tree, and the only way to prove
 * that in jsdom is to prove it is not inside the button. `getByRole` here is not
 * evidence on its own: dom-testing-library does not implement ARIA's
 * children-presentational rule, so a `role="progressbar"` nested in a `<button>`
 * is found by every query in this file and by no browser on earth. These tests
 * assert the structure the rule actually leaves standing.
 */
describe('Button — loading is progress, never a spinner', () => {
  it('renders the drawn bar as decoration, not as the semantics', () => {
    render(
      <Button loading progress={0.4}>
        Matching
      </Button>,
    );
    const button = screen.getByRole('button');
    const track = button.querySelector('[data-progress-track]');

    expect(track).not.toBeNull();
    expect(track).toHaveAttribute('aria-hidden', 'true');
    // A role here is pruned along with the rest of a button's subtree, so the
    // value would be written, rendered, tested — and never announced.
    expect(button.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('puts the progressbar outside the button and points the button at it', () => {
    const { container } = render(
      <Button loading progress={0.4}>
        Matching
      </Button>,
    );
    const button = screen.getByRole('button');
    const bar = screen.getByRole('progressbar');

    expect(button.contains(bar)).toBe(false);
    expect(container.contains(bar)).toBe(true);
    expect(bar.id).not.toBe('');
    expect(button.getAttribute('aria-describedby')?.split(' ')).toContain(bar.id);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('[class*="animate-spin"]')).toBeNull();
  });

  it('adds its description to the caller’s instead of replacing it', () => {
    render(
      <Button loading progress={0.4} aria-describedby="matching-copy">
        Matching
      </Button>,
    );
    const described = screen.getByRole('button').getAttribute('aria-describedby')?.split(' ') ?? [];

    expect(described).toContain('matching-copy');
    expect(described).toContain(screen.getByRole('progressbar').id);
  });

  it('reports an unknown wait as indeterminate rather than inventing a number', () => {
    render(<Button loading>Matching</Button>);
    const bar = screen.getByRole('progressbar');
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).toHaveAttribute('data-progress', 'indeterminate');
    expect(bar.textContent).toBe('');
  });

  it('reports a known fraction as a percentage, in the surrounding locale', () => {
    render(
      <Button loading progress={0.4}>
        Matching
      </Button>,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('data-progress', 'determinate');
    // Text as well as value, because a description is read as the text of the
    // element it points at as often as it is read as that element's value. It is
    // formatted from the locale, never typed: no default in this file is a word.
    expect(bar.textContent).toBe(
      new Intl.NumberFormat('he', { style: 'percent', maximumFractionDigits: 0 }).format(0.4),
    );
    expect(bar).not.toHaveAttribute('aria-valuetext');
  });

  it('clamps a progress value that came from arithmetic rather than from a designer', () => {
    render(
      <Button loading progress={1.7}>
        Matching
      </Button>,
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('does not talk over the screen on every tick', () => {
    // The value is published to be read, not shouted. A polite live region here
    // would re-announce on every frame of a match and bury the sentence that
    // matters when the match lands.
    const { container, rerender } = render(
      <Button loading progress={0.1}>
        Matching
      </Button>,
    );
    expect(container.querySelector('[aria-live]')).toBeNull();

    rerender(
      <Button loading progress={0.9}>
        Matching
      </Button>,
    );
    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '90');
  });

  it('never moves focus when it becomes busy', () => {
    // Progress arriving is not a reason to take a customer out of whatever they
    // were reading, and a busy button must not lose the focus it already had.
    function Matching({ busy }: { busy: boolean }) {
      return (
        <Button loading={busy} progress={busy ? 0.2 : undefined}>
          הזמנת ההובלה
        </Button>
      );
    }

    const { rerender } = render(<Matching busy={false} />);
    const button = screen.getByRole('button');
    button.focus();

    rerender(<Matching busy />);
    expect(button).toHaveFocus();
  });

  it('shows no progress affordance when it is not loading', () => {
    const { container } = render(<Button>Continue</Button>);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(container.querySelector('[data-progress-track]')).toBeNull();
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-describedby');
  });
});

describe('Button — built for bad conditions', () => {
  it.each(controlSizes)('%s clears the 44px tap-target floor', (size) => {
    render(<Button size={size}>Continue</Button>);
    const height = minHeightPx(screen.getByRole('button'));

    expect(height).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
    // And it is the token's height, not a number that happens to be large
    // enough — the floor lives in the token, not in this component.
    expect(height).toBe(controlHeightsPx[size]);
  });

  it('states its height as a minimum, so a control still grows with dynamic type', () => {
    render(<Button>Continue</Button>);
    const className = screen.getByRole('button').className;
    // The property that compiles must be min-height. A fixed `height` would cap
    // the control at the token and clip the label the moment a user turns their
    // system font size up — which is the setting this audience is most likely
    // to have changed.
    expect(resolvedMinHeightPx(className)).toBe(controlHeightsPx.md);
    expect(declaresFixedHeightPx(className)).toBe(false);
  });

  it('carries a focus-visible ring rather than relying on the browser default', () => {
    render(<Button>Continue</Button>);
    const classes = screen.getByRole('button').classList;
    expect(classes.contains('focus-visible:ring-2')).toBe(true);
    expect(classes.contains('focus-visible:ring-ink-2')).toBe(true);
    expect(classes.contains('focus-visible:ring-offset-paper')).toBe(true);
  });

  it.each(THEMES)(
    '%s — the focus indicator stays visible against every tone and the page',
    (theme) => {
      // contrast.test.ts proves no single colour clears 3:1 against both a filled
      // button and the page, which is why the ring is two-tone. Here that
      // construction is checked against the fills this component actually emits:
      // the ink-2 ring must separate from the page, and either the paper offset
      // must separate from the fill or the ring must do it directly.
      for (const tone of buttonTones) {
        const fill = TONE_FILL[tone];
        expect(meetsNonText(ratio(theme, 'ink2', 'paper')), `${tone} ring on page`).toBe(true);
        expect(
          meetsNonText(ratio(theme, 'paper', fill)) || meetsNonText(ratio(theme, 'ink2', fill)),
          `${tone} indicator against its own fill`,
        ).toBe(true);
      }
    },
  );

  it.each(THEMES)('%s — every tone puts its label at AA on its own fill', (theme) => {
    for (const tone of buttonTones) {
      expect(meetsAA(ratio(theme, TONE_LABEL[tone], TONE_FILL[tone])), `${tone} in ${theme}`).toBe(
        true,
      );
    }
  });

  it('never renders amber — amber means money or attention, and an action is neither', () => {
    for (const tone of buttonTones) {
      expect(buttonVariants({ tone })).not.toContain('hivis');
    }
  });
});

describe('Button — className is the caller’s, and it wins', () => {
  it('overrides the tone’s own background instead of stacking with it', () => {
    render(<Button className="bg-paper-2">Continue</Button>);
    const classes = screen.getByRole('button').classList;

    expect(classes.contains('bg-paper-2')).toBe(true);
    // The losing class must be *absent*. If both survive, the winner is decided
    // by stylesheet order, which is a build detail rather than an instruction.
    expect(classes.contains('bg-route')).toBe(false);
  });

  it('keeps classes from groups the caller did not touch', () => {
    render(<Button className="bg-paper-2">Continue</Button>);
    const classes = screen.getByRole('button').classList;
    expect(classes.contains('text-on-route')).toBe(true);
    expect(classes.contains('rounded-md')).toBe(true);
  });
});

describe('Button — polymorphic, without losing what a button is', () => {
  it('renders an anchor that keeps the tone and the ring', () => {
    render(
      <Button as="a" href="/quote">
        המשך להצעה
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'המשך להצעה' });

    expect(link).toHaveAttribute('href', '/quote');
    expect(link.classList.contains('bg-route')).toBe(true);
    expect(link.classList.contains('focus-visible:ring-2')).toBe(true);
    // `type` belongs to a button element and nowhere else.
    expect(link).not.toHaveAttribute('type');
  });

  it('takes the href away from a disabled anchor rather than only labelling it', () => {
    const onClick = vi.fn();
    render(
      <Button as="a" href="/quote" disabled onClick={onClick}>
        המשך להצעה
      </Button>,
    );
    const anchor = screen.getByText('המשך להצעה');

    expect(anchor).not.toHaveAttribute('href');
    expect(anchor).toHaveAttribute('aria-disabled', 'true');
    expect(anchor).toHaveAttribute('tabindex', '-1');
    fireEvent.click(anchor);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('accepts a ref as an ordinary prop', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Continue</Button>);
    expect(ref.current).toBe(screen.getByRole('button'));
  });
});
