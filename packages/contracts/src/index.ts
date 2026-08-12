/**
 * @haul/contracts — the wire.
 *
 * The shapes that cross a network boundary: the in-progress booking draft, the
 * request bodies a client may send, the result unions it must switch on, and
 * the view models it is allowed to see. Plus the one conversion that turns a
 * half-filled form into a real domain object or refuses to.
 *
 * It lives in a package rather than in the web app because `apps/web`,
 * `apps/mobile` and the dispatch service all speak it, and three copies of a
 * DTO is three definitions of what a booking is — with the drift arriving as a
 * field one surface sets and another silently ignores.
 *
 * Nothing here computes a price. `@haul/pricing` does that, `@haul/config`
 * holds the numbers, and this package's job is to make sure the engine is
 * handed something real.
 */

export * from './draft.js';
export * from './to-quote-input.js';
export * from './steps.js';
export * from './views.js';
export * from './requests.js';
export * from './results.js';
