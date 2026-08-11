import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DirectionProvider } from '../components/direction.js';
import { Progress, progressVariants } from '../components/progress.js';
import { percentLabel } from '../lib/percent.js';
import { colorThemes, type ColorToken, type ThemeName } from '../tokens/color.js';
import { contrastRatio, meetsNonText } from '../tokens/contrast.js';
import { indeterminateSweep } from '../tokens/motion.js';
import { space, type SpaceToken } from '../tokens/space.js';
import { compilesToARule, cssFor, declaredValue, themeValue } from './helpers/stylesheet.js';

/**
 * The rule this component exists to keep is a product rule: `PLAN.html` bans
 * spinners because a spinner during matching feels like nothing is happening.
 * So the assertions are about what a wait actually reports — a real
 * `progressbar` in the accessibility tree, an unknown length reported as
 * unknown rather than as an invented number, and an indeterminate state that is
 * a bar rather than a rotation.
 *
 * The Button's own progress bar is asserted separately and differently, and the
 * difference is the point: a button's children are pruned from the
 * accessibility tree, so that one has to publish its role on a sibling. Nothing
 * prunes this one.
 */

afterEach(cleanup);

const THEMES: readonly ThemeName[] = ['light', 'dark'];

function ratio(theme: ThemeName, a: ColorToken, b: ColorToken): number {
  const scale = colorThemes[theme];
  return contrastRatio(scale[a], scale[b]);
}

function fill(): HTMLElement {
  const element = document.querySelector('[data-progress-fill]');
  expect(element, 'no progress fill rendered').not.toBeNull();
  return element as HTMLElement;
}

