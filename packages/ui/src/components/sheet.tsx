'use client';

import { directionFor, localised, type Locale } from '@haul/types';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn.js';
import { variants, type VariantProps } from '../lib/variants.js';
import { durations, easings } from '../tokens/motion.js';
import { MIN_TAP_TARGET } from '../tokens/size.js';
import { useDirection } from './direction.js';

/**
 * ---------------------------------------------------------------------------
 * Sheet
 * ---------------------------------------------------------------------------
 * The surface every decision in the booking flow is actually made on. One
 * decision per screen means most screens are a sheet: pick a floor, pick a
 * window, confirm the locked price. So this component is load-bearing in a way
 * a bottom sheet usually is not, and the parts of it that matter are the parts
 * that are invisible when they work.
 *
 * A modal that does not move focus into itself is a modal only for people
 * looking at it. Everyone else — a keyboard user, a screen reader user, anyone
 * whose hands are busy — is still standing in the page behind it, tabbing
 * through a form they cannot see and hearing content that is covered by a panel
 * on screen. That is not a degraded experience, it is a wrong one: they can
 * submit the thing underneath. So focus moves to the panel on open, Tab is
 * caught at both ends and wrapped, and Escape gets out.
 *
 * Focus is restored to whatever had it when the sheet opened, and that is the
 * half people forget. Without it, dismissing a sheet drops the caret at the top
 * of the document, and a customer who opened the third sheet in an eleven-step
 * flow has to tab back down through everything they already answered to reach
 * the button they just pressed. Restoring is what makes a sheet feel like it
 * opened *from* somewhere.
 *
 * Body scroll is locked because a fixed panel over a scrollable page is the
 * oldest bug in mobile web: the finger drags the sheet, the page underneath
 * moves, and the customer loses their place in a list they were mid-way through.
 *
 * ## The portal is a hole in the direction of the page
 *
 * `DirectionProvider` publishes the locale to React *and* writes `dir` and
 * `lang` onto a real element, because logical properties resolve against the
 * document rather than against a context. A portal keeps the first half and
 * throws away the second: the panel is appended to `document.body`, outside the
 * element carrying those attributes, so it inherits whatever the document says
 * instead of what the subtree that opened it says. A sheet opened inside an
 * English subtree of a Hebrew app therefore lays itself out mirrored — `ps-5`
 * and `pe-5` swap sides, `text-start` flips, the close control moves from the
 * reading end to the reading start — and `lang` is lost too, so a screen reader
 * pronounces the content with the wrong phonetics. So the overlay re-states the
 * pair from the locale in context. It is the same derivation the provider does,
 * applied at the only point where the tree can be stitched back together.
 *
 * ## The one string this component says
 *
 * The close control is icon-only, which means its `aria-label` is its entire
 * accessible name — there is no visible glyph a reader can fall back on when the
 * label is in a language they do not speak. A baked-in Hebrew default is worse
 * here than anywhere else in the package: on an English surface it is the only
 * way out of a modal that has already trapped focus, announced in a script the
 * user's voice cannot read. The word comes from `SHEET_COPY` through the active
 * locale, and `closeLabel` remains the app layer's override for the rare surface
 * whose voice differs.
 *
 * ## What a caller may attach
 *
 * Everything not named below lands on the panel, because the eleven steps built
 * on top of this all need to reach it: an `id` for analytics, a `data-*` hook
 * for an end-to-end selector, a ref, another sentence appended to the
 * description. Id-valued ARIA attributes are joined with the sheet's own rather
 * than replacing them — a caller adding `aria-describedby` is adding a sentence,
 * not proposing to delete the description the dialog already has. The dialog
 * contract itself is written after the spread and cannot be overridden: `role`,
 * `aria-modal` and the `tabIndex` that lets focus land on the panel are what
 * make this a modal at all. `container` exists because `document.body` is not
 * always the right layer — a shadow root, or a host that owns its own stacking
 * context, has to be able to say where the portal goes.
 *
 * The motion is the sampled spring from the motion tokens rather than a curve
 * that looks springy, and it is applied as inline style rather than a utility
 * class because it is the one animation in the system whose exact values are
 * asserted by test. `PLAN.html` asks for spring on sheets: this thing is heavy,
 * it should arrive like it has mass and settle like it has weight. Under
 * `prefers-reduced-motion` it does none of that — a weighted 400ms travel across
 * most of the viewport is a vestibular trigger, not a flourish, so the sheet is
 * simply present instead. A caller's `style` is merged underneath it, so extra
 * declarations are welcome and the transition is not negotiable.
 *
 * Dismissal unmounts immediately, with no exit animation, and that is a
 * decision rather than an omission. Animating out means keeping a `role=dialog`
 * in the accessibility tree after focus has already gone back to the trigger,
 * which is exactly the inconsistent state this component exists to prevent; the
 * honest fix costs an `inert` attribute and a timer that can be interrupted by
 * a re-open. Arriving with mass and leaving instantly is also what a sheet
 * physically does when you let go of it.
 * ---------------------------------------------------------------------------
 */

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

