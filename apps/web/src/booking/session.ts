/**
 * ---------------------------------------------------------------------------
 * The booking session — one cookie, and what it is allowed to be
 * ---------------------------------------------------------------------------
 * A booking draft lives in a `booking_drafts` row and the browser holds nothing
 * but a token that points at it. That token is a **credential**: whoever sends
 * it gets the draft, and the draft is the customer's home address, the address
 * they are moving to, the day the flat will be empty and a rough inventory of
 * what is in it.
 *
 * Three properties follow, and none of them are optional.
 *
 *   1. **It is CSPRNG output, not an identifier.** `@haul/types`' `ulid()` is
 *      seeded from `Math.random`, which is a documented non-cryptographic
 *      generator — V8's xorshift128+ state is recoverable from a handful of
 *      outputs. Perfect for a `drf_…` id in a log line, useless for something
 *      that authorises a read.
 *   2. **The database stores its SHA-256, never the token.** A dump, a backup,
 *      a replicated slow-query log or a support engineer's terminal then holds
 *      nothing replayable. This is why hashing lives here rather than in the
 *      store: the value that leaves this module is already the safe one.
 *   3. **It is minted by `proxy.ts` and read by `server/drafts.ts`**, so it is
 *      written in Web Crypto and standard globals: one implementation serving
 *      both callers, importing nothing.
 *
 *      Deliberately *not* justified by the runtime, because the obvious
 *      assumption there is wrong. Next 16 runs a proxy file on **Node**, not on
 *      the edge — `next/dist/build/entries.js` sends `isProxyFile` straight to
 *      `onServer()` with no edge branch at all, unlike the legacy `middleware`
 *      case immediately below it which still forks on runtime, and this app's
 *      own build assigns `/_middleware` the `nodejs` runtime while leaving the
 *      edge manifest empty. `node:crypto` here would compile and run happily.
 *      The reason to keep this module import-free is that `proxy.ts` executes
 *      on every navigation on the site, and the thing that actually enforces it
 *      is `module-boundaries.node.test.ts` rather than the bundler.
 *
 * Deliberately *not* `__Host-` prefixed, for the same reason as `LOCALE_COOKIE`:
 * that prefix demands `Secure`, and a booking flow that cannot be walked on
 * `http://localhost:3000` is a booking flow nobody develops against.
 * ---------------------------------------------------------------------------
 */

export const BOOKING_SESSION_COOKIE = 'haul_booking';

/**
 * Thirty days.
 *
 * Long because roughly seven in ten moves are planned rather than spontaneous,
 * and someone pricing a move three weeks out and coming back the night before
 * is the normal case rather than the edge one. The row's own `expires_at` is
 * the authority — a cookie's lifetime is a request the browser is free to
 * ignore, and the retention promise has to hold on our side of the wire.
 */
export const BOOKING_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** 32 bytes of CSPRNG, hex. Same alphabet and length as its own SHA-256. */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

export function newSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/**
 * Whether a cookie value is shaped like one of ours.
 *
 * Checked before it is hashed, not after. A cookie is attacker-controlled text
 * and hashing is total — every string has a SHA-256, including the empty one,
 * and a lookup by the hash of `''` is a lookup that would match any row written
 * by a hashing step that silently returned nothing. Refusing the malformed
 * value here means that row can never be written in the first place, and the
 * database's own `^[0-9a-f]{64}$` check says the same thing a second time.
 */
export function isSessionToken(value: string | undefined | null): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

/**
 * What the database stores for this token.
 *
 * `crypto.subtle` rather than `node:crypto` so there is one implementation for
 * the proxy and the server. Unsalted and un-stretched on purpose: this is a
 * 256-bit uniform random value, so there is no dictionary to attack and no
 * password-grade KDF to justify — the reason to hash it is to make the stored
 * copy useless, not to make it slow.
 */
export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

/**
 * The attributes the cookie is set with, wherever it is set.
 *
 * `httpOnly` because no client-side code has any business reading it — an XSS
 * that can read this can resume the booking from anywhere. `sameSite: 'lax'`
 * rather than `'strict'` because a customer following their own booking link
 * from WhatsApp must arrive holding their draft, and `strict` drops the cookie
 * on exactly that navigation. `secure` follows the environment for the reason
 * the `__Host-` prefix was declined.
 */
export function bookingSessionCookie(token: string): {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge: number;
} {
  return {
    name: BOOKING_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: BOOKING_SESSION_MAX_AGE_SECONDS,
  };
}
