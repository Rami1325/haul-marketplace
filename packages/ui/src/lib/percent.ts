import type { Locale } from '@haul/types';

/**
 * ---------------------------------------------------------------------------
 * percentLabel — a percentage as text, in the reader's own language
 * ---------------------------------------------------------------------------
 * `40%` is the same four characters in Hebrew and in English, which is exactly
 * why it gets typed as a literal once and stays wrong the day a third locale
 * arrives — Arabic-Indic digits, a different percent sign, the sign on the other
 * side of the number. It is therefore formatted rather than written, and it is
 * written down here rather than in each component because two primitives now
 * publish a percentage: the Button's busy state and the Progress bar. Two copies
 * of a formatting decision is two places to change it and one that will not be.
 *
 * It takes whole percent (0–100) rather than a fraction, because that is what
 * both callers have already rounded to for `aria-valuenow` — passing the
 * fraction would let the spoken figure and the published one disagree in the
 * last digit.
 * ---------------------------------------------------------------------------
 */
export function percentLabel(locale: Locale, percent: number): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
    percent / 100,
  );
}
