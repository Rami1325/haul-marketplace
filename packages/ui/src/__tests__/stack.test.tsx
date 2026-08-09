import { DEFAULT_LOCALE, directionFor } from '@haul/types';
import { cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DIRECTION,
  DirectionProvider,
  directionAttributes,
  useDirection,
} from '../components/direction.js';
import { Stack, stackGapClasses, stackVariants } from '../components/stack.js';
import { spaceTokens } from '../tokens/space.js';

/**
 * Layout and direction are tested together because they are the same claim: a
 * horizontal stack is only correct in Hebrew if the direction reached the DOM,
 * and the direction only matters because something downstream lays out along
 * it. Testing either alone proves nothing about the pair.
 */

afterEach(cleanup);

const DIRECTIONS = ['column', 'row'] as const;
const ALIGNS = ['start', 'center', 'end', 'stretch', 'baseline'] as const;
const JUSTIFIES = ['start', 'center', 'end', 'between'] as const;
const WRAPS = ['nowrap', 'wrap'] as const;

/** The same rules `__tests__/rtl.test.ts` enforces on source, applied to output. */
const PHYSICAL = /(?<!\w)(?:p[lr]-|m[lr]-|(?:left|right)-|text-(?:left|right)\b)/;

function renderStack(ui: ReactElement): HTMLElement {
  const { container } = render(ui);
  const element = container.firstElementChild;
  if (!(element instanceof HTMLElement)) throw new Error('Stack rendered nothing');
  return element;
}

describe('Stack', () => {
  it('is a flex container that stacks downward by default', () => {
    const element = renderStack(<Stack />);
    expect(element.className).toContain('flex');
    expect(element.className).toContain('flex-col');
    expect(element.className).toContain('gap-4');
  });

  it('never lets one long unbroken string push a row wider than its parent', () => {
    // A Hebrew place name or an email address with nowhere to break. Without
    // this the overflow appears on the narrowest phone, not on a laptop.
    expect(renderStack(<Stack />).className).toContain('min-w-0');
  });

  it('lays a row along the reading direction with no conditional anywhere', () => {
    // Flexbox's main axis is flow-relative, so `flex-row` already starts at the
    // inline start. `flex-row-reverse` would mean left-to-right in Hebrew, which
    // is why it is not offered.
    const row = stackVariants({ direction: 'row' });
    expect(row).toContain('flex-row');
    expect(row).not.toContain('reverse');
    expect(stackVariants({ direction: 'row', justify: 'start' })).toContain('justify-start');
  });

  it('names its gaps from the space scale, and from all of it', () => {
    // Drift guard: a space token added without a gap to match, or a gap named
    // off the scale, fails here rather than at the first screen that needs it.
    expect(Object.keys(stackGapClasses)).toEqual([...spaceTokens]);
    for (const token of spaceTokens) {
      expect(stackGapClasses[token]).toBe(`gap-${token}`);
      expect(stackVariants({ gap: token })).toContain(`gap-${token}`);
    }
  });

  it('emits a class for every option, and no physical one anywhere in the matrix', () => {
    for (const direction of DIRECTIONS) {
      for (const align of ALIGNS) {
        for (const justify of JUSTIFIES) {
          for (const wrap of WRAPS) {
            for (const gap of spaceTokens) {
              const className = stackVariants({ direction, gap, align, justify, wrap });
              expect(className, className).not.toMatch(PHYSICAL);
              expect(className.split(' ').length).toBeGreaterThanOrEqual(7);
            }
          }
        }
      }
    }
  });

  it.each(ALIGNS)('maps align=%s onto a flow-relative utility', (align) => {
    expect(stackVariants({ align })).toContain(`items-${align}`);
  });

  it.each(JUSTIFIES)('maps justify=%s onto a flow-relative utility', (justify) => {
    expect(stackVariants({ justify })).toContain(`justify-${justify}`);
  });

  it('lets a caller override the gap rather than fighting it', () => {
    const element = renderStack(<Stack gap="4" className="gap-8" />);
    expect(element.className).toContain('gap-8');
    expect(element.className).not.toContain('gap-4');
  });

  it('passes everything else through to the element', () => {
    const element = renderStack(
      <Stack id="breakdown" role="list" aria-label="פירוט המחיר">
        <span>שורה</span>
      </Stack>,
    );
    expect(element.id).toBe('breakdown');
    expect(element.getAttribute('role')).toBe('list');
    expect(element.textContent).toBe('שורה');
  });

  it('takes a ref as an ordinary prop, because this is React 19', () => {
    let captured: HTMLDivElement | null = null;
    renderStack(
      <Stack
        ref={(node) => {
          captured = node;
        }}
      />,
    );
    expect(captured).toBeInstanceOf(HTMLDivElement);
  });
});