interface Phrase {
  readonly he: string;
  readonly en: string;
}

/**
 * Everything the sheet says in its own voice, which is one word — and one word
 * is exactly the amount that has to be right, because it names the only control
 * on the panel with nothing visible to read. A table rather than a pair of
 * defaults so a test can walk the vocabulary instead of trusting a grep.
 */
export const SHEET_COPY = {
  close: { he: 'סגירה', en: 'Close' },
} as const satisfies Readonly<Record<string, Phrase>>;

/**
 * Lives here rather than in a hooks module because the sheet is the only thing
 * in the system whose motion cannot be expressed as a `motion-reduce:` utility:
 * its timing function is a sampled spring carried in the tokens, so the decision
 * has to be made in JavaScript before the style is written.
 *
 * `useSyncExternalStore` rather than state corrected inside an effect. The two
 * look interchangeable and are not: the effect version renders once with the
 * wrong answer and then again with the right one, so a user who asked the
 * operating system for reduced motion still gets one frame of the spring — the
 * exact frame that triggers what the setting exists to prevent. It is also the
 * hook that answers the server separately, which is what keeps the first sheet
 * of the flow from mismatching on hydration.
 */
function subscribeToReducedMotion(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(REDUCED_MOTION_QUERY).matches,
    // The server has no media query to read, and guessing "reduced" would strip
    // the motion from every first paint. It resolves on the client immediately.
    () => false,
  );
}

/**
 * Deliberately not `:focus-visible`-aware and deliberately not clever about
 * visibility: jsdom has no layout, so any filter based on measured geometry
 * would be untestable, and every element this system renders into a sheet is
 * either present and reachable or removed from the tree.
 */
const TABBABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function tabbableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
  );
}

/** An ARIA id list, with the sheet's own reference kept and the caller's appended. */
function joinIds(...ids: readonly (string | undefined)[]): string | undefined {
  const present = ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
  return present.length === 0 ? undefined : present.join(' ');
}

/**
 * The panel needs a ref to hold focus and a caller may want one too, and a DOM
 * node takes exactly one `ref` attribute. Merging here rather than asking the
 * caller to surrender theirs keeps the focus contract internal and the element
 * reachable.
 */
function assignRef(ref: Ref<HTMLDivElement> | undefined, node: HTMLDivElement | null): void {
  if (typeof ref === 'function') ref(node);
  else if (ref !== null && ref !== undefined) ref.current = node;
}

const sheetConfig = {
  size: {
    /** As tall as its content needs, and no taller than the viewport allows. */
    content: 'max-h-[85svh]',
    /** A fixed tall sheet for anything that scrolls: the item grid, a long list. */
    tall: 'h-[85svh]',
    /** Effectively a page. The manifest editor, the full breakdown. */
    full: 'h-[100svh] rounded-t-none',
  },
} as const;

export type SheetVariants = VariantProps<typeof sheetConfig>;

const sheetPanel = variants({
  base: cn(
    'relative flex w-full max-w-[36rem] flex-col overflow-y-auto',
    'rounded-t-xl border-t border-line bg-card text-ink ps-5 pe-5 pt-3 pb-6',
    'focus-visible:outline-none',
  ),
  variants: sheetConfig,
  defaults: { size: 'content' },
});

