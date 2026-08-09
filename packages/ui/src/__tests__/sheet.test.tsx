import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DirectionProvider } from '../components/direction.js';
import { SHEET_COPY, Sheet } from '../components/sheet.js';
import { durations, easings } from '../tokens/motion.js';
import { MIN_TAP_TARGET_PX } from '../tokens/size.js';

afterEach(cleanup);

/**
 * jsdom ships no `matchMedia` at all, so a component that reads it has to be
 * told what the user asked for. Stubbing it here rather than in `setup.ts` keeps
 * the two answers explicit at the point where they matter.
 */
function stubReducedMotion(reduce: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduce,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => stubReducedMotion(false));

/**
 * The document the app is served in. The portal's whole problem is that it
 * escapes into this, so a test about direction has to state what "this" says
 * before it can prove the sheet ignored it.
 */
function setDocumentLanguage(dir: 'rtl' | 'ltr', lang: string): void {
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', lang);
}

afterEach(() => {
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('lang');
});

/**
 * `dir` and `lang` are inherited attributes, so what applies to an element is
 * whatever the nearest ancestor declaring one says. That is the resolution a
 * browser performs, and asserting the attribute on the panel itself would prove
 * nothing about it — the bug being guarded here is precisely an ancestor chain
 * that leaves the portal in the wrong language.
 */
function inherited(attribute: 'dir' | 'lang', element: Element): string | null {
  return element.closest(`[${attribute}]`)?.getAttribute(attribute) ?? null;
}

/** The Hebrew block, U+0590–U+05FF. Nothing in it belongs in an English name. */
const HEBREW = /[֐-׿]/;

function renderSheet(children: ReactNode): Promise<HTMLElement> {
  render(<>{children}</>);
  return screen.findByRole('dialog');
}

function SheetHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        בחירת חלון זמן
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="מתי להגיע?"
        description="אפשר לשנות עד שעתיים לפני"
      >
        <button type="button">היום</button>
        <button type="button">מחר</button>
      </Sheet>
    </>
  );
}

async function openSheet(): Promise<{ trigger: HTMLElement; dialog: HTMLElement }> {
  render(<SheetHarness />);
  const trigger = screen.getByRole('button', { name: 'בחירת חלון זמן' });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog');
  return { trigger, dialog };
}

describe('Sheet — the dialog contract', () => {
  it('is a modal dialog named by its own title', async () => {
    const { dialog } = await openSheet();

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('dialog', { name: 'מתי להגיע?' })).toBe(dialog);
    expect(dialog.getAttribute('aria-describedby')).not.toBeNull();
  });

  it('gives the close control a full tap target and a Hebrew name', async () => {
    const { dialog } = await openSheet();
    const close = within(dialog).getByRole('button', { name: 'סגירה' });

    expect(Number.parseFloat(close.style.minBlockSize)).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
    expect(Number.parseFloat(close.style.minInlineSize)).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
  });
});

