import { z } from 'zod';

/**
 * ---------------------------------------------------------------------------
 * Money
 * ---------------------------------------------------------------------------
 * Money in HAUL is *always* an integer count of the currency's minor unit.
 * For ILS that is agorot: ₪1.00 === 100 agorot.
 *
 * Floating point is banned for money in this codebase. `0.1 + 0.2 !== 0.3`, and
 * a locked-price product that quietly loses an agora per line item is a product
 * whose receipts don't add up — which is precisely the trust failure the whole
 * company exists to avoid.
 *
 * Percentages are basis points (integers): 18% === 1800 bps. Multipliers are
 * also basis points: ×1.15 === 11500 bps. This keeps every intermediate value
 * in integer space and makes the arithmetic reproducible across client and
 * server, which matters because both run the same pricing engine.
 * ---------------------------------------------------------------------------
 */

declare const AgorotBrand: unique symbol;
declare const BpsBrand: unique symbol;

/** An integer number of agorot. Never a float, never a parsed price string. */
export type Agorot = number & { readonly [AgorotBrand]: true };

/** Basis points. 10_000 bps === 100%. */
export type Bps = number & { readonly [BpsBrand]: true };

export const BPS_SCALE = 10_000;

/** Largest money value we will accept anywhere — ₪1,000,000. A guard, not a limit we expect to hit. */
export const MAX_AGOROT = 100_000_000;

export const AgorotSchema = z
  .number()
  .int('money must be a whole number of agorot — you probably passed shekels')
  .min(-MAX_AGOROT)
  .max(MAX_AGOROT)
  .transform((n) => n as Agorot);

/** Money that cannot be negative: prices, payouts, surcharges. */
export const NonNegativeAgorotSchema = AgorotSchema.refine(
  (n) => n >= 0,
  'amount cannot be negative',
);

export const BpsSchema = z
  .number()
  .int('basis points must be a whole number')
  .min(0)
  .max(1_000_000) // ×100 ceiling — a sanity guard against a misplaced decimal
  .transform((n) => n as Bps);

export const ZERO = 0 as Agorot;

// --- construction -----------------------------------------------------------

/** Assert a raw number is a valid agorot amount. Throws on floats. */
export function agorot(n: number): Agorot {
  if (!Number.isInteger(n)) {
    throw new TypeError(`agorot() requires an integer, got ${n}. Use shekels() to convert.`);
  }
  if (Math.abs(n) > MAX_AGOROT) {
    throw new RangeError(`agorot() value ${n} exceeds MAX_AGOROT`);
  }
  // Normalise -0 to 0. `Object.is(-0, 0)` is false, so a negative zero sneaking
  // out of a rounded-down refund would fail equality checks that ought to pass.
  return (n === 0 ? 0 : n) as Agorot;
}

/**
 * Convert decimal shekels to agorot. Use only at the system boundary — reading a
 * rate card, parsing operator input. Never mid-calculation.
 *
 * Scaling by multiplication is wrong here and it is wrong quietly: `8.155 * 100`
 * is `815.4999999999999`, so an operator who types ₪8.155 into a rate card gets
 * 815 agorot instead of 816. Nobody notices until a receipt is a shekel out.
 *
 * `String(n)` yields the shortest decimal that round-trips to this double — i.e.
 * exactly the digits the operator typed. Rounding in decimal-string space gives
 * the answer a finance person expects rather than the one IEEE-754 stored.
 */
export function shekels(n: number): Agorot {
  if (!Number.isFinite(n)) {
    throw new TypeError(`shekels() requires a finite number, got ${n}`);
  }

  const text = String(n);
  // Exponential notation is out of range for money anyway; agorot() will reject it.
  if (text.includes('e') || text.includes('E')) {
    return agorot(Math.round(n * 100));
  }

  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [wholeText = '0', fractionText = ''] = unsigned.split('.');

  // Two digits of agorot plus one more to decide the rounding.
  const fraction = `${fractionText}000`.slice(0, 3);
  let value = Number(wholeText) * 100 + Number(fraction.slice(0, 2));
  if (Number(fraction[2]) >= 5) value += 1;

  return agorot(negative ? -value : value);
}

export function bps(n: number): Bps {
  if (!Number.isInteger(n)) {
    throw new TypeError(`bps() requires an integer, got ${n}. 18% is 1800, not 0.18.`);
  }
  return n as Bps;
}

/** Percent → bps, for readability at call sites: `percent(18)` === 1800 bps. */
export function percent(p: number): Bps {
  return bps(Math.round(p * 100));
}

// --- arithmetic -------------------------------------------------------------

export function add(a: Agorot, b: Agorot): Agorot {
  return agorot(a + b);
}

