'use client';

import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { he, type Messages } from '@/i18n/messages/he.js';

/**
 * ---------------------------------------------------------------------------
 * Messages
 * ---------------------------------------------------------------------------
 * A server component reads its catalog directly — `messagesFor(locale)` is a
 * property lookup and there is nothing to provide. This context exists for the
 * other half of the booking flow: the client islands. A Stepper's own
 * announcement, a Countdown's copy, the label on a Sheet's close control — all
 * of those render on the client, several levels below the segment that knows
 * which locale is active, and the alternative to a context is threading the
 * catalog through every intermediate component as a prop.
 *
 * **The default is the Hebrew catalog, and it does not throw.** The same
 * argument `@haul/ui` makes for `DEFAULT_DIRECTION`: a hook that throws outside
 * its provider makes the provider-free path the quickest way to render something
 * in a test or a story, and if that path produced English then English is what
 * would get reviewed. A default has to be the product's real default or it is
 * not a default.
 * ---------------------------------------------------------------------------
 */

const MessagesContext = createContext<Messages>(he);

export interface MessagesProviderProps {
  messages: Messages;
  children: ReactNode;
}

export function MessagesProvider({ messages, children }: MessagesProviderProps): ReactElement {
  // The catalog is a frozen module object rather than something derived per
  // render, so there is no identity to memoise — passing it straight through
  // keeps the provider from re-rendering the tree on an unrelated parent update.
  return <MessagesContext value={messages}>{children}</MessagesContext>;
}

/**
 * The active catalog. Named `useT` because the call site reads as `t.startBooking`
 * — a key path, checked by the compiler, rather than `t('start_booking')`, a
 * string nothing verifies until someone opens the page in the wrong language.
 */
export function useT(): Messages {
  return useContext(MessagesContext);
}
