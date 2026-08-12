import { BookingStep, DRAFT_STEPS } from '@haul/contracts';
import { NextRequest } from 'next/server.js';
import { describe, expect, it } from 'vitest';
import { BOOKING_SEGMENT, bookingEntryPath, isBookingPath, stepPath } from '@/booking/paths.js';
import {
  BOOKING_SESSION_COOKIE,
  BOOKING_SESSION_MAX_AGE_SECONDS,
  bookingSessionCookie,
  hashSessionToken,
  isSessionToken,
  newSessionToken,
} from '@/booking/session.js';
import { proxy } from '@/proxy.js';

/**
 * ---------------------------------------------------------------------------
 * The booking session, and the URLs it is minted on
 * ---------------------------------------------------------------------------
 * The cookie this file is about is a credential. Whoever holds it gets a
 * customer's home address, the address they are moving to, and the day the flat
 * will be empty — so the assertions here are about unguessability, about the
 * stored form being useless if it leaks, and about the token being minted where
 * it is needed and nowhere else.
 * ---------------------------------------------------------------------------
 */

describe('the session token', () => {
  it('is 256 bits of randomness, hex', () => {
    const token = newSessionToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(isSessionToken(token)).toBe(true);
  });

  it('does not repeat', () => {
    // Not a statistical test — it cannot be, at this sample size. It is a
    // smoke check that the generator is generating: a `newSessionToken` that
    // returned a constant, or a per-process value, would hand every customer
    // the same draft and would otherwise look completely healthy.
    const tokens = new Set(Array.from({ length: 500 }, () => newSessionToken()));
    expect(tokens.size).toBe(500);
  });

  it('refuses anything that is not one of ours, before it is hashed', () => {
    // Hashing is total: every string has a SHA-256, including the empty one.
    // A lookup keyed on the hash of `''` is a lookup that matches whatever a
    // silently-empty hashing step once wrote.
    expect(isSessionToken('')).toBe(false);
    expect(isSessionToken(undefined)).toBe(false);
    expect(isSessionToken(null)).toBe(false);
    expect(isSessionToken('drf_01JABCDEF')).toBe(false);
    expect(isSessionToken('A'.repeat(64))).toBe(false); // uppercase hex is not our shape
    expect(isSessionToken('0'.repeat(63))).toBe(false);
    expect(isSessionToken('0'.repeat(65))).toBe(false);
  });
});

describe('the stored form of the token', () => {
  it('is its SHA-256, and matches the value the database will accept', async () => {
    // Vector from FIPS 180-2: SHA-256 of the empty input. It anchors the
    // implementation to the algorithm rather than to itself — a hash function
    // that quietly became something else would still be deterministic, still
    // 64 characters, and still pass every other test in this file.
    await expect(hashSessionToken('')).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );

    const hash = await hashSessionToken(newSessionToken());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is not the token', async () => {
    // The whole reason the column holds a digest: a dump, a backup or a
    // slow-query log then carries nothing replayable.
    const token = newSessionToken();
    expect(await hashSessionToken(token)).not.toBe(token);
  });

  it('is stable, so a returning customer finds their own draft', async () => {
    const token = newSessionToken();
    expect(await hashSessionToken(token)).toBe(await hashSessionToken(token));
  });
});

describe('the cookie', () => {
  it('is httpOnly and lax, and outlives a month of planning a move', () => {
    const cookie = bookingSessionCookie(newSessionToken());
    expect(cookie.name).toBe(BOOKING_SESSION_COOKIE);
    // No client-side code has any business reading this: an XSS that can read
    // it can resume the booking from anywhere.
    expect(cookie.httpOnly).toBe(true);
    // `strict` would drop the cookie on a customer following their own booking
    // link in from WhatsApp, which is the ordinary way this link travels.
    expect(cookie.sameSite).toBe('lax');
    expect(cookie.path).toBe('/');
    expect(cookie.maxAge).toBe(BOOKING_SESSION_MAX_AGE_SECONDS);
    expect(cookie.maxAge).toBeGreaterThanOrEqual(30 * 24 * 60 * 60);
  });
});

