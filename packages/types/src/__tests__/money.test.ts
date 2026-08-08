import { describe, expect, it } from 'vitest';
import {
  addVat,
  agorot,
  allocate,
  applyBps,
  bps,
  extractVat,
  formatILS,
  percent,
  shekels,
  sum,
  toDecimalString,
} from '../money.js';

describe('money is integer-only', () => {
  it('refuses a float', () => {
    expect(() => agorot(12.5)).toThrow(TypeError);
  });

  it('refuses shekels passed where agorot are expected', () => {
    // The classic bug: someone passes 248 meaning ₪248 and gets ₪2.48.
    // We cannot catch that, but we can catch 248.50.
    expect(() => agorot(248.5)).toThrow(/integer/);
  });

  it('converts shekels at the boundary and rounds once', () => {
    expect(shekels(248)).toBe(24800);
    expect(shekels(19.99)).toBe(1999);
    expect(shekels(0.1)).toBe(10);
    // 8.155 in binary floating point is 8.154999... — rounding must still land on 816.
    expect(shekels(8.155)).toBe(816);
  });

  it('rounds decimals the way an operator typed them, not the way IEEE-754 stored them', () => {
    // Each of these multiplies to a value just under the .5 boundary as a double.
    expect(shekels(1.005)).toBe(101);
    expect(shekels(1.015)).toBe(102);
    expect(shekels(2.675)).toBe(268);
    expect(shekels(-8.155)).toBe(-816);
  });

  it('truncates below the agora rather than accumulating precision it cannot keep', () => {
    expect(shekels(8.1549)).toBe(815);
    expect(shekels(8.1551)).toBe(816);
    expect(shekels(0)).toBe(0);
    expect(shekels(-0.004)).toBe(0);
  });

  it('does not accumulate float error across a receipt', () => {
    // The failure this rule exists to prevent: 0.1 + 0.2 !== 0.3
    const lines = [shekels(0.1), shekels(0.2)];
    expect(sum(lines)).toBe(shekels(0.3));
  });
});

describe('basis points', () => {
  it('rejects a percentage passed as a fraction', () => {
    expect(() => bps(0.18)).toThrow(/1800/);
  });

  it('converts percent to bps', () => {
    expect(percent(18)).toBe(1800);
    expect(percent(17.5)).toBe(1750);
  });

  it('applies a rate', () => {
    expect(applyBps(agorot(10_000), percent(18))).toBe(1800);
  });

  it('applies a multiplier', () => {
    // A ×1.15 demand factor on ₪100.
    expect(applyBps(agorot(10_000), bps(11_500))).toBe(11_500);
  });

  it('rounds half away from zero so the direction is predictable', () => {
    // 5 agorot × 50% = 2.5 → 3, not "whichever way the float landed".
    expect(applyBps(agorot(5), percent(50))).toBe(3);
    expect(applyBps(agorot(-5), percent(50))).toBe(-3);
  });
});

describe('VAT', () => {
  const VAT = percent(18);

  it('adds VAT to a net figure', () => {
    const split = addVat(agorot(20_000), VAT);
    expect(split.net).toBe(20_000);
    expect(split.vat).toBe(3_600);
    expect(split.gross).toBe(23_600);
  });

  it('always balances: net + vat === gross', () => {
    for (let net = 0; net < 5_000; net += 7) {
      const split = addVat(agorot(net), VAT);
      expect(split.net + split.vat).toBe(split.gross);
    }
  });

  it('extracts VAT from an inclusive figure', () => {
    const split = extractVat(agorot(23_600), VAT);
    expect(split.gross).toBe(23_600);
    expect(split.net).toBe(20_000);
    expect(split.vat).toBe(3_600);
  });

  it('extraction always balances even where rounding is ambiguous', () => {
    for (let gross = 1; gross < 5_000; gross += 13) {
      const split = extractVat(agorot(gross), VAT);
      expect(split.net + split.vat).toBe(split.gross);
    }
  });
});

describe('allocate', () => {
  it('never creates or destroys an agora', () => {
    const parts = allocate(agorot(100), [1, 1, 1]);
    expect(parts).toEqual([34, 33, 33]);
    expect(sum(parts)).toBe(100);
  });

  it('respects weights', () => {
    const parts = allocate(agorot(1000), [80, 20]);
    expect(parts).toEqual([800, 200]);
  });

  it('conserves the total across many awkward splits', () => {
    for (let amount = 1; amount < 500; amount++) {
      const parts = allocate(agorot(amount), [3, 5, 7, 11]);
      expect(sum(parts)).toBe(amount);
    }
  });

  it('refuses degenerate weights', () => {
    expect(() => allocate(agorot(100), [])).toThrow();
    expect(() => allocate(agorot(100), [0, 0])).toThrow();
    expect(() => allocate(agorot(100), [-1, 2])).toThrow();
  });
});

describe('formatting', () => {
  it('renders a bare decimal string exactly', () => {
    expect(toDecimalString(agorot(24_800))).toBe('248.00');
    expect(toDecimalString(agorot(5))).toBe('0.05');
    expect(toDecimalString(agorot(-1_250))).toBe('-12.50');
  });

  it('renders ILS with the shekel sign', () => {
    expect(formatILS(agorot(24_800), 'he')).toContain('₪');
    expect(formatILS(agorot(24_800), 'he')).toContain('248');
  });
});
