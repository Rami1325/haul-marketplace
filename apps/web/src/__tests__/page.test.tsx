import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import HomePage from '@/app/[locale]/page.js';
import { he } from '@/i18n/messages/he.js';
import { MessagesProvider, useT } from '@/i18n/provider.js';

/**
 * ---------------------------------------------------------------------------
 * The page renders, and the number on it is a shekel figure
 * ---------------------------------------------------------------------------
 * A small suite on purpose. jsdom parses no CSS, so nothing here can tell you
 * whether the page *looks* right — that question belongs to
 * `tailwind.node.test.ts`, which asks the stylesheet instead of the class
 * attribute. Confusing the two is how `@haul/ui` ended up with green tap-target
 * tests sitting on buttons that had no height rule at all.
 *
 * What this can prove is that the server component composes: that awaiting
 * `params` produces an element, that the design system's client components
 * render inside it, and that the amount arrives through `formatILS` with its ₪
 * intact rather than as a bare number or an escaped entity.
 * ---------------------------------------------------------------------------
 */

/** A server component is a function returning a promise of an element. */
const renderPage = async (locale: string): Promise<ReactElement> =>
  HomePage({ params: Promise.resolve({ locale }) });

describe('the page', () => {
  it('renders Hebrew chrome, a shekel figure and a control', async () => {
    render(await renderPage('he'));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('HAUL');
    expect(screen.getByText(he.tagline)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: he.startBooking })).toBeInTheDocument();
  });

  it('shows the amount with its currency sign, not a bare number', async () => {
    // ₪ U+20AA is the largest glyph on a Price Card and the one character in
    // this product that a Latin-only font subset silently drops. If it is
    // missing from the string, no font decision downstream can put it back.
    const { container } = render(await renderPage('he'));
    expect(container.textContent).toContain('₪');
    expect(container.textContent).toContain('1,890.00');
  });

  it('renders the English catalog under the English locale', async () => {
    const { container } = render(await renderPage('en'));
    expect(container.textContent).toContain('Locked price');
    expect(container.textContent).not.toContain(he.priceLockLabel);
  });
});

describe('useT', () => {
  function Probe(): ReactElement {
    return <span>{useT().startBooking}</span>;
  }

  it('serves the catalog it is given', () => {
    render(
      <MessagesProvider messages={{ ...he, startBooking: 'בדיקה' }}>
        <Probe />
      </MessagesProvider>,
    );
    expect(screen.getByText('בדיקה')).toBeInTheDocument();
  });

  it('falls back to Hebrew rather than throwing when nothing wrapped it', () => {
    // The same argument `@haul/ui` makes for `DEFAULT_DIRECTION`: if the
    // provider-free path threw, the quickest way to render anything would be to
    // leave the provider off — and whatever that produced is what would get
    // reviewed. A default has to be the product's real default.
    render(<Probe />);
    expect(screen.getByText(he.startBooking)).toBeInTheDocument();
  });
});