describe('booking paths', () => {
  it('puts every draft step at its own URL, named after itself', () => {
    expect(stepPath('he', BookingStep.Items)).toBe('/he/book/items');
    expect(stepPath('en', BookingStep.Pay)).toBe('/en/book/pay');
    expect(bookingEntryPath('he')).toBe('/he/book');

    // Eight distinct URLs. A path builder that collapsed two steps onto one
    // would break the guard and the funnel at once, and both silently.
    const paths = new Set(DRAFT_STEPS.map((step) => stepPath('he', step)));
    expect(paths.size).toBe(DRAFT_STEPS.length);
  });

  it('recognises the flow by its second segment, in both locales', () => {
    expect(isBookingPath('/he/book')).toBe(true);
    expect(isBookingPath('/en/book/items')).toBe(true);
    expect(isBookingPath(`/he/${BOOKING_SEGMENT}/anything`)).toBe(true);

    expect(isBookingPath('/he')).toBe(false);
    expect(isBookingPath('/')).toBe(false);
    expect(isBookingPath('/he/booking')).toBe(false);
    // Not a booking path, and worth stating: the locale segment is what makes
    // the second segment the flow's. A bare `/book` is pre-negotiation and gets
    // redirected before this is ever asked.
    expect(isBookingPath('/book/items')).toBe(false);
  });
});

/** A request with a locale prefix, so the proxy is past its redirect branch. */
function get(path: string, cookies: Record<string, string> = {}): NextRequest {
  const request = new NextRequest(new URL(`http://localhost:3000${path}`));
  for (const [name, value] of Object.entries(cookies)) request.cookies.set(name, value);
  return request;
}

describe('the proxy mints the session', () => {
  it('sets the cookie on the first booking navigation', () => {
    const response = proxy(get('/he/book'));
    const cookie = response.cookies.get(BOOKING_SESSION_COOKIE);
    expect(cookie).toBeDefined();
    expect(isSessionToken(cookie?.value)).toBe(true);
    expect(cookie?.httpOnly).toBe(true);
  });

  it('makes the token visible to the page rendering this same request', () => {
    // The half that is easy to leave out. `response.cookies` tells the browser,
    // which covers the *next* request; without the request being mutated too, a
    // customer's very first booking page renders with no session at all.
    const request = get('/he/book/items');
    const response = proxy(request);
    expect(isSessionToken(request.cookies.get(BOOKING_SESSION_COOKIE)?.value)).toBe(true);
    expect(request.cookies.get(BOOKING_SESSION_COOKIE)?.value).toBe(
      response.cookies.get(BOOKING_SESSION_COOKIE)?.value,
    );
  });

  it('leaves an existing token alone', () => {
    // A rotation mid-flow orphans the draft it was the only key to.
    const existing = newSessionToken();
    const response = proxy(get('/he/book/when', { [BOOKING_SESSION_COOKIE]: existing }));
    expect(response.cookies.get(BOOKING_SESSION_COOKIE)).toBeUndefined();
  });

  it('replaces a malformed token rather than trusting it', () => {
    const response = proxy(get('/he/book', { [BOOKING_SESSION_COOKIE]: 'not-a-token' }));
    expect(isSessionToken(response.cookies.get(BOOKING_SESSION_COOKIE)?.value)).toBe(true);
  });

  it('mints nothing outside the booking flow', () => {
    // A tracking-shaped cookie handed to everyone who lands on the site is the
    // thing every consent banner exists because of. It is minted at the moment
    // it becomes functional and not before.
    for (const path of ['/he', '/en', '/he/about']) {
      expect(proxy(get(path)).cookies.get(BOOKING_SESSION_COOKIE)).toBeUndefined();
    }
  });

  it('still negotiates the locale, and mints on the way back rather than on the redirect', () => {
    const response = proxy(get('/book'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3000/he/book');
    // Setting it here would set a cookie on a response the browser is about to
    // replace, and then set it again on the request that replaces it.
    expect(response.cookies.get(BOOKING_SESSION_COOKIE)).toBeUndefined();
  });
});
