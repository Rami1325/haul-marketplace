import { DEFAULT_CITY_ID } from '@haul/config';
import type { BookingDraft } from '@haul/contracts';
import { cookies } from 'next/headers.js';
import { hashSessionToken, isSessionToken, BOOKING_SESSION_COOKIE } from '@/booking/session.js';
import type { Locale } from '@/i18n/locales.js';
import { database } from './db.js';
import { findOpenDraft, saveOpenDraft, type OpenDraft } from './draft-store.js';

/**
 * ---------------------------------------------------------------------------
 * The request's draft
 * ---------------------------------------------------------------------------
 * `draft-store.ts` holds the queries and takes a session hash and a clock.
 * This is the part that reads the cookie, and it is separate for the reason
 * every impure edge in this repo is separate: the store can then be tested
 * against a real database with no request around it, and this file has nothing
 * left in it to get wrong.
 *
 * **Nothing here creates a row on a page render.** `currentDraft` reads; only
 * `updateDraft` — which is called from server actions, where the customer has
 * actually answered something — writes. Server Components render on prefetch,
 * on refresh, and more than once per navigation, and a `booking_drafts` row per
 * hover over the "get a price" button is a table of drafts belonging to nobody.
 * A customer who opens step 01 and leaves costs us nothing.
 * ---------------------------------------------------------------------------
 */

/**
 * The token this browser is holding, or null.
 *
 * Null is the ordinary case for anyone who has not started a booking:
 * `proxy.ts` mints the cookie on the first `/…/book…` navigation and nowhere
 * else, so a reader on the home page has no session and needs none.
 */
async function sessionTokenHash(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(BOOKING_SESSION_COOKIE)?.value;
  if (!isSessionToken(token)) return null;
  return hashSessionToken(token);
}

/** This browser's open draft, or null. Never writes. */
export async function currentDraft(now: Date = new Date()): Promise<OpenDraft | null> {
  const hash = await sessionTokenHash();
  if (hash === null) return null;
  return findOpenDraft(database(), hash, now);
}

/**
 * Apply an answer to this browser's draft, creating the row if this is the
 * first one.
 *
 * Throws when there is no session cookie, and the throw is the point. Every
 * booking URL passes through `proxy.ts`, which mints one before the request
 * reaches a route — so no cookie here means either the proxy's matcher stopped
 * covering a path it should, or something is posting to a booking action from
 * outside the flow. Silently minting a session at this depth would paper over
 * the first and quietly accept the second; a Server Action cannot set a cookie
 * that a redirect would need anyway.
 */
export async function updateDraft(
  locale: Locale,
  mutate: (draft: BookingDraft) => BookingDraft,
  now: Date = new Date(),
): Promise<OpenDraft> {
  const hash = await sessionTokenHash();
  if (hash === null) {
    throw new Error(
      `no ${BOOKING_SESSION_COOKIE} cookie on a booking write — proxy.ts mints one for every /…/book path`,
    );
  }

  return saveOpenDraft(
    database(),
    {
      sessionTokenHash: hash,
      // One live city, and `@haul/config` is the only thing that knows which.
      // The day there are two, this becomes a question the first screen answers
      // from the pickup address — which is why it is a field on the draft
      // rather than a constant anywhere below this line.
      cityId: DEFAULT_CITY_ID,
      locale,
    },
    now,
    mutate,
  );
}