export function subtract(a: Agorot, b: Agorot): Agorot {
  return agorot(a - b);
}

export function sum(amounts: readonly Agorot[]): Agorot {
  let total = 0;
  for (const a of amounts) total += a;
  return agorot(total);
}

/** Multiply by a whole count — 3 flights of stairs, 2 helpers. */
export function multiply(amount: Agorot, count: number): Agorot {
  if (!Number.isInteger(count)) {
    throw new TypeError(`multiply() count must be an integer, got ${count}. Use applyBps().`);
  }
  return agorot(amount * count);
}

/**
 * Apply a basis-point rate or multiplier.
 *
 * `applyBps(10000, 1800)` → 1800  (18% of ₪100 is ₪18)
 * `applyBps(10000, 11500)` → 11500 (×1.15)
 *
 * Rounds half away from zero, so a customer is never surprised by a half-agora
 * that rounded a direction they can't predict.
 */
export function applyBps(amount: Agorot, rate: Bps): Agorot {
  const scaled = (amount * rate) / BPS_SCALE;
  return agorot(roundHalfAwayFromZero(scaled));
}

function roundHalfAwayFromZero(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

export function clamp(amount: Agorot, min: Agorot, max: Agorot): Agorot {
  if (min > max) throw new RangeError('clamp(): min exceeds max');
  return agorot(Math.min(Math.max(amount, min), max));
}

export function max(a: Agorot, b: Agorot): Agorot {
  return a >= b ? a : b;
}

export function min(a: Agorot, b: Agorot): Agorot {
  return a <= b ? a : b;
}

export function isZero(a: Agorot): boolean {
  return a === 0;
}

// --- VAT (מע"מ) -------------------------------------------------------------

/**
 * Israeli consumer prices are quoted VAT-inclusive, which happens to be exactly
 * what Price Lock promises anyway: the number you see is the number you pay.
 *
 * We compute components net, add VAT once at the end, and display gross. A tax
 * invoice (חשבונית מס) needs the net/VAT/gross split anyway, so carrying all
 * three is not overhead — it's the legal record.
 */
export interface VatSplit {
  /** Sum of components, excluding VAT. */
  readonly net: Agorot;
  readonly vatRate: Bps;
  readonly vat: Agorot;
  /** What the customer actually pays. The locked number. */
  readonly gross: Agorot;
}

export function addVat(net: Agorot, vatRate: Bps): VatSplit {
  const vat = applyBps(net, vatRate);
  return { net, vatRate, vat, gross: add(net, vat) };
}

/** Recover the net amount from a VAT-inclusive figure — used for B2B invoicing. */
export function extractVat(gross: Agorot, vatRate: Bps): VatSplit {
  const net = agorot(roundHalfAwayFromZero((gross * BPS_SCALE) / (BPS_SCALE + vatRate)));
  return { net, vatRate, vat: subtract(gross, net), gross };
}

// --- allocation -------------------------------------------------------------

/**
 * Split an amount into `n` parts whose sum is exactly the original — no agora
 * created or destroyed. Remainder is distributed one agora at a time from the
 * front. Used for splitting a payout across a crew and for proportional refunds.
 */
export function allocate(amount: Agorot, weights: readonly number[]): Agorot[] {
  if (weights.length === 0) throw new RangeError('allocate(): needs at least one weight');
  if (weights.some((w) => w < 0)) throw new RangeError('allocate(): weights cannot be negative');

  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  if (totalWeight === 0) throw new RangeError('allocate(): weights sum to zero');

  const parts = weights.map((w) => Math.floor((amount * w) / totalWeight));
  let remainder = amount - parts.reduce((acc, p) => acc + p, 0);

  for (let i = 0; remainder > 0; i = (i + 1) % parts.length) {
    parts[i] = (parts[i] ?? 0) + 1;
    remainder -= 1;
  }
  return parts.map(agorot);
}

// --- formatting -------------------------------------------------------------

export type SupportedLocale = 'he' | 'en';

const INTL_LOCALE: Record<SupportedLocale, string> = {
  he: 'he-IL',
  en: 'en-IL',
};

/**
 * Format for display. Always tabular-friendly and always two decimals so money
 * lines up down a receipt — the plan calls for tabular figures and this is the
 * data side of that rule.
 */
export function formatILS(
  amount: Agorot,
  locale: SupportedLocale = 'he',
  options: { showDecimals?: boolean } = {},
): string {
  const { showDecimals = true } = options;
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(amount / 100);
}

/** Bare decimal string, no symbol — for inputs and CSV exports. */
export function toDecimalString(amount: Agorot): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

export function formatBps(rate: Bps): string {
  return `${rate / 100}%`;
}
