import {
  LedgerAccount,
  LedgerEventKind,
  agorot,
  balances,
  extractVat,
  subtract,
  type Agorot,
  type Bps,
  type LedgerEntry,
  type LedgerTransaction,
} from '@haul/types';

/**
 * ---------------------------------------------------------------------------
 * Ledger postings
 * ---------------------------------------------------------------------------
 * Turns the state machine's money effects into balanced double-entry
 * transactions. Every function here returns entries summing to zero; the tests
 * assert it, and `LedgerTransactionSchema` asserts it again at write time.
 *
 * ── Tax model, and why it is written down here ──────────────────────────────
 * These postings assume the **principal** model: HAUL sells the move to the
 * customer and buys the work from the driver. HAUL charges VAT on the full
 * fare, the driver invoices HAUL for their payout, and HAUL remits the
 * difference. The alternative is the **agent** model, where the driver sells to
 * the customer and HAUL invoices only a commission — which produces materially
 * different VAT postings and a different invoicing obligation.
 *
 * Which one applies is a question for an Israeli accountant, not for this file,
 * and it wants answering before the first paid job rather than at the first
 * VAT return. It is logged as an open question in TRACKING.md. The split is
 * confined to this module so switching models is a change here and nowhere
 * else.
 * ---------------------------------------------------------------------------
 */

export interface PostingContext {
  transactionId: string;
  idempotencyKey: string;
  occurredAt: Date;
  recordedAt?: Date;
  jobId?: string;
  driverId?: string;
  customerId?: string;
}

function transaction(
  kind: LedgerTransaction['kind'],
  entries: LedgerEntry[],
  ctx: PostingContext,
  externalRef: string | null = null,
): LedgerTransaction {
  if (!balances(entries)) {
    const total = entries.reduce((acc, e) => acc + e.amount, 0);
    throw new Error(`refusing to emit an unbalanced ${kind} transaction: off by ${total}`);
  }
  return {
    id: ctx.transactionId,
    kind,
    jobId: ctx.jobId ?? null,
    driverId: ctx.driverId ?? null,
    customerId: ctx.customerId ?? null,
    entries,
    externalRef,
    idempotencyKey: ctx.idempotencyKey,
    occurredAt: ctx.occurredAt,
    recordedAt: ctx.recordedAt ?? ctx.occurredAt,
  };
}

function entry(account: LedgerAccount, amount: Agorot, memo: string): LedgerEntry {
  return { account, amount, memo };
}

// --- capture ----------------------------------------------------------------

export interface CaptureJobInput {
  /** VAT-inclusive amount taken from the customer. The locked number. */
  grossTotal: Agorot;
  /** Guaranteed payout to the driver, VAT-inclusive. */
  driverPayout: Agorot;
  vatRate: Bps;
  /**
   * Gross value of any discount applied. Already deducted from `grossTotal` —
   * passed separately only so the cost of acquisition stays visible instead of
   * disappearing into a smaller revenue line.
   */
  promoAmount?: Agorot;
  providerRef?: string;
}

/**
 * The main event. Customer money lands at the PSP; the driver's share becomes a
 * liability; what is left splits into revenue and the VAT we owe on it.
 */
export function captureJobPostings(input: CaptureJobInput, ctx: PostingContext): LedgerTransaction {
  const { grossTotal, driverPayout, vatRate, promoAmount } = input;

  if (driverPayout > grossTotal && !promoAmount) {
    throw new Error(
      `driver payout ${driverPayout} exceeds gross ${grossTotal} with no promo to explain it`,
    );
  }

  const take = subtract(grossTotal, driverPayout);
  const takeSplit = extractVat(take, vatRate);

  const entries: LedgerEntry[] = [
    entry(LedgerAccount.PspClearing, grossTotal, 'fare captured from customer'),
    entry(LedgerAccount.DriverPayable, agorot(-driverPayout), 'guaranteed driver payout'),
  ];

  if (promoAmount && promoAmount > 0) {
    // Recognise revenue as though the discount had not been given, then book the
    // discount as the marketing expense it actually is. Drivers are paid on the
    // undiscounted fare — they should never fund an acquisition campaign.
    const promoSplit = extractVat(promoAmount, vatRate);
    entries.push(
      entry(
        LedgerAccount.PlatformRevenue,
        agorot(-(takeSplit.net + promoSplit.net)),
        'platform revenue, gross of promotional discount',
      ),
      entry(LedgerAccount.PromoExpense, promoSplit.net, 'promotional discount'),
    );
  } else {
    entries.push(entry(LedgerAccount.PlatformRevenue, agorot(-takeSplit.net), 'platform revenue'));
  }

  entries.push(entry(LedgerAccount.VatPayable, agorot(-takeSplit.vat), 'VAT on platform revenue'));

  return transaction(LedgerEventKind.Capture, entries, ctx, input.providerRef ?? null);
}

// --- tips -------------------------------------------------------------------

