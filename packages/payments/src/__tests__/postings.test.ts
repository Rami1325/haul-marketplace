import {
  LedgerAccount,
  LedgerTransactionSchema,
  accountBalance,
  agorot,
  balances,
  percent,
  shekels,
  type LedgerTransaction,
} from '@haul/types';
import { describe, expect, it } from 'vitest';
import {
  cancellationFeePostings,
  captureJobPostings,
  driverIncentivePostings,
  driverPayoutPostings,
  pspDepositPostings,
  refundPostings,
  tipPayoutPostings,
  tipPostings,
} from '../postings.js';

const VAT = percent(18);

const ctx = (id: string) => ({
  transactionId: id,
  idempotencyKey: `idem_${id}`,
  occurredAt: new Date('2026-08-08T10:00:00Z'),
  jobId: 'job_1',
  driverId: 'drv_1',
  customerId: 'cus_1',
});

describe('every posting balances', () => {
  it('holds for a normal captured job', () => {
    const tx = captureJobPostings(
      { grossTotal: shekels(248), driverPayout: shekels(198.4), vatRate: VAT },
      ctx('tx1'),
    );
    expect(balances(tx.entries)).toBe(true);
    expect(() => LedgerTransactionSchema.parse(tx)).not.toThrow();
  });

  it('holds across a wide sweep of fares and driver shares', () => {
    for (let fare = 8_000; fare <= 90_000; fare += 137) {
      for (const share of [0.78, 0.8, 0.82]) {
        const tx = captureJobPostings(
          {
            grossTotal: agorot(fare),
            driverPayout: agorot(Math.round(fare * share)),
            vatRate: VAT,
          },
          ctx(`tx_${fare}_${share}`),
        );
        expect(balances(tx.entries), `fare ${fare} share ${share}`).toBe(true);
      }
    }
  });

  it('holds for every other posting kind', () => {
    const transactions: LedgerTransaction[] = [
      tipPostings(shekels(20), ctx('tip')),
      cancellationFeePostings(
        { fee: shekels(60), driverCompensation: shekels(40), vatRate: VAT },
        ctx('cancel'),
      ),
      pspDepositPostings(shekels(1000), shekels(12.5), ctx('deposit')),
      driverPayoutPostings(shekels(198.4), ctx('payout')),
      tipPayoutPostings(shekels(20), ctx('tippayout')),
      refundPostings(shekels(248), VAT, ctx('refund')),
      driverIncentivePostings(shekels(150), ctx('incentive')),
    ];

    for (const tx of transactions) {
      expect(balances(tx.entries), tx.kind).toBe(true);
      expect(() => LedgerTransactionSchema.parse(tx), tx.kind).not.toThrow();
    }
  });

  it('refuses to emit an unbalanced transaction rather than writing one', () => {
    expect(() =>
      captureJobPostings(
        { grossTotal: shekels(100), driverPayout: shekels(150), vatRate: VAT },
        ctx('bad'),
      ),
    ).toThrow(/exceeds gross/);
  });
});