describe('Progress — it is in the accessibility tree', () => {
  it('publishes the role on the visible bar, not on a hidden sibling', () => {
    const { container } = render(<Progress label="מחפשים מוביל" value={0.4} />);
    const bar = screen.getByRole('progressbar');

    expect(container.contains(bar)).toBe(true);
    expect(bar).not.toHaveClass('sr-only');
    // The fill lives inside it. A progressbar's children are presentational, so
    // that is paint and nothing else — which is exactly why it is safe here and
    // was not inside a button.
    expect(bar.contains(fill())).toBe(true);
  });

  it('carries a name, so the figure is not a number with no noun', () => {
    render(<Progress label="מחפשים מוביל" value={0.4} />);
    expect(screen.getByRole('progressbar', { name: 'מחפשים מוביל' })).toBeInTheDocument();
  });

  it('names itself even when the caller hides the label', () => {
    render(<Progress label="מחפשים מוביל" value={0.4} showLabel={false} />);
    expect(screen.getByRole('progressbar', { name: 'מחפשים מוביל' })).toBeInTheDocument();
    expect(screen.getByText('מחפשים מוביל')).toHaveClass('sr-only');
  });

  it('reports a known fraction as whole percent', () => {
    render(<Progress label="מחפשים מוביל" value={0.4} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '40');
  });

  it('clamps a fraction that came from arithmetic rather than from a designer', () => {
    render(<Progress label="מחפשים" value={1.7} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');

    cleanup();

    render(<Progress label="מחפשים" value={-3} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });
});

describe('Progress — an unknown wait is reported as unknown', () => {
  it('omits the value rather than inventing one', () => {
    // Absence is what states "length unknown". A zero would state "no progress
    // at all", which is a different and false claim.
    render(<Progress label="מחפשים מוביל" />);
    const bar = screen.getByRole('progressbar');
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar.closest('[data-progress]')).toHaveAttribute('data-progress', 'indeterminate');
  });

  it('shows no percentage beside a bar that has no percentage', () => {
    const { container } = render(<Progress label="מחפשים מוביל" />);
    expect(container.textContent).toBe('מחפשים מוביל');
  });

  it('treats a value that is not a number as unknown', () => {
    render(<Progress label="מחפשים" value={Number.NaN} />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });
});

describe('Progress — indeterminate is a bar, never a spinner', () => {
  it('sweeps rather than rotates', () => {
    const { container } = render(<Progress label="מחפשים מוביל" />);
    const classes = fill().className;

    expect(classes).toContain(`animate-${indeterminateSweep.token}`);
    expect(container.querySelector('[class*="animate-spin"]')).toBeNull();
  });

  it('animates a logical size, so the bar grows from the reading start', () => {
    // A transform does not follow the writing direction. Animating `inline-size`
    // is what makes the same rule correct in Hebrew and in English.
    const compiled = cssFor([`animate-${indeterminateSweep.token}`]);
    expect(compiled).toContain(`@keyframes ${indeterminateSweep.name}`);
    expect(compiled).toContain('inline-size');
    expect(compiled).not.toMatch(/translate|rotate/);
  });

  it('never starts from nothing, because a zero-width bar reads as no bar', () => {
    expect(Number.parseFloat(indeterminateSweep.from)).toBeGreaterThan(0);
  });

  it('swaps the sweep for a pulse under prefers-reduced-motion', () => {
    // A size animation is movement and is what the setting exists to suppress.
    // Removing it outright would leave a full bar sitting at 100%, which reads
    // as finished — the one thing an indeterminate bar must not say.
    expect(fillClassesOf(<Progress label="מחפשים" />)).toContain('motion-reduce:animate-pulse');
    expect(compilesToARule('motion-reduce:animate-pulse')).toBe(true);
    expect(cssFor(['motion-reduce:animate-pulse'])).toContain('prefers-reduced-motion: reduce');
  });

  it('lets the reduced-motion rule actually win, which is a source-order fact', () => {
    const compiled = cssFor([`animate-${indeterminateSweep.token}`, 'motion-reduce:animate-pulse']);
    expect(compiled.indexOf('motion-reduce')).toBeGreaterThan(
      compiled.indexOf(`.animate-${indeterminateSweep.token} {`),
    );
  });
});

describe('Progress — a known fraction is drawn as one', () => {
  it('sizes the fill along the inline axis, never a physical one', () => {
    render(<Progress label="מחפשים" value={0.4} />);
    expect(fill().style.inlineSize).toBe('40%');
    expect(fill().style.width).toBe('');
  });

  it('travels between two figures instead of teleporting', () => {
    render(<Progress label="מחפשים" value={0.2} />);
    expect(fill().className).toContain('transition-[inline-size]');
    expect(compilesToARule('transition-[inline-size]')).toBe(true);
    expect(fill().className).toContain('motion-reduce:transition-none');
  });

  it('shows the percentage in the surrounding locale, formatted rather than typed', () => {
    // Through the shared formatter, whose own output is pinned in
    // `percent.test.ts`. Rebuilding the expectation with the same
    // `new Intl.NumberFormat(…)` call the module makes would be that function
    // run twice — and for both shipped locales it produces the literal "40%",
    // which is exactly the hand-typed form the module exists to prevent.
    render(
      <DirectionProvider locale="he">
        <Progress label="מחפשים" value={0.4} />
      </DirectionProvider>,
    );
    expect(screen.getByText(percentLabel('he', 40))).toBeInTheDocument();
  });

  it('hides that text from assistive tech, which already has aria-valuenow', () => {
    render(<Progress label="מחפשים" value={0.4} />);
    expect(screen.getByText(percentLabel('he', 40))).toHaveAttribute('aria-hidden', 'true');
  });

  it('lets a caller suppress the figure without suppressing the bar', () => {
    render(<Progress label="מחפשים" value={0.4} showValue={false} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    expect(screen.queryByText(/%|٪/)).toBeNull();
  });
});

describe('Progress — nothing here speaks on a timer', () => {
  it('publishes no live region at all', () => {
    // A polite region wired to a percentage re-announces on every tick and
    // buries the sentence that matters when the match lands.
    const { container, rerender } = render(<Progress label="מחפשים" value={0.1} />);
    expect(container.querySelector('[aria-live]')).toBeNull();

    rerender(<Progress label="מחפשים" value={0.9} />);
    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '90');
  });
});

describe('Progress — how it looks in bad conditions', () => {
  it.each(['sm', 'md', 'lg'] as const)('%s takes its height from the space scale', (size) => {
    // Resolved through the stylesheet, so a renamed spacing token is a failing
    // test rather than a bar with no height at all.
    const className = progressVariants({ size });
    const token = className.split(/\s+/).find((candidate) => /^h-\d/.test(candidate));
    expect(token, className).toBeDefined();

    const declared = declaredValue(token as string, 'height');
    const variable = /var\((--[\w-]+)\)/.exec(declared ?? '')?.[1];
    expect(variable, declared ?? 'no height declared').toMatch(/^--spacing-/);

    const name = (variable as string).replace('--spacing-', '') as SpaceToken;
    expect(themeValue(variable as string, cssFor([token as string]))).toBe(space[name]);
  });

  it('clips the fill so a pill track stays a pill', () => {
    expect(declaredValue('overflow-hidden', 'overflow')).toBe('hidden');
    expect(progressVariants({})).toContain('overflow-hidden');
  });

  it.each(THEMES)('%s — the fill separates from the track it sits in', (theme) => {
    // This is the contrast that carries the *value*: how much is filled. The
    // track's own edge is context, and a track at 3:1 would be a second bar.
    expect(meetsNonText(ratio(theme, 'route', 'paper2')), theme).toBe(true);
  });

  it.each(THEMES)('%s — the fill separates from both grounds it can sit on', (theme) => {
    expect(meetsNonText(ratio(theme, 'route', 'paper')), `${theme} on paper`).toBe(true);
    expect(meetsNonText(ratio(theme, 'route', 'card')), `${theme} on card`).toBe(true);
  });

  it('never renders amber — a wait is neither money nor attention', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      expect(progressVariants({ size })).not.toContain('hivis');
    }
    expect(fillClassesOf(<Progress label="מחפשים" value={0.4} />)).not.toContain('hivis');
  });

  it('renders no class without a rule behind it', () => {
    render(<Progress label="מחפשים" value={0.4} />);
    const bar = screen.getByRole('progressbar');
    const rendered = [bar.className, fill().className]
      .flatMap((value) => value.split(/\s+/))
      .filter(Boolean);
    const dead = [...new Set(rendered)].filter((className) => !compilesToARule(className));
    expect(dead, `classes with no CSS behind them: ${dead.join(', ')}`).toEqual([]);
  });
});

/** Renders once, reads the fill's classes, and cleans up after itself. */
function fillClassesOf(element: React.ReactElement): string {
  render(element);
  const classes = fill().className;
  cleanup();
  return classes;
}
