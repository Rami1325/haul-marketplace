import type { DraftStep } from '@haul/contracts';
import type { Locale } from '@/i18n/locales.js';

/**
 * ---------------------------------------------------------------------------
 * Steps as URLs
 * ---------------------------------------------------------------------------
 * `@haul/contracts` owns what a step *is* — the order, and which screen owns
 * which unanswered question — because `apps/mobile` walks the same funnel and a
 * second set of step names is a second funnel: two charts that cannot be added
 * together and no way to tell which one is short. This file owns the only part
 * that is web-shaped, which is where each step lives in the address bar.
 *
 * **Eleven URLs, not one route with client state.** §11 wants abandonment per
 * step and page views give that for free, where a `currentStep` field drifts
 * the first time someone adds a sub-screen. The back button is the other half:
 * in a flow this long it is the step navigator whether the product intends it
 * or not, and it only works if the steps are real locations.
 *
 * **The slug is the step id.** `/he/book/items` for `BookingStep.Items`, with
 * nothing in between, because a table mapping eight ids to eight strings is
 * eight chances for the analytics bucket and the URL to name different screens.
 *
 * **Every import in this file is `import type`, and that is load-bearing.**
 * `proxy.ts` calls `isBookingPath` on **every navigation on the site**, and its
 * own comment promises it touches no database and no pricing engine. A value
 * import of `@haul/contracts` would keep that promise on paper and break it in
 * the bundle: the barrel reaches `@haul/config`, whose modules parse a 169-item
 * catalog through Zod at import time — a side effect no tree-shaker is allowed
 * to drop. Types are erased and cost nothing. Anything here that needs a
 * *value* from the contracts package belongs in a module the proxy does not
 * import.
 *
 * The cost is per-navigation work in a Node process, not an edge bundle-size
 * limit: Next 16 runs a proxy file on Node rather than the edge (see
 * `booking/session.ts` for how that was established). `module-boundaries.node.test.ts`
 * is what enforces this — the compiler has no opinion about it.
 *
 * Steps 09–11 are deliberately absent. Matching, the live job sheet and the
 * receipt are keyed by a **job** id rather than by a booking cookie — the draft
 * is gone by then — so they belong under a `/job/…` route built with the job.
 * ---------------------------------------------------------------------------
 */

/** The path segment every booking step sits under. */
export const BOOKING_SEGMENT = 'book';

/** Where a returning customer is sent to be routed onward. */
export function bookingEntryPath(locale: Locale): string {
  return `/${locale}/${BOOKING_SEGMENT}`;
}

export function stepPath(locale: Locale, step: DraftStep): string {
  return `/${locale}/${BOOKING_SEGMENT}/${step}`;
}

/**
 * Whether a pathname is inside the booking flow.
 *
 * Matched on the pathname rather than a route object because the proxy runs
 * before routing and has nothing else to go on. The locale segment is skipped
 * rather than validated: by the time this is asked the proxy has already
 * established that the first segment is a supported locale, and checking it
 * twice would put the locale list in a second place.
 */
export function isBookingPath(pathname: string): boolean {
  const [, , second] = pathname.split('/');
  return second === BOOKING_SEGMENT;
}
