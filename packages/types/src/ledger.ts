import { z } from 'zod';
import { AgorotSchema } from './money.js';

/**
 * ---------------------------------------------------------------------------
 * The ledger
 * ---------------------------------------------------------------------------
 * Double-entry, because a marketplace that holds other people's money and pays
 * out to contractors will eventually have to answer, precisely, where a given
 * shekel went. "Query the Stripe dashboard" is not an answer once there are
 * refunds, partial captures, cancellation fees, tips and VAT in play.
 *
 * The invariant is simple and absolute: **every transaction's entries sum to
 * zero**. It is asserted in tests and again at write time. If it ever fails,
 * the correct response is to stop, not to compensate.
 * ---------------------------------------------------------------------------
 */

export const LedgerAccount = {
  /** Money owed by the customer. Debited when we capture. */
  CustomerReceivable: 'customer_receivable',
  /**
   * Cash captured but not yet deposited by the PSP.
   *
   * Distinct from the bank account on purpose. In Israel the acquiring rail and
   * the payout rail are two different systems — cards come in through PayPlus
   * or HYP, driver payments go out through the bank — so money genuinely sits
   * in two places and collapsing them hides the float.
   */
  PspClearing: 'psp_clearing',
  /** HAUL's own bank account. Driver payouts leave from here, not from the PSP. */
  BankAccount: 'bank_account',
  /** Our take. */
  PlatformRevenue: 'platform_revenue',
  /** Owed to the driver, until payout clears. */
  DriverPayable: 'driver_payable',
  /** מע"מ collected on the platform's own revenue, owed to the tax authority. */
  VatPayable: 'vat_payable',
  /** Payment-processing costs. */
  PaymentFees: 'payment_fees',
  /** Discounts and first-job incentives — a real cost, not a smaller price. */
  PromoExpense: 'promo_expense',
  /** Earnings guarantees paid to buy early liquidity. Budget for it explicitly. */
  DriverIncentiveExpense: 'driver_incentive_expense',
  /** Tips pass straight through; the platform takes nothing. */
  TipPayable: 'tip_payable',
  /** Damage claims paid out. */
  ClaimsExpense: 'claims_expense',
  /** Refunds issued to customers. */
  RefundExpense: 'refund_expense',
} as const;
export type LedgerAccount = (typeof LedgerAccount)[keyof typeof LedgerAccount];
export const LedgerAccountSchema = z.enum([
  LedgerAccount.CustomerReceivable,
  LedgerAccount.PspClearing,
  LedgerAccount.BankAccount,
  LedgerAccount.PlatformRevenue,
  LedgerAccount.DriverPayable,
  LedgerAccount.VatPayable,
  LedgerAccount.PaymentFees,
  LedgerAccount.PromoExpense,
  LedgerAccount.DriverIncentiveExpense,
  LedgerAccount.TipPayable,
  LedgerAccount.ClaimsExpense,
  LedgerAccount.RefundExpense,
]);

export const LedgerEventKind = {
  Authorization: 'authorization',
  AuthorizationReleased: 'authorization_released',
  Capture: 'capture',
  /** PSP deposits cleared funds into the bank, net of processing fees. */
  PspDeposit: 'psp_deposit',
  CancellationFee: 'cancellation_fee',
  Refund: 'refund',
  DriverPayout: 'driver_payout',
  Tip: 'tip',
  Promo: 'promo',
  Incentive: 'incentive',
  Claim: 'claim',
  Adjustment: 'adjustment',
} as const;
export type LedgerEventKind = (typeof LedgerEventKind)[keyof typeof LedgerEventKind];
export const LedgerEventKindSchema = z.enum([
  LedgerEventKind.Authorization,
  LedgerEventKind.AuthorizationReleased,
  LedgerEventKind.Capture,
  LedgerEventKind.PspDeposit,
  LedgerEventKind.CancellationFee,
  LedgerEventKind.Refund,
  LedgerEventKind.DriverPayout,
  LedgerEventKind.Tip,
  LedgerEventKind.Promo,
  LedgerEventKind.Incentive,
  LedgerEventKind.Claim,
  LedgerEventKind.Adjustment,
]);

/**
 * One side of a transaction. Positive is a debit, negative is a credit — a
 * single signed integer rather than a direction enum, because it makes the
 * "sums to zero" invariant a one-line check instead of a branch.
 */
export const LedgerEntrySchema = z.object({
  account: LedgerAccountSchema,
  amount: AgorotSchema,
  memo: z.string().max(200).nullable().default(null),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const LedgerTransactionSchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: LedgerEventKindSchema,

    jobId: z.string().max(64).nullable().default(null),
    driverId: z.string().max(64).nullable().default(null),
    customerId: z.string().max(64).nullable().default(null),

    entries: z.array(LedgerEntrySchema).min(2).max(20),

    /** Provider-side reference — payment intent, transfer, refund id. */
    externalRef: z.string().max(200).nullable().default(null),
    /**
     * Idempotency key. Payment webhooks arrive more than once; a ledger that
     * double-books a capture is worse than one that misses it.
     */
    idempotencyKey: z.string().min(1).max(200),

    occurredAt: z.coerce.date(),
    recordedAt: z.coerce.date(),
  })
  .refine((tx) => tx.entries.reduce((acc, e) => acc + e.amount, 0) === 0, {
    message: 'ledger transaction does not balance — entries must sum to zero',
    path: ['entries'],
  });
export type LedgerTransaction = z.infer<typeof LedgerTransactionSchema>;

/** Check the invariant without parsing. Used at write time and in tests. */
export function balances(entries: readonly LedgerEntry[]): boolean {
  return entries.reduce((acc, e) => acc + e.amount, 0) === 0;
}

export function accountBalance(
  transactions: readonly LedgerTransaction[],
  account: LedgerAccount,
): number {
  let total = 0;
  for (const tx of transactions) {
    for (const entry of tx.entries) {
      if (entry.account === account) total += entry.amount;
    }
  }
  return total;
}
