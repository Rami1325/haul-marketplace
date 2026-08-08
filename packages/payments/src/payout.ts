import { z } from 'zod';
import { NonNegativeAgorotSchema, toDecimalString, type Agorot } from '@haul/types';

/**
 * ---------------------------------------------------------------------------
 * Payouts — driver money out
 * ---------------------------------------------------------------------------
 * The second rail, and the one with no vendor behind it.
 *
 * Neither PayPlus nor HYP exposes a payouts or third-party transfer endpoint.
 * There is no Israeli equivalent of Stripe Connect's managed sub-accounts, so
 * nobody outside this codebase knows what a driver is owed. That makes the
 * ledger the system of record rather than a reconciliation aid, and it makes
 * this module responsible for turning ledger balances into money that actually
 * leaves the bank.
 *
 * Phase 1 ships the honest version: the ledger computes what each driver is
 * owed, ops exports a batch, and it goes through the bank portal. With 25–40
 * launch drivers that is a few minutes a week, and it means launch does not
 * wait on a Masav integration. The interface is shaped so a file-generating or
 * API-driven provider drops in later without the ledger noticing.
 * ---------------------------------------------------------------------------
 */

// --- Israeli bank details ---------------------------------------------------

/**
 * Israeli accounts are a bank/branch/account triplet, not an IBAN. IBANs exist
 * and are derivable, but every domestic transfer form asks for the triplet, and
 * drivers will read it off their chequebook in that shape.
 */
export const IsraeliBankAccountSchema = z.object({
  /** מספר בנק — 10 Leumi, 12 Hapoalim, 20 Mizrahi-Tefahot, 11 Discount, 31 Beinleumi. */
  bankCode: z.string().regex(/^\d{1,3}$/, 'bank code is 1–3 digits'),
  /** מספר סניף */
  branchCode: z.string().regex(/^\d{1,3}$/, 'branch code is 1–3 digits'),
  /** מספר חשבון */
  accountNumber: z.string().regex(/^\d{1,20}$/, 'account number is digits only'),
  /** Must match the name on the account or the bank will bounce the transfer. */
  beneficiaryName: z.string().min(2).max(120),
  /**
   * תעודת זהות or ח.פ. Required on a bulk transfer, and the thing that makes a
   * payout traceable to a person for tax purposes.
   */
  beneficiaryTaxId: z.string().regex(/^\d{9}$/, 'Israeli ID / company number is 9 digits'),
});
export type IsraeliBankAccount = z.infer<typeof IsraeliBankAccountSchema>;

/**
 * Check digit validation for a 9-digit Israeli ID (תעודת זהות).
 *
 * Cheap, offline, and catches the transposed digits that would otherwise become
 * a bounced payout and a support ticket a week later.
 */
export function isValidIsraeliId(id: string): boolean {
  if (!/^\d{1,9}$/.test(id)) return false;
  const padded = id.padStart(9, '0');

  let total = 0;
  for (let i = 0; i < 9; i++) {
    const digit = Number(padded[i]);
    const product = digit * ((i % 2) + 1);
    total += product > 9 ? product - 9 : product;
  }
  return total % 10 === 0;
}

// --- batches ----------------------------------------------------------------

export const PayoutLineStatus = {
  Pending: 'pending',
  Paid: 'paid',
  /** Bank rejected it — wrong account, name mismatch, closed account. */
  Failed: 'failed',
  /** Held back by ops: dispute open, documents lapsed, suspected fraud. */
  Withheld: 'withheld',
} as const;
export type PayoutLineStatus = (typeof PayoutLineStatus)[keyof typeof PayoutLineStatus];

export const PayoutLineSchema = z.object({
  id: z.string().min(1).max(64),
  driverId: z.string().min(1).max(64),
  bankAccount: IsraeliBankAccountSchema,
  amount: NonNegativeAgorotSchema,
  /** Jobs this payout settles. The driver's statement is built from these. */
  jobIds: z.array(z.string().max(64)).min(1),
  status: z
    .enum([
      PayoutLineStatus.Pending,
      PayoutLineStatus.Paid,
      PayoutLineStatus.Failed,
      PayoutLineStatus.Withheld,
    ])
    .default(PayoutLineStatus.Pending),
  failureReason: z.string().max(255).nullable().default(null),
});
export type PayoutLine = z.infer<typeof PayoutLineSchema>;

export const PayoutBatchStatus = {
  Draft: 'draft',
  /** File generated and handed to ops. */
  Exported: 'exported',
  /** Ops confirmed submission to the bank. */
  Submitted: 'submitted',
  Settled: 'settled',
  PartiallyFailed: 'partially_failed',
} as const;
export type PayoutBatchStatus = (typeof PayoutBatchStatus)[keyof typeof PayoutBatchStatus];