describe('the money splits correctly', () => {
  it('gives the driver exactly the guaranteed payout', () => {
    const tx = captureJobPostings(
      { grossTotal: shekels(248), driverPayout: shekels(198.4), vatRate: VAT },
      ctx('tx'),
    );
    // Liability to the driver is a credit, so it is negative.
    expect(accountBalance([tx], LedgerAccount.DriverPayable)).toBe(-shekels(198.4));
  });

  it('books revenue net of VAT, and the VAT separately', () => {
    const tx = captureJobPostings(
      { grossTotal: shekels(248), driverPayout: shekels(198.4), vatRate: VAT },
      ctx('tx'),
    );
    const take = shekels(248) - shekels(198.4); // ₪49.60 gross
    const revenue = -accountBalance([tx], LedgerAccount.PlatformRevenue);
    const vat = -accountBalance([tx], LedgerAccount.VatPayable);

    expect(revenue + vat).toBe(take);
    // 49.60 / 1.18 = 42.03, VAT 7.57
    expect(revenue).toBe(shekels(42.03));
    expect(vat).toBe(shekels(7.57));
  });

  it('takes nothing from a tip', () => {
    const tx = tipPostings(shekels(20), ctx('tip'));
    expect(accountBalance([tx], LedgerAccount.TipPayable)).toBe(-shekels(20));
    expect(accountBalance([tx], LedgerAccount.PlatformRevenue)).toBe(0);
    expect(accountBalance([tx], LedgerAccount.VatPayable)).toBe(0);
  });

  it('keeps a promo off the driver’s payout', () => {
    // Driver is paid on the undiscounted fare; the discount is HAUL's cost.
    const tx = captureJobPostings(
      {
        grossTotal: shekels(198),
        driverPayout: shekels(198.4),
        vatRate: VAT,
        promoAmount: shekels(50),
      },
      ctx('promo'),
    );
    expect(balances(tx.entries)).toBe(true);
    expect(accountBalance([tx], LedgerAccount.DriverPayable)).toBe(-shekels(198.4));
    // The discount surfaces as a marketing expense rather than vanishing into
    // a smaller revenue line.
    expect(accountBalance([tx], LedgerAccount.PromoExpense)).toBeGreaterThan(0);
  });

  it('compensates the driver out of a cancellation fee', () => {
    const tx = cancellationFeePostings(
      { fee: shekels(60), driverCompensation: shekels(40), vatRate: VAT },
      ctx('cancel'),
    );
    expect(accountBalance([tx], LedgerAccount.DriverPayable)).toBe(-shekels(40));
    const retained =
      -accountBalance([tx], LedgerAccount.PlatformRevenue) -
      accountBalance([tx], LedgerAccount.VatPayable);
    expect(retained).toBe(shekels(20));
  });

  it('refuses to compensate a driver more than the fee collected', () => {
    expect(() =>
      cancellationFeePostings(
        { fee: shekels(40), driverCompensation: shekels(60), vatRate: VAT },
        ctx('bad'),
      ),
    ).toThrow(/exceeds the fee/);
  });
});

describe('the two rails stay distinct', () => {
  it('moves money PSP → bank → driver, leaving nothing stranded', () => {
    const fare = shekels(248);
    const payout = shekels(198.4);
    const fees = shekels(3.1);

    const capture = captureJobPostings(
      { grossTotal: fare, driverPayout: payout, vatRate: VAT },
      ctx('cap'),
    );
    const deposit = pspDepositPostings(fare, fees, ctx('dep'));
    const paid = driverPayoutPostings(payout, ctx('pay'));
    const all = [capture, deposit, paid];

    // PSP clearing nets to zero once deposited — no float left behind.
    expect(accountBalance(all, LedgerAccount.PspClearing)).toBe(0);
    // Driver is square.
    expect(accountBalance(all, LedgerAccount.DriverPayable)).toBe(0);

    // Bank holds the fare, less the driver's share and the processing fees.
    expect(accountBalance(all, LedgerAccount.BankAccount)).toBe(fare - fees - payout);
  });

  it('leaves the whole book balanced across a job’s entire life', () => {
    const all = [
      captureJobPostings(
        { grossTotal: shekels(248), driverPayout: shekels(198.4), vatRate: VAT },
        ctx('a'),
      ),
      tipPostings(shekels(20), ctx('b')),
      pspDepositPostings(shekels(268), shekels(3.35), ctx('c')),
      driverPayoutPostings(shekels(198.4), ctx('d')),
      tipPayoutPostings(shekels(20), ctx('e')),
    ];

    const grandTotal = all
      .flatMap((tx) => tx.entries)
      .reduce((acc, entry) => acc + entry.amount, 0);
    expect(grandTotal).toBe(0);
  });
});