describe('Sheet — direction survives the portal', () => {
  it('an English subtree of a Hebrew document opens an LTR sheet', async () => {
    setDocumentLanguage('rtl', 'he');

    const dialog = await renderSheet(
      <DirectionProvider locale="en">
        <Sheet open onClose={() => undefined} title="When should we arrive?">
          <button type="button">Today</button>
        </Sheet>
      </DirectionProvider>,
    );

    // The panel really did leave the provider's element behind — this is a
    // portal, and the whole bug is that `dir` does not travel through one…
    const provider = document.querySelector('div.contents');
    expect(provider?.contains(dialog)).toBe(false);
    expect(dialog.closest('[dir]')).not.toBe(document.documentElement);
    // …and it still lays out and speaks as the subtree that opened it.
    expect(inherited('dir', dialog)).toBe('ltr');
    expect(inherited('lang', dialog)).toBe('en');
  });

  it('a Hebrew subtree of an English document opens an RTL sheet', async () => {
    setDocumentLanguage('ltr', 'en');

    const dialog = await renderSheet(
      <DirectionProvider locale="he">
        <Sheet open onClose={() => undefined} title="מתי להגיע?">
          <button type="button">היום</button>
        </Sheet>
      </DirectionProvider>,
    );

    expect(inherited('dir', dialog)).toBe('rtl');
    expect(inherited('lang', dialog)).toBe('he');
  });

  it('is Hebrew and RTL with no provider at all, whatever the document says', async () => {
    setDocumentLanguage('ltr', 'en');

    const dialog = await renderSheet(
      <Sheet open onClose={() => undefined} title="מתי להגיע?">
        <button type="button">היום</button>
      </Sheet>,
    );

    expect(inherited('dir', dialog)).toBe('rtl');
    expect(inherited('lang', dialog)).toBe('he');
  });

  it('takes a locale of its own, for a sheet that is not in the page language', async () => {
    const dialog = await renderSheet(
      <DirectionProvider locale="he">
        <Sheet open onClose={() => undefined} locale="en" title="Tax invoice">
          <button type="button">Download</button>
        </Sheet>
      </DirectionProvider>,
    );

    expect(inherited('dir', dialog)).toBe('ltr');
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});

describe('Sheet — the close control speaks the surface it is on', () => {
  it('is named in English on an English surface', async () => {
    const dialog = await renderSheet(
      <DirectionProvider locale="en">
        <Sheet open onClose={() => undefined} title="When should we arrive?">
          <button type="button">Today</button>
        </Sheet>
      </DirectionProvider>,
    );

    const close = within(dialog).getByRole('button', { name: SHEET_COPY.close.en });
    expect(HEBREW.test(close.getAttribute('aria-label') ?? '')).toBe(false);
  });

  it('lets the app layer override the word entirely', async () => {
    const dialog = await renderSheet(
      <DirectionProvider locale="en">
        <Sheet open onClose={() => undefined} title="When should we arrive?" closeLabel="Dismiss">
          <button type="button">Today</button>
        </Sheet>
      </DirectionProvider>,
    );

    expect(within(dialog).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('says everything it says in both languages, in the right script', () => {
    for (const [name, phrase] of Object.entries(SHEET_COPY)) {
      expect(phrase.he.length, name).toBeGreaterThan(0);
      expect(phrase.en.length, name).toBeGreaterThan(0);
      expect(HEBREW.test(phrase.he), name).toBe(true);
      expect(HEBREW.test(phrase.en), name).toBe(false);
    }
  });
});

describe('Sheet — what a caller may attach', () => {
  it('puts the caller’s own attributes and ref on the panel', async () => {
    const panel = createRef<HTMLDivElement>();

    const dialog = await renderSheet(
      <Sheet
        open
        onClose={() => undefined}
        title="מתי להגיע?"
        id="when-sheet"
        data-testid="when"
        data-step="03"
        ref={panel}
      >
        <button type="button">היום</button>
      </Sheet>,
    );

    expect(dialog).toHaveAttribute('id', 'when-sheet');
    expect(dialog.dataset['testid']).toBe('when');
    expect(dialog.dataset['step']).toBe('03');
    expect(panel.current).toBe(dialog);
  });

  it('appends the caller’s description instead of replacing its own', async () => {
    const dialog = await renderSheet(
      <>
        <p id="cancellation-note">אפשר לבטל עד שעתיים לפני</p>
        <Sheet
          open
          onClose={() => undefined}
          title="מתי להגיע?"
          description="אפשר לשנות עד שעתיים לפני"
          aria-describedby="cancellation-note"
        >
          <button type="button">היום</button>
        </Sheet>
      </>,
    );

    const ids = (dialog.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    expect(ids).toContain('cancellation-note');
    expect(ids).toHaveLength(2);
    const ownId = ids.find((id) => id !== 'cancellation-note') ?? '';
    expect(document.getElementById(ownId)).toHaveTextContent('אפשר לשנות עד שעתיים לפני');
  });

  it('keeps the dialog contract whatever the caller passes', async () => {
    const dialog = await renderSheet(
      // A caller cannot demote the panel out of the modal it is: the role, the
      // modality and the tab stop that receives focus are written after the spread.
      <Sheet open onClose={() => undefined} title="מתי להגיע?" role="group" tabIndex={0}>
        <button type="button">היום</button>
      </Sheet>,
    );

    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('tabindex', '-1');
  });

  it('merges a style underneath the motion rather than losing it', async () => {
    const dialog = await renderSheet(
      <Sheet open onClose={() => undefined} title="מתי להגיע?" style={{ maxBlockSize: '20rem' }}>
        <button type="button">היום</button>
      </Sheet>,
    );

    expect(dialog.style.maxBlockSize).toBe('20rem');
    expect(dialog.style.transitionDuration).toBe(durations.sheet);
  });

  it('renders into the container it is given', async () => {
    const layer = document.createElement('div');
    layer.id = 'sheet-layer';
    document.body.append(layer);

    const dialog = await renderSheet(
      <Sheet open onClose={() => undefined} title="מתי להגיע?" container={layer}>
        <button type="button">היום</button>
      </Sheet>,
    );

    expect(layer.contains(dialog)).toBe(true);
    cleanup();
    layer.remove();
  });
});

describe('Sheet — focus', () => {
  it('moves focus into the sheet on open', async () => {
    const { dialog } = await openSheet();
    expect(document.activeElement).toBe(dialog);
  });

  it('wraps Tab at the end of the sheet instead of leaving it', async () => {
    const { dialog } = await openSheet();
    const buttons = within(dialog).getAllByRole('button');
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (!first || !last) throw new Error('the sheet rendered no focusable content');

    // From the panel itself, Tab lands on the first thing inside it.
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab at the start of the sheet', async () => {
    const { dialog } = await openSheet();
    const buttons = within(dialog).getAllByRole('button');
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (!first || !last) throw new Error('the sheet rendered no focusable content');

    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('restores focus to the control that opened it', async () => {
    const { trigger, dialog } = await openSheet();
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});

describe('Sheet — dismissal', () => {
  it('closes on Escape', async () => {
    const { dialog } = await openSheet();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes on the close control', async () => {
    const { dialog } = await openSheet();
    fireEvent.click(within(dialog).getByRole('button', { name: 'סגירה' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('locks the page behind it and gives the scroll position back', async () => {
    expect(document.body.style.overflow).toBe('');

    const { dialog } = await openSheet();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.body.style.overflow).toBe('');
  });
});

describe('Sheet — motion', () => {
  it('arrives on the sampled spring from the motion tokens', async () => {
    const { dialog } = await openSheet();

    expect(dialog.dataset['motion']).toBe('spring');
    expect(dialog.style.transitionDuration).toBe(durations.sheet);
    expect(dialog.style.transitionTimingFunction).toBe(easings.sheet);

    // It really travels: the panel starts a full height below and settles.
    await waitFor(() => expect(dialog.style.transform).toBe('translateY(0)'));
  });

  it('does not travel at all when the user asked for reduced motion', async () => {
    stubReducedMotion(true);
    const { dialog } = await openSheet();

    expect(dialog.dataset['motion']).toBe('reduced');
    expect(dialog.style.transitionDuration).toBe('0ms');
    expect(dialog.style.transitionTimingFunction).toBe('linear');
    // Present rather than animated — no 400ms slide across most of the viewport.
    expect(dialog.style.transform).toBe('translateY(0)');
  });
});
