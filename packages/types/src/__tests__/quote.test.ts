import { describe, expect, it } from 'vitest';
import { offerSecondsRemaining } from '../offer.js';
import { isQuoteExpired, quoteSecondsRemaining } from '../quote.js';

const EXPIRES_AT = new Date('2026-03-01T12:00:00Z');
const quote = { expiresAt: EXPIRES_AT };

/** The instant `msBefore` milliseconds before the lock lapses. Negative is after. */
function at(msBefore: number): Date {
  return new Date(EXPIRES_AT.getTime() - msBefore);
}

describe('the price-lock countdown', () => {
  it('never runs past zero into negative time', () => {
    // The Price Lock screen renders this directly. A negative number ticking
    // under the total is the most alarming thing a locked price could show.
    for (const overshootMs of [1, 1_000, 60_000, 86_400_000, 10 * 365 * 86_400_000]) {
      expect(quoteSecondsRemaining(quote, at(-overshootMs))).toBe(0);
    }
  });

  it('falls monotonically as time passes', () => {
    let previous = Infinity;
    for (let msBefore = 90_000; msBefore >= -30_000; msBefore -= 250) {
      const remaining = quoteSecondsRemaining(quote, at(msBefore));
      expect(remaining, `${msBefore}ms before expiry`).toBeLessThanOrEqual(previous);
      expect(remaining).toBeGreaterThanOrEqual(0);
      previous = remaining;
    }
  });

  it('still shows a second while any part of one is left', () => {
    // Rounding down would blank the countdown while the price is genuinely
    // still held, and a customer who sees 0:00 stops trusting the number.
    for (const msBefore of [1, 2, 500, 999, 1_000]) {
      expect(quoteSecondsRemaining(quote, at(msBefore))).toBeGreaterThanOrEqual(1);
    }
  });

  it('has spent the countdown by the time the quote counts as expired', () => {
    // The two must agree, or the screen offers a booking the guard will refuse.
    for (let msBefore = 3_000; msBefore >= -3_000; msBefore -= 137) {
      const now = at(msBefore);
      if (isQuoteExpired(quote, now)) {
        expect(quoteSecondsRemaining(quote, now), `${msBefore}ms before expiry`).toBe(0);
      }
    }
  });

  it('ticks identically to the driver-side offer countdown', () => {
    // Two timers on the same deadline that disagree by a second produce a
    // customer and a driver arguing about which screen is right.
    for (let msBefore = 120_000; msBefore >= -10_000; msBefore -= 313) {
      const now = at(msBefore);
      expect(quoteSecondsRemaining(quote, now)).toBe(offerSecondsRemaining(quote, now));
    }
  });

  it('defaults to the current instant', () => {
    const live = { expiresAt: new Date(Date.now() + 10 * 60_000) };
    const lapsed = { expiresAt: new Date(Date.now() - 10 * 60_000) };
    expect(quoteSecondsRemaining(live)).toBeGreaterThan(0);
    expect(quoteSecondsRemaining(lapsed)).toBe(0);
  });
});
