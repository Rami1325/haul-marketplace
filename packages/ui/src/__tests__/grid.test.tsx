import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Grid, gridVariants } from '../components/grid.js';
import { stackGapClasses } from '../components/stack.js';
import { spaceTokens } from '../tokens/space.js';
import { tileSizes, tileSizesPx, tileSizesRem } from '../tokens/size.js';
import { ROOT_FONT_SIZE_PX } from '../tokens/type.js';
import { compilesToARule, cssFor, declaredValue, themeValue } from './helpers/stylesheet.js';

/**
 * A grid is mostly a class list, so almost everything worth asserting here has
 * to be asserted through the compiled stylesheet rather than through the class
 * attribute. `grid-cols-[repeat(auto-fill,minmax(var(--tile-md),1fr))]` written
 * with the token interpolated instead of referenced produces exactly the same
 * `class` attribute and no CSS at all — the tiles would then be one column wide
 * on the flagship screen, in a browser, with every render test green.
 *
 * The behavioural claims are the two that decide layouts: that `min` overrules
 * `columns` rather than stacking with it, and that a caller's own class wins.
 */

afterEach(cleanup);

function classesOf(element: HTMLElement): Set<string> {
  return new Set(element.className.split(/\s+/).filter(Boolean));
}

describe('Grid — the column rule reaches the stylesheet', () => {
  it.each(['1', '2', '3', '4', '5', '6'] as const)('a fixed count of %s compiles', (columns) => {
    const className = gridVariants({ columns });
    const token = [...className.split(/\s+/)].find((c) => c.startsWith('grid-cols-'));
    expect(token, className).toBeDefined();
    expect(declaredValue(token as string, 'grid-template-columns')).toContain(`repeat(${columns}`);
  });

  it.each(['sm', 'md', 'lg'] as const)('a %s tile floor compiles and names its token', (min) => {
    const className = gridVariants({ min });
    const token = [...className.split(/\s+/)].find((c) => c.startsWith('grid-cols-['));
    expect(token, className).toBeDefined();

    const declared = declaredValue(token as string, 'grid-template-columns');
    expect(declared).toContain('auto-fill');
    expect(declared).toContain(`var(--tile-${min})`);

    // And the variable the class points at actually holds the token's value —
    // a rule referencing a custom property nobody declared is a column count of
    // one, silently.
    expect(themeValue(`--tile-${min}`, cssFor([token as string]))).toBe(tileSizes[min]);
  });

  it('gives every class it can render CSS behind it', () => {
    const dead = [
      ...classesOf(
        render(<Grid min="md" gap="6" align="center" />).container.firstElementChild as HTMLElement,
      ),
    ].filter((className) => !compilesToARule(className));
    expect(dead, `classes with no CSS behind them: ${dead.join(', ')}`).toEqual([]);
  });
});

describe('Grid — a tile floor overrules a column count', () => {
  it('keeps only the auto-fill template when both are asked for', () => {
    // Both produce `grid-template-columns`. If both survived, the winner would
    // be stylesheet order, which is a build detail rather than an instruction.
    const classes = new Set(gridVariants({ columns: '4', min: 'md' }).split(/\s+/));
    expect(classes.has('grid-cols-4')).toBe(false);
    expect(classes.has('grid-cols-[repeat(auto-fill,minmax(min(var(--tile-md),100%),1fr))]')).toBe(
      true,
    );
  });

  it('leaves the column count alone when no floor is asked for', () => {
    const classes = new Set(gridVariants({ columns: '4' }).split(/\s+/));
    expect(classes.has('grid-cols-4')).toBe(true);
  });

  it('defaults to a fixed pair, so a caller who says nothing gets something predictable', () => {
    render(<Grid data-testid="grid" />);
    const classes = classesOf(screen.getByTestId('grid'));
    expect(classes.has('grid-cols-2')).toBe(true);
    expect(classes.has('grid')).toBe(true);
  });
});

