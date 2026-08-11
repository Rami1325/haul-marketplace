import type { Locale } from '@haul/types';
import { describe, expect, it } from 'vitest';
import { percentLabel } from '../lib/percent.js';

/**
 * ---------------------------------------------------------------------------
 * The formatter has to be tested by its output, not by rerunning it
 * ---------------------------------------------------------------------------
 * Two primitives publish a percentage — the Button's busy state and the
 * Progress bar — and both were covered by tests that built their expectation
 * with the same `new Intl.NumberFormat(…)` call the module makes. That is the
 * function's own body run twice: it pins nothing, and for both shipped locales
 * it yields the literal `40%`, which is precisely the hand-typed form the module
 * exists to prevent. Replacing the whole of `percentLabel` with `${percent}%`
 * left the entire package green.
 *
 * So the expectations below are written down rather than computed, and the ones
 * that carry the file are the ones a template string cannot produce.
 * ---------------------------------------------------------------------------
 */

const LOCALES: readonly Locale[] = ['he', 'en'];

describe('percentLabel — a percentage is formatted, never written', () => {
  it.each(LOCALES)('%s — states both ends of the range it documents', (locale) => {
    expect(percentLabel(locale, 0)).toBe('0%');
    expect(percentLabel(locale, 40)).toBe('40%');
    expect(percentLabel(locale, 100)).toBe('100%');
  });

  it.each(LOCALES)('%s — rounds a figure that came out of arithmetic', (locale) => {
    // The assertions that hold this file up. A template puts `40.6%` on screen
    // beside a bar whose `aria-valuenow` says 41 — the figure a screen reader
    // announces and the figure the eye reads disagreeing in the last digit,
    // which is the failure `maximumFractionDigits: 0` is there to stop.
    expect(percentLabel(locale, 40.6)).toBe('41%');
    expect(percentLabel(locale, 99.5)).toBe('100%');
    expect(percentLabel(locale, 0.4)).toBe('0%');
    expect(percentLabel(locale, 100 / 3)).toBe('33%');
  });

  it('reads the same in both shipped locales, which is the trap rather than the licence', () => {
    // Hebrew and English agree on all four characters today, and that agreement
    // is why the literal gets typed once and stays wrong the day a locale with
    // Arabic-Indic digits, another percent sign, or the sign on the other side
    // of the number arrives. The agreement is an accident of these two locales;
    // the formatter is what makes it stop mattering.
    for (const percent of [0, 7, 40, 100]) {
      expect(percentLabel('he', percent), String(percent)).toBe(percentLabel('en', percent));
    }
  });
});