export interface SheetProps extends Omit<ComponentPropsWithRef<'div'>, 'title'>, SheetVariants {
  open: boolean;
  /** Called for Escape, the overlay, and the close control alike. */
  onClose: () => void;
  /** Names the dialog. Wired to `aria-labelledby`, so it is never decorative. */
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /**
   * Overrides the surrounding `DirectionProvider` for this sheet, for the same
   * reason the provider takes one: an invoice for a foreign client is a subtree
   * with its own language, and a portal is still that subtree.
   */
  locale?: Locale;
  /** Where the portal lands. `document.body` unless the host owns its own layer. */
  container?: HTMLElement;
  /** Overrides the close control's name. The app's copy layer owns its own words. */
  closeLabel?: string;
}

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  size = 'content',
  className,
  closeLabel,
  locale,
  container,
  ref,
  style,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
  ...rest
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // A portal needs a document, and this package is consumed by a framework that
  // renders on the server first. `useSyncExternalStore` answers the two
  // environments separately without a state write, so there is no render pass
  // that believes it is on the client when it is not.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [entered, setEntered] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  const { locale: contextLocale } = useDirection();
  const activeLocale = locale ?? contextLocale;

  const titleId = useId();
  const descriptionId = useId();

  const setPanel = useCallback(
    (node: HTMLDivElement | null) => {
      panelRef.current = node;
      assignRef(ref, node);
    },
    [ref],
  );

  const active = open && mounted;

  // The enter transition is armed on the next frame so the panel has a painted
  // starting position to move from, and disarmed on the way out rather than in
  // the effect body — a sheet reopened after closing has to play its entrance
  // again, not appear already in place.
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => {
      cancelAnimationFrame(frame);
      setEntered(false);
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;

    const restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();

    // Restored unconditionally. Checking whether focus is still inside the sheet
    // first looks safer and is not: by the time an effect cleanup runs the panel
    // has already left the document and every such check reports "moved away".
    return () => restoreTo?.focus();
  }, [active]);

  if (!active) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const panel = panelRef.current;
    if (!panel) return;

    const tabbable = tabbableWithin(panel);
    const first = tabbable[0];
    const last = tabbable[tabbable.length - 1];

    // Nothing to land on — the panel itself is the only focusable thing here.
    if (!first || !last) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const activeElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The panel itself holds focus on open, and it is not in its own tab ring —
    // so "not inside" and "at the far edge" are the same case and both wrap.
    const inside =
      activeElement !== null && activeElement !== panel && panel.contains(activeElement);
    const atStart = !inside || activeElement === first;
    const atEnd = !inside || activeElement === last;

    if (event.shiftKey && atStart) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && atEnd) {
      event.preventDefault();
      first.focus();
    }
  };

  const shown = entered || reducedMotion;

  return createPortal(
    <div
      dir={directionFor(activeLocale)}
      lang={activeLocale}
      className="fixed start-0 end-0 top-0 bottom-0 z-50 flex items-end justify-center"
      onKeyDown={onKeyDown}
    >
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute start-0 end-0 top-0 bottom-0 bg-ink/60"
        style={{
          transitionProperty: 'opacity',
          transitionDuration: reducedMotion ? '0ms' : durations.base,
          transitionTimingFunction: easings.entrance,
          opacity: shown ? 1 : 0,
        }}
      />

      <div
        {...rest}
        ref={setPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={joinIds(titleId, labelledBy)}
        aria-describedby={joinIds(description ? descriptionId : undefined, describedBy)}
        tabIndex={-1}
        data-motion={reducedMotion ? 'reduced' : 'spring'}
        className={sheetPanel({ size, className })}
        style={{
          ...style,
          transitionProperty: 'transform',
          transitionDuration: reducedMotion ? '0ms' : durations.sheet,
          transitionTimingFunction: reducedMotion ? 'linear' : easings.sheet,
          transform: shown ? 'translateY(0)' : 'translateY(100%)',
        }}
      >
        <div className="flex justify-center pb-3">
          <span aria-hidden="true" className="block h-1 w-10 rounded-pill bg-line-2" />
        </div>

        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="font-display text-step-2 font-bold text-ink text-start">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel ?? localised(activeLocale, SHEET_COPY.close)}
            className={cn(
              'flex shrink-0 items-center justify-center rounded-md text-ink-2',
              'transition-colors duration-quick hover:bg-paper-2 hover:text-ink',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-route',
            )}
            style={{ minInlineSize: MIN_TAP_TARGET, minBlockSize: MIN_TAP_TARGET }}
          >
            <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true" focusable="false">
              <path
                d="M5 5 15 15M15 5 5 15"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {description ? (
          <p id={descriptionId} className="pt-1 font-body text-ink-2 text-start">
            {description}
          </p>
        ) : null}

        <div className="pt-4">{children}</div>
      </div>
    </div>,
    container ?? document.body,
  );
}
