'use client';

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn.js';

/**
 * ---------------------------------------------------------------------------
 * Live region
 * ---------------------------------------------------------------------------
 * Two components in this package already roll their own. `Stepper` publishes the
 * quantity as a polite region because pressing `+` changes a number nowhere near
 * the focus and a blind customer would otherwise hear four clicks and have no
 * idea whether the count is 4, 1, or unchanged. `Input` publishes its error the
 * same way. Both are right, and both stop working the moment the announcement
 * has to come from somewhere that is not a rendered component — a booking that
 * failed, a driver that was matched, a price that just changed underneath the
 * screen.
 *
 * So there are two shapes here, and they are not alternatives.
 *
 * ## `LiveRegion`, for a sentence a component already owns
 *
 * The region is always in the document and only its text changes. That order is
 * the whole trick: a screen reader watches regions that existed when the page
 * settled, so mounting a region and its text in the same commit is the classic
 * announcement that reaches nobody — the element the reader would have watched
 * did not exist a frame earlier. Rendering `{condition ? <LiveRegion .../> :
 * null}` reintroduces exactly that bug, which is why the message is a prop with
 * an empty default rather than the component being conditional.
 *
 * ## `LiveRegionProvider` and `useAnnounce`, for everything else
 *
 * An app-level announcer, mounted once at the root, so a mutation handler or a
 * socket callback can say something without inventing a component to say it in.
 *
 * **It holds two slots per politeness, and that is not redundancy.** A live
 * region announces when its contents *change*; writing the same sentence into it
 * twice is a no-op, so "המחיר עודכן" arriving a second time is silence — and the
 * second time is the one the customer needed, because the first told them
 * something they already knew. Alternating between two regions means every
 * announcement is a change in both of them, and a repeated sentence is spoken
 * again. The alternative people reach for first is appending a zero-width space,
 * which works until something trims it and is invisible when it breaks.
 *
 * Outside a provider `useAnnounce` is a no-op rather than a throw. A leaf that
 * wanted to announce something cannot mount an app-level region to fix it, and
 * throwing would mean a component rendered in a test or a story takes the screen
 * down over an announcement nobody was listening for. The provider belongs at
 * the app root, and that is an app-root fact — stated here, checked by the app's
 * own test, and not enforceable from inside a primitive.
 * ---------------------------------------------------------------------------
 */

/**
 * `polite` waits for a pause; `assertive` interrupts whatever is being read.
 * Assertive is for a thing that has gone wrong or a state that invalidates what
 * the person is currently doing, and for nothing else — an interruption spent on
 * a confirmation is an interruption that will not be available for a failure.
 */
export type Politeness = 'polite' | 'assertive';

/** The shape both regions share, so the two politeness levels cannot drift apart. */
function regionRole(politeness: Politeness): 'alert' | 'status' {
  return politeness === 'assertive' ? 'alert' : 'status';
}

export interface LiveRegionProps {
  /**
   * The sentence to announce. Changing it is what announces; an unchanged value
   * is deliberately silent, and an empty default keeps the element mounted and
   * empty until there is something to say.
   */
  message?: string;
  politeness?: Politeness;
  /**
   * Read the whole region rather than just what changed. On by default: these
   * regions carry one sentence at a time, and a reader that announced only the
   * changed words would say "3" where the sentence says "3 × ארגז".
   */
  atomic?: boolean;
  id?: string;
  className?: string;
}

export function LiveRegion({
  message = '',
  politeness = 'polite',
  atomic = true,
  id,
  className,
}: LiveRegionProps): ReactElement {
  return (
    <span
      id={id}
      role={regionRole(politeness)}
      aria-live={politeness}
      aria-atomic={atomic}
      data-live-region={politeness}
      // Visually absent, never `hidden` and never `display: none` — a region a
      // browser does not render is a region a screen reader does not watch.
      className={cn('sr-only', className)}
    >
      {message}
    </span>
  );
}

export type Announce = (message: string, politeness?: Politeness) => void;

const AnnouncerContext = createContext<Announce>(() => undefined);

/**
 * The app-level announcer. Returns a stable function, so it is safe in a
 * dependency array and a component that captures it once does not go stale.
 */
export function useAnnounce(): Announce {
  return useContext(AnnouncerContext);
}

export interface LiveRegionProviderProps {
  children: ReactNode;
}

/** One announcement, and which of the two slots is currently holding it. */
type Slots = readonly [string, string];

const EMPTY_SLOTS: Slots = ['', ''];

export function LiveRegionProvider({ children }: LiveRegionProviderProps): ReactElement {
  const [polite, setPolite] = useState<Slots>(EMPTY_SLOTS);
  const [assertive, setAssertive] = useState<Slots>(EMPTY_SLOTS);
  // Which slot the next message goes into, per politeness. A ref rather than
  // state because flipping it must not itself cause a render — the message
  // landing in the other slot is the render.
  const turn = useRef<{ polite: 0 | 1; assertive: 0 | 1 }>({ polite: 0, assertive: 0 });

  const announce = useCallback<Announce>((message, politeness = 'polite') => {
    if (message === '') return;
    const slot = turn.current[politeness];
    turn.current = { ...turn.current, [politeness]: slot === 0 ? 1 : 0 };
    const next: Slots = slot === 0 ? [message, ''] : ['', message];
    if (politeness === 'assertive') setAssertive(next);
    else setPolite(next);
  }, []);

  return (
    <AnnouncerContext value={announce}>
      {children}
      <LiveRegion message={polite[0]} politeness="polite" />
      <LiveRegion message={polite[1]} politeness="polite" />
      <LiveRegion message={assertive[0]} politeness="assertive" />
      <LiveRegion message={assertive[1]} politeness="assertive" />
    </AnnouncerContext>
  );
}