/** Tips pass straight through. The platform takes nothing and owes no VAT on them. */
export function tipPostings(amount: Agorot, ctx: PostingContext): LedgerTransaction {
  return transaction(
    LedgerEventKind.Tip,
    [
      entry(LedgerAccount.PspClearing, amount, 'tip captured'),
      entry(LedgerAccount.TipPayable, agorot(-amount), 'tip owed to driver in full'),
    ],
    ctx,
  );
}

// --- cancellation -----------------------------------------------------------

export interface CancellationFeeInput {
  /** VAT-inclusive fee captured from the customer. */
  fee: Agorot;
  /** Share passed to the driver who had already committed. */
  driverCompensation: Agorot;
  vatRate: Bps;
  providerRef?: string;
}

/**
 * Cancellation after a driver committed. The driver is compensated either way —
 * they turned down other work — and the remainder is platform revenue.
 */
export function cancellationFeePostings(
  input: CancellationFeeInput,
  ctx: PostingContext,
): LedgerTransaction {
  const { fee, driverCompensation, vatRate } = input;
  if (driverCompensation > fee) {
    throw new Error(`driver compensation ${driverCompensation} exceeds the fee ${fee}`);
  }

  const retained = subtract(fee, driverCompensation);
  const split = extractVat(retained, vatRate);

  return transaction(
    LedgerEventKind.CancellationFee,
    [
      entry(LedgerAccount.PspClearing, fee, 'cancellation fee captured'),
      entry(
        LedgerAccount.DriverPayable,
        agorot(-driverCompensation),
        'driver compensated for a cancelled job',
      ),
      entry(LedgerAccount.PlatformRevenue, agorot(-split.net), 'retained cancellation fee'),
      entry(LedgerAccount.VatPayable, agorot(-split.vat), 'VAT on retained fee'),
    ],
    ctx,
    input.providerRef ?? null,
  );
}

// --- PSP deposit ------------------------------------------------------------

/**
 * The PSP deposits cleared funds into the bank, net of processing fees. Until
 * this happens the money is real but unavailable — and driver payouts leave
 * from the bank, not from the PSP, so the float is worth seeing.
 */
export function pspDepositPostings(
  grossCleared: Agorot,
  processingFees: Agorot,
  ctx: PostingContext,
): LedgerTransaction {
  const netToBank = subtract(grossCleared, processingFees);
  return transaction(
    LedgerEventKind.PspDeposit,
    [
      entry(LedgerAccount.BankAccount, netToBank, 'PSP deposit, net of fees'),
      entry(LedgerAccount.PaymentFees, processingFees, 'card processing fees'),
      entry(LedgerAccount.PspClearing, agorot(-grossCleared), 'cleared from PSP balance'),
    ],
    ctx,
  );
}

// --- driver payout ----------------------------------------------------------

/** Settles a driver's liability. Money leaves the bank, not the PSP. */
export function driverPayoutPostings(amount: Agorot, ctx: PostingContext): LedgerTransaction {
  return transaction(
    LedgerEventKind.DriverPayout,
    [
      entry(LedgerAccount.DriverPayable, amount, 'driver payout settled'),
      entry(LedgerAccount.BankAccount, agorot(-amount), 'bank transfer to driver'),
    ],
    ctx,
  );
}

/** Settles accumulated tips alongside a payout. */
export function tipPayoutPostings(amount: Agorot, ctx: PostingContext): LedgerTransaction {
  return transaction(
    LedgerEventKind.DriverPayout,
    [
      entry(LedgerAccount.TipPayable, amount, 'tips paid out'),
      entry(LedgerAccount.BankAccount, agorot(-amount), 'bank transfer to driver'),
    ],
    ctx,
  );
}

// --- refunds ----------------------------------------------------------------

/**
 * Money returned to a customer. Booked as an expense with the output VAT
 * reclaimed, rather than as negative revenue, so the refund rate stays visible
 * in the accounts instead of quietly eroding the revenue line.
 */
export function refundPostings(
  grossRefund: Agorot,
  vatRate: Bps,
  ctx: PostingContext,
  providerRef?: string,
): LedgerTransaction {
  const split = extractVat(grossRefund, vatRate);
  return transaction(
    LedgerEventKind.Refund,
    [
      entry(LedgerAccount.RefundExpense, split.net, 'refund to customer'),
      entry(LedgerAccount.VatPayable, split.vat, 'VAT reclaimed on refund'),
      entry(LedgerAccount.PspClearing, agorot(-grossRefund), 'refunded via PSP'),
    ],
    ctx,
    providerRef ?? null,
  );
}

// --- incentives -------------------------------------------------------------

/**
 * Earnings guarantees paid to buy early liquidity. The plan is explicit that
 * this should be budgeted rather than discovered, so it gets its own account
 * instead of being netted into payouts.
 */
export function driverIncentivePostings(amount: Agorot, ctx: PostingContext): LedgerTransaction {
  return transaction(
    LedgerEventKind.Incentive,
    [
      entry(LedgerAccount.DriverIncentiveExpense, amount, 'earnings guarantee top-up'),
      entry(LedgerAccount.DriverPayable, agorot(-amount), 'owed to driver'),
    ],
    ctx,
  );
}