describe('DirectionProvider', () => {
  it('puts the direction on a real element, not only in a context', () => {
    // The whole point: logical properties resolve against the document. A
    // context that no element reflects lays out left-to-right regardless.
    const element = renderStack(
      <DirectionProvider>
        <Stack />
      </DirectionProvider>,
    );
    expect(element.getAttribute('dir')).toBe('rtl');
    expect(element.getAttribute('lang')).toBe('he');
  });

  it('defaults to Hebrew, because that is the product rather than a fallback', () => {
    expect(DEFAULT_DIRECTION.locale).toBe(DEFAULT_LOCALE);
    expect(DEFAULT_DIRECTION.direction).toBe('rtl');
    expect(DEFAULT_DIRECTION.isRtl).toBe(true);
    expect(DEFAULT_DIRECTION.direction).toBe(directionFor(DEFAULT_LOCALE));
  });

  it('switches the document attributes for English', () => {
    const element = renderStack(
      <DirectionProvider locale="en">
        <span />
      </DirectionProvider>,
    );
    expect(element.getAttribute('dir')).toBe('ltr');
    expect(element.getAttribute('lang')).toBe('en');
  });

  it('nests, so a Latin address inside a Hebrew page is a provider and not a branch', () => {
    const { container } = render(
      <DirectionProvider>
        <DirectionProvider locale="en">
          <span id="address" />
        </DirectionProvider>
      </DirectionProvider>,
    );
    const outer = container.firstElementChild;
    const inner = outer?.firstElementChild;
    expect(outer?.getAttribute('dir')).toBe('rtl');
    expect(inner?.getAttribute('dir')).toBe('ltr');
  });

  it('does not appear in the box tree, so it cannot break a layout it wraps', () => {
    expect(renderStack(<DirectionProvider />).className).toContain('contents');
  });

  it('still lets a caller give it a box when it is the app shell', () => {
    const element = renderStack(<DirectionProvider className="block min-h-dvh" />);
    expect(element.className).toContain('block');
    expect(element.className).not.toContain('contents');
  });

  it('exports the attribute pair on its own, for a host document React does not own', () => {
    expect(directionAttributes('he')).toEqual({ dir: 'rtl', lang: 'he' });
    expect(directionAttributes('en')).toEqual({ dir: 'ltr', lang: 'en' });
  });
});

describe('useDirection', () => {
  function Probe(): ReactElement {
    const { locale, direction, isRtl } = useDirection();
    return <span data-locale={locale} data-direction={direction} data-rtl={String(isRtl)} />;
  }

  it('reads Hebrew and RTL with no provider above it, and does not throw', () => {
    // Throwing here would make "leave the provider off" the quickest path in a
    // test or a story, and an LTR layout the thing that gets reviewed.
    const probe = renderStack(<Probe />);
    expect(probe.dataset['locale']).toBe('he');
    expect(probe.dataset['direction']).toBe('rtl');
    expect(probe.dataset['rtl']).toBe('true');
  });

  it('follows the nearest provider', () => {
    const { container } = render(
      <DirectionProvider locale="en">
        <Probe />
      </DirectionProvider>,
    );
    const probe = container.querySelector('span');
    expect(probe?.getAttribute('data-locale')).toBe('en');
    expect(probe?.getAttribute('data-direction')).toBe('ltr');
    expect(probe?.getAttribute('data-rtl')).toBe('false');
  });
});
