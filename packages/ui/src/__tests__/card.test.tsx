import { cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Card, cardVariants } from '../components/card.js';

/**
 * A card has almost no behaviour, so the tests that matter here are the ones
 * that keep it from acquiring any. The Price Card is the signature object; every
 * assertion below exists to stop this component from growing the emphasis that
 * would let a screen compete with it.
 */

afterEach(cleanup);

function classesOf(element: HTMLElement): Set<string> {
  return new Set(element.className.split(/\s+/).filter(Boolean));
}

const ELEVATIONS = ['flat', 'raised'] as const;
const PADDINGS = ['none', 'snug', 'roomy'] as const;

describe('Card — the surface', () => {
  it('renders its children', () => {
    render(<Card>סה״כ היום</Card>);
    expect(screen.getByText('סה״כ היום')).toBeInTheDocument();
  });

  it('passes attributes through, so a card can be a labelled region', () => {
    render(
      <Card role="region" aria-label="פירוט המחיר" data-testid="breakdown">
        ₪248.00
      </Card>,
    );
    const region = screen.getByRole('region', { name: 'פירוט המחיר' });
    expect(region).toHaveAttribute('data-testid', 'breakdown');
  });

  it('accepts a ref as an ordinary prop', () => {
    const ref = createRef<HTMLDivElement>();
    render(<Card ref={ref}>סה״כ היום</Card>);
    expect(ref.current).toBe(screen.getByText('סה״כ היום'));
  });
});

describe('Card — quiet by default', () => {
  it('is flat unless asked otherwise', () => {
    render(<Card data-testid="card">x</Card>);
    const classes = classesOf(screen.getByTestId('card'));
    expect(classes.has('shadow-none')).toBe(true);
    expect(classes.has('shadow-xs')).toBe(false);
  });

  it('draws its edge, because luminance alone does not identify a raised surface', () => {
    // contrast.test.ts measures card against paper at 1.09:1 in both themes and
    // records why that is correct. The consequence is that the hairline is
    // load-bearing rather than decorative.
    render(<Card data-testid="card">x</Card>);
    const classes = classesOf(screen.getByTestId('card'));
    expect(classes.has('border')).toBe(true);
    expect(classes.has('border-line')).toBe(true);
  });

  it('offers elevation as the only escalation, and a shallow one', () => {
    render(
      <Card elevation="raised" data-testid="card">
        x
      </Card>,
    );
    const classes = classesOf(screen.getByTestId('card'));
    expect(classes.has('shadow-xs')).toBe(true);
    expect(classes.has('shadow-none')).toBe(false);
  });

  it('never competes with the Price Card — no fill, no amber, in any combination', () => {
    for (const elevation of ELEVATIONS) {
      for (const padding of PADDINGS) {
        const className = cardVariants({ elevation, padding });
        const label = `${elevation}/${padding}`;
        expect(className, label).not.toContain('hivis');
        expect(className, label).not.toContain('bg-route');
        expect(className, label).not.toContain('bg-rust');
        // Elevation stays shallow: a shadow says "raised", never "important".
        expect(className, label).not.toMatch(/shadow-(?:md|lg|xl|2xl)/);
      }
    }
  });
});

describe('Card — padding comes from the space scale', () => {
  it.each(PADDINGS)('%s resolves to a single padding class', (padding) => {
    render(
      <Card padding={padding} data-testid="card">
        x
      </Card>,
    );
    const applied = [...classesOf(screen.getByTestId('card'))].filter((token) => /^p-/.test(token));
    expect(applied.length).toBe(padding === 'none' ? 0 : 1);
  });
});

describe('Card — className is the caller’s, and it wins', () => {
  it('overrides the card’s own background instead of stacking with it', () => {
    render(
      <Card className="bg-paper-2" data-testid="card">
        x
      </Card>,
    );
    const classes = classesOf(screen.getByTestId('card'));

    expect(classes.has('bg-paper-2')).toBe(true);
    expect(classes.has('bg-card')).toBe(false);
    // The groups the caller did not touch are untouched.
    expect(classes.has('border-line')).toBe(true);
    expect(classes.has('rounded-lg')).toBe(true);
  });

  it('lets a caller override the padding variant it did not want', () => {
    render(
      <Card padding="roomy" className="p-2" data-testid="card">
        x
      </Card>,
    );
    const classes = classesOf(screen.getByTestId('card'));
    expect(classes.has('p-2')).toBe(true);
    expect(classes.has('p-6')).toBe(false);
  });
});