describe('Grid — the overflow bug it exists to prevent', () => {
  it('caps the track floor at the container, so one tile cannot outgrow the grid', () => {
    // `minmax(var(--tile-*), 1fr)` always lays at least one track whose minimum
    // is the raw token, so a container narrower than the floor gets a column
    // wider than the grid and the page scrolls sideways. `min-w-0` floors the
    // items; it says nothing about the track.
    for (const min of ['sm', 'md', 'lg'] as const) {
      const token = gridVariants({ min })
        .split(/\s+/)
        .find((candidate) => candidate.startsWith('grid-cols-['));
      expect(token, min).toBeDefined();

      const declared = declaredValue(token as string, 'grid-template-columns');
      expect(declared, min).toMatch(
        new RegExp(
          String.raw`minmax\(\s*min\(\s*var\(--tile-${min}\)\s*,\s*100%\s*\)\s*,\s*1fr\s*\)`,
        ),
      );
    }

    // The premise in numbers, because it is not a narrow-phone edge case: a
    // customer on 'Large' browser text has a 20px root, which makes the large
    // floor wider than the content box a Sheet leaves on a 320px screen.
    expect(tileSizesRem.lg * 20).toBeGreaterThan(256);
  });

  it('floors its own minimum width and its children’s', () => {
    // A grid item's default minimum size is its content, so one long unbroken
    // string — an address, a Hebrew place name — makes its column wider than its
    // share and pushes the whole grid past the viewport.
    render(<Grid data-testid="grid" />);
    const classes = classesOf(screen.getByTestId('grid'));
    expect(classes.has('min-w-0')).toBe(true);
    expect(classes.has('*:min-w-0')).toBe(true);
    expect(compilesToARule('*:min-w-0')).toBe(true);
  });
});

describe('Grid — the gap scale is the space scale', () => {
  it('shares its gap table with Stack rather than restating it', () => {
    // A token added to the scale must reach both layout primitives, and the only
    // way to guarantee that is for there to be one table.
    expect(gridVariants.recipe.variants.gap).toBe(stackGapClasses);
  });

  it('names every space token and nothing else', () => {
    expect(Object.keys(stackGapClasses)).toEqual([...spaceTokens]);
  });

  it('sets a tighter default than Stack, because a grid spends its gap twice', () => {
    render(<Grid data-testid="grid" />);
    expect(classesOf(screen.getByTestId('grid')).has('gap-3')).toBe(true);
  });
});

describe('Grid — className is the caller’s, and it wins', () => {
  it('overrides the template instead of stacking with it', () => {
    render(<Grid columns="2" className="grid-cols-1" data-testid="grid" />);
    const classes = classesOf(screen.getByTestId('grid'));
    expect(classes.has('grid-cols-1')).toBe(true);
    expect(classes.has('grid-cols-2')).toBe(false);
  });

  it('keeps the groups the caller did not touch', () => {
    render(<Grid className="grid-cols-1" data-testid="grid" />);
    const classes = classesOf(screen.getByTestId('grid'));
    expect(classes.has('gap-3')).toBe(true);
    expect(classes.has('items-stretch')).toBe(true);
  });

  it('passes everything else through to the element', () => {
    render(
      <Grid id="items" aria-label="פריטים" data-testid="grid">
        <span>ארגז</span>
      </Grid>,
    );
    const grid = screen.getByTestId('grid');
    expect(grid).toHaveAttribute('id', 'items');
    expect(grid).toHaveAttribute('aria-label', 'פריטים');
    expect(grid).toHaveTextContent('ארגז');
  });
});

describe('the tile tokens', () => {
  it('keeps the rem strings, the rem numbers and the px numbers in agreement', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      expect(tileSizes[size]).toBe(`${tileSizesRem[size]}rem`);
      expect(tileSizesPx[size]).toBeCloseTo(tileSizesRem[size] * ROOT_FONT_SIZE_PX, 6);
    }
  });

  it('orders the ladder', () => {
    expect(tileSizesRem.sm).toBeLessThan(tileSizesRem.md);
    expect(tileSizesRem.md).toBeLessThan(tileSizesRem.lg);
  });

  it('states them in rem, because a tile floor is a content measurement', () => {
    // The opposite call from the tap-target floor, which is px because 44 is a
    // claim about a fingertip and a user who shrinks their text has not thereby
    // acquired smaller hands. A tile has to grow with what is inside it.
    for (const size of ['sm', 'md', 'lg'] as const) {
      expect(tileSizes[size].endsWith('rem'), size).toBe(true);
    }
  });
});