export const PayoutBatchSchema = z.object({
  id: z.string().min(1).max(64),
  lines: z.array(PayoutLineSchema).min(1),
  totalAmount: NonNegativeAgorotSchema,
  status: z
    .enum([
      PayoutBatchStatus.Draft,
      PayoutBatchStatus.Exported,
      PayoutBatchStatus.Submitted,
      PayoutBatchStatus.Settled,
      PayoutBatchStatus.PartiallyFailed,
    ])
    .default(PayoutBatchStatus.Draft),

  /** Jobs completed in this window are what the batch settles. */
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),

  createdAt: z.coerce.date(),
  exportedAt: z.coerce.date().nullable().default(null),
  submittedAt: z.coerce.date().nullable().default(null),
  settledAt: z.coerce.date().nullable().default(null),

  /** Whatever the bank gives back. The audit trail depends on it being recorded. */
  bankReference: z.string().max(120).nullable().default(null),
  /** Who at HAUL pushed the button. */
  submittedBy: z.string().max(64).nullable().default(null),
});
export type PayoutBatch = z.infer<typeof PayoutBatchSchema>;

export interface PayoutExport {
  filename: string;
  mimeType: string;
  content: string;
}

export interface PayoutProvider {
  readonly id: string;
  /** True when money moves without a human. False for the Phase 1 export flow. */
  readonly isAutomated: boolean;

  buildBatch(lines: readonly PayoutLine[], period: { start: Date; end: Date }): PayoutBatch;
  exportBatch(batch: PayoutBatch): PayoutExport;
}

// --- the Phase 1 provider ---------------------------------------------------

/**
 * Exports a batch as CSV for upload to the bank's business portal.
 *
 * Deliberately not a Masav file. The Masav record layout is issued by the bank
 * per-customer, and inventing one here would produce a file that looks right
 * and is rejected on submission. When the real spec arrives, add a provider
 * that implements the same interface; nothing upstream changes.
 */
export class ManualExportPayoutProvider implements PayoutProvider {
  readonly id = 'manual_export';
  readonly isAutomated = false;

  buildBatch(lines: readonly PayoutLine[], period: { start: Date; end: Date }): PayoutBatch {
    const payable = lines.filter((l) => l.status !== PayoutLineStatus.Withheld);
    const total = payable.reduce((acc, l) => acc + l.amount, 0) as Agorot;

    return PayoutBatchSchema.parse({
      id: `payout_${period.start.toISOString().slice(0, 10)}_${period.end.toISOString().slice(0, 10)}`,
      lines: [...lines],
      totalAmount: total,
      status: PayoutBatchStatus.Draft,
      periodStart: period.start,
      periodEnd: period.end,
      createdAt: period.end,
    });
  }

  exportBatch(batch: PayoutBatch): PayoutExport {
    const header = [
      'bank_code',
      'branch_code',
      'account_number',
      'beneficiary_name',
      'beneficiary_tax_id',
      'amount_ils',
      'reference',
      'job_count',
    ];

    const rows = batch.lines
      .filter((line) => line.status === PayoutLineStatus.Pending)
      .map((line) =>
        [
          line.bankAccount.bankCode,
          line.bankAccount.branchCode,
          line.bankAccount.accountNumber,
          csvEscape(line.bankAccount.beneficiaryName),
          line.bankAccount.beneficiaryTaxId,
          // Banks want decimal shekels, not agorot. Converted once, at the edge.
          toDecimalString(line.amount),
          `HAUL ${batch.id}`,
          String(line.jobIds.length),
        ].join(','),
      );

    return {
      filename: `${batch.id}.csv`,
      mimeType: 'text/csv',
      // BOM so Excel on a Hebrew Windows machine opens it without mangling names.
      content: `﻿${[header.join(','), ...rows].join('\r\n')}\r\n`,
    };
  }
}

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Validate a batch before anyone is allowed to submit it. A bad row in a bulk
 * transfer is not a failed request — it is a wrong payment that has to be
 * clawed back from a contractor.
 */
export function validatePayoutBatch(batch: PayoutBatch): string[] {
  const problems: string[] = [];

  const payable = batch.lines.filter((l) => l.status === PayoutLineStatus.Pending);
  if (payable.length === 0) problems.push('batch has no payable lines');

  const declaredTotal = batch.lines
    .filter((l) => l.status !== PayoutLineStatus.Withheld)
    .reduce((acc, l) => acc + l.amount, 0);
  if (declaredTotal !== batch.totalAmount) {
    problems.push(`total is ${batch.totalAmount} but lines sum to ${declaredTotal}`);
  }

  const seenDrivers = new Set<string>();
  for (const line of payable) {
    if (line.amount <= 0) {
      problems.push(`line ${line.id}: amount must be positive`);
    }
    if (!isValidIsraeliId(line.bankAccount.beneficiaryTaxId)) {
      problems.push(`line ${line.id}: tax id fails its check digit`);
    }
    if (seenDrivers.has(line.driverId)) {
      // Two lines for one driver in one batch is almost always a grouping bug,
      // and it pays them twice.
      problems.push(`driver ${line.driverId} appears more than once in the batch`);
    }
    seenDrivers.add(line.driverId);
  }

  return problems;
}
