import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LiveRegion,
  LiveRegionProvider,
  useAnnounce,
  type Politeness,
} from '../components/live-region.js';

/**
 * A live region is the one piece of accessibility machinery whose failures are
 * completely invisible to everyone who can see the screen. Every assertion here
 * is therefore about the mechanism rather than about the sentence: that the
 * element exists before the text does, that a repeated sentence is announced
 * again, and that an assertive interruption stays reserved for the things worth
 * interrupting for.
 */

afterEach(cleanup);

function regions(politeness: Politeness): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-live-region="${politeness}"]`)];
}

function spoken(politeness: Politeness): string[] {
  return regions(politeness)
    .map((region) => region.textContent ?? '')
    .filter((text) => text.length > 0);
}

describe('LiveRegion — the element exists before the sentence does', () => {
  it('renders the region with nothing in it', () => {
    // The failure this prevents: mounting a region and its text in one commit.
    // A screen reader watches regions that were present when the page settled,
    // so the element it would have watched did not exist a frame earlier and
    // the announcement reaches nobody.
    render(<LiveRegion />);
    const region = regions('polite')[0];
    expect(region).toBeDefined();
    expect(region?.textContent).toBe('');
  });

  it('keeps the same element when the sentence arrives', () => {
    const { rerender } = render(<LiveRegion />);
    const before = regions('polite')[0];

    rerender(<LiveRegion message="נמצא מוביל" />);
    expect(regions('polite')[0]).toBe(before);
    expect(before?.textContent).toBe('נמצא מוביל');
  });

  it('is present to a screen reader and absent to the eye', () => {
    render(<LiveRegion message="נמצא מוביל" />);
    const region = regions('polite')[0];
    // Not `hidden` and not `display: none` — a region a browser does not render
    // is a region a screen reader does not watch.
    expect(region).toHaveClass('sr-only');
    expect(region).not.toHaveAttribute('hidden');
    expect(region).not.toHaveAttribute('aria-hidden');
  });

  it('declares polite politeness and reads itself whole', () => {
    render(<LiveRegion message="3 × ארגז" />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    // Atomic, or a reader announces "3" where the sentence says "3 × ארגז".
    expect(region).toHaveAttribute('aria-atomic', 'true');
  });

  it('uses the alert role for an interruption, so the two are not one setting', () => {
    render(<LiveRegion message="התשלום נכשל" politeness="assertive" />);
    const region = screen.getByRole('alert');
    expect(region).toHaveAttribute('aria-live', 'assertive');
  });

  it('lets a caller turn atomic off for a region that reports a running total', () => {
    render(<LiveRegion message="x" atomic={false} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'false');
  });
});

function Announcer({ message, politeness }: { message: string; politeness?: Politeness }) {
  const announce = useAnnounce();
  return (
    <button type="button" onClick={() => announce(message, politeness)}>
      say
    </button>
  );
}

describe('LiveRegionProvider — an announcer for things that are not components', () => {
  it('mounts both regions of both politenesses up front', () => {
    render(
      <LiveRegionProvider>
        <span>content</span>
      </LiveRegionProvider>,
    );
    expect(regions('polite')).toHaveLength(2);
    expect(regions('assertive')).toHaveLength(2);
    expect(spoken('polite')).toEqual([]);
  });

  it('announces what it is given', () => {
    render(
      <LiveRegionProvider>
        <Announcer message="נמצא מוביל" />
      </LiveRegionProvider>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(spoken('polite')).toEqual(['נמצא מוביל']);
  });

  it('says the same sentence twice, which is the whole reason there are two slots', () => {
    // A live region announces when its contents *change*. Writing identical text
    // into one region twice is a no-op, and the second time is the one the
    // customer needed — the first told them something they already knew.
    render(
      <LiveRegionProvider>
        <Announcer message="המחיר עודכן" />
      </LiveRegionProvider>,
    );
    const button = screen.getByRole('button');

    fireEvent.click(button);
    const first = regions('polite').findIndex((region) => region.textContent !== '');

    fireEvent.click(button);
    const second = regions('polite').findIndex((region) => region.textContent !== '');

    expect(spoken('polite')).toEqual(['המחיר עודכן']);
    expect(second).not.toBe(first);
  });

  it('keeps the two politenesses in separate regions', () => {
    render(
      <LiveRegionProvider>
        <Announcer message="נמצא מוביל" />
        <Announcer message="התשלום נכשל" politeness="assertive" />
      </LiveRegionProvider>,
    );
    const [polite, assertive] = screen.getAllByRole('button');
    fireEvent.click(polite as HTMLElement);
    fireEvent.click(assertive as HTMLElement);

    expect(spoken('polite')).toEqual(['נמצא מוביל']);
    expect(spoken('assertive')).toEqual(['התשלום נכשל']);
  });

  it('refuses to announce nothing', () => {
    render(
      <LiveRegionProvider>
        <Announcer message="" />
      </LiveRegionProvider>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(spoken('polite')).toEqual([]);
  });

  it('renders its children, since it is a provider and not a wrapper', () => {
    render(
      <LiveRegionProvider>
        <p>המחיר נעול</p>
      </LiveRegionProvider>,
    );
    expect(screen.getByText('המחיר נעול')).toBeInTheDocument();
  });
});

describe('useAnnounce outside a provider', () => {
  it('does nothing rather than taking the screen down', () => {
    // A leaf that wanted to announce something cannot mount an app-level region
    // to fix it, and throwing would mean a component rendered in a test or a
    // story fails over an announcement nobody was listening for.
    render(<Announcer message="נמצא מוביל" />);
    expect(() => fireEvent.click(screen.getByRole('button'))).not.toThrow();
    expect(regions('polite')).toHaveLength(0);
  });

  it('hands back a function that is stable across renders', () => {
    // Stable, so it is safe in a dependency array and a component that captured
    // it once does not go stale.
    const seen: unknown[] = [];
    function Capture() {
      seen.push(useAnnounce());
      return null;
    }
    const { rerender } = render(
      <LiveRegionProvider>
        <Capture />
      </LiveRegionProvider>,
    );
    act(() => {
      rerender(
        <LiveRegionProvider>
          <Capture />
        </LiveRegionProvider>,
      );
    });

    expect(seen.length).toBeGreaterThan(1);
    expect(new Set(seen).size).toBe(1);
  });
});
