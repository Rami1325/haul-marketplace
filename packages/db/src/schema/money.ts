import { relations, sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { agorot, createdAt, id, timestamptz, updatedAt } from '../columns.js';
import { drivers, users } from './identity.js';
import { jobs } from './jobs.js';
import {
  authorizationStatusEnum,
  disputeStatusEnum,
  ledgerAccountEnum,
  ledgerEventKindEnum,
  payoutBatchStatusEnum,
  payoutLineStatusEnum,
} from './enums.js';

/**
 * ---------------------------------------------------------------------------
 * Money
 * ---------------------------------------------------------------------------
 * No Israeli PSP offers marketplace payouts, so no vendor knows what a driver
 * is owed. These tables are the system of record, not a reconciliation aid —
 * "query the payment dashboard" stops being an answer the moment there are
 * refunds, partial captures, cancellation fees, tips and VAT in play.
 * ---------------------------------------------------------------------------
 */

/**
 * A ledger transaction. Its entries must sum to zero — enforced in the Zod
 * schema, in the posting functions, and again by a CHECK constraint added in
 * the PostGIS/constraints migration.
 */
export const ledgerTransactions = pgTable(
  'ledger_transactions',
  {
    id: id().primaryKey(),
    kind: ledgerEventKindEnum('kind').notNull(),

    jobId: id('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    driverId: id('driver_id').references(() => drivers.id, { onDelete: 'set null' }),
    customerId: id('customer_id').references(() => users.id, { onDelete: 'set null' }),

    /** Provider-side reference — payment intent, transfer, refund id. */
    externalRef: varchar('external_ref', { length: 200 }),
    /**
     * Payment webhooks arrive more than once. A ledger that double-books a
     * capture under retry is worse than one that occasionally misses it.
     */
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),

    occurredAt: timestamptz('occurred_at').notNull(),
    recordedAt: timestamptz('recorded_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('ledger_transactions_idempotency_key').on(table.idempotencyKey),
    index('ledger_transactions_job_idx').on(table.jobId),
    index('ledger_transactions_driver_idx').on(table.driverId, table.occurredAt),
    index('ledger_transactions_kind_time_idx').on(table.kind, table.occurredAt),
  ],
);

/**
 * One side of a transaction. A single signed integer rather than a direction
 * enum, which makes "sums to zero" a one-line check instead of a branch.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: id().primaryKey(),
    transactionId: id('transaction_id')
      .notNull()
      .references(() => ledgerTransactions.id, { onDelete: 'cascade' }),
    account: ledgerAccountEnum('account').notNull(),
    /** Positive is a debit, negative a credit. */
    amount: agorot('amount').notNull(),
    memo: varchar('memo', { length: 200 }),
    createdAt: createdAt(),
  },
  (table) => [
    index('ledger_entries_transaction_idx').on(table.transactionId),
    // Account balances are read per-account over a date range on every report.
    index('ledger_entries_account_idx').on(table.account),
  ],
);

/** Card holds. Tracked because a lapsed hold means a truck arrives unpaid. */
export const paymentAuthorizations = pgTable(
  'payment_authorizations',
  {
    id: id().primaryKey(),
    jobId: id('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    customerId: id('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    providerId: varchar('provider_id', { length: 40 }).notNull(),
    providerRef: varchar('provider_ref', { length: 255 }).notNull(),
    token: varchar('token', { length: 255 }).notNull(),

    amount: agorot('amount').notNull(),
    capturedAmount: agorot('captured_amount').notNull().default(0 as never),
    status: authorizationStatusEnum('status').notNull().default('active'),

    authorizedAt: timestamptz('authorized_at').notNull().defaultNow(),
    /**
     * When the hold lapses. A scheduled job re-checks this before dispatch
     * opens; a silently expired hold is the worst possible thing to discover
     * on the doorstep.
     */
    expiresAt: timestamptz('expires_at').notNull(),

    /** מספר אישור — what support asks for by name. */
    approvalNumber: varchar('approval_number', { length: 64 }),
    declineReason: varchar('decline_reason', { length: 255 }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('payment_authorizations_job_idx').on(table.jobId),
    // The sweep that re-authorizes or alerts before a hold lapses.
    index('payment_authorizations_expiry_idx')
      .on(table.expiresAt)
      .where(sql`status = 'active'`),
  ],
);

/**
 * Payout batches. Phase 1 is an ops export to the bank portal — with 25–40
 * launch drivers that is a few minutes a week, and it means launch does not
 * wait on a Masav integration.
 */
export const payoutBatches = pgTable('payout_batches', {
  id: id().primaryKey(),
  cityId: id('city_id').notNull(),
  status: payoutBatchStatusEnum('status').notNull().default('draft'),

  totalAmount: agorot('total_amount').notNull(),
  lineCount: integer('line_count').notNull(),

  periodStart: timestamptz('period_start').notNull(),
  periodEnd: timestamptz('period_end').notNull(),

  exportedAt: timestamptz('exported_at'),
  submittedAt: timestamptz('submitted_at'),
  settledAt: timestamptz('settled_at'),

  /** Whatever the bank gives back. The audit trail depends on it. */
  bankReference: varchar('bank_reference', { length: 120 }),
  submittedBy: id('submitted_by'),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const payoutLines = pgTable(
  'payout_lines',
  {
    id: id().primaryKey(),
    batchId: id('batch_id')
      .notNull()
      .references(() => payoutBatches.id, { onDelete: 'cascade' }),
    driverId: id('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),

    amount: agorot('amount').notNull(),
    /** Jobs this settles. The driver's statement is built from these. */
    jobIds: jsonb('job_ids').$type<string[]>().notNull(),

    /** Snapshot of the bank triplet at payout time, not a live lookup. */
    bankSnapshot: jsonb('bank_snapshot').notNull(),

    status: payoutLineStatusEnum('status').notNull().default('pending'),
    failureReason: varchar('failure_reason', { length: 255 }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Two lines for one driver in one batch is a grouping bug that pays them
    // twice. Made structurally impossible rather than checked in code.
    uniqueIndex('payout_lines_batch_driver_key').on(table.batchId, table.driverId),
    index('payout_lines_driver_idx').on(table.driverId),
  ],
);

/**
 * Damage claims. A 48-hour window, with before/after photos already on file —
 * which is what makes proof-of-condition photos pay for themselves.
 */
export const disputes = pgTable(
  'disputes',
  {
    id: id().primaryKey(),
    jobId: id('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    raisedBy: varchar('raised_by', { length: 20 }).notNull(),

    status: disputeStatusEnum('status').notNull().default('open'),
    category: varchar('category', { length: 64 }).notNull(),
    descriptionHe: text('description_he').notNull(),
    photoUrls: jsonb('photo_urls').$type<string[]>().notNull().default([]),

    claimedAmount: agorot('claimed_amount'),
    resolvedAmount: agorot('resolved_amount'),
    /** Amount debited from the driver, if any. Separate from the refund. */
    driverDebitAmount: agorot('driver_debit_amount'),

    /** SLA timer. Resolution speed is the metric, not resolution rate. */
    openedAt: timestamptz('opened_at').notNull().defaultNow(),
    dueAt: timestamptz('due_at').notNull(),
    resolvedAt: timestamptz('resolved_at'),
    resolvedBy: id('resolved_by'),
    resolutionNote: text('resolution_note'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('disputes_job_idx').on(table.jobId),
    index('disputes_open_idx')
      .on(table.dueAt)
      .where(sql`status in ('open', 'investigating')`),
  ],
);

export const ledgerTransactionsRelations = relations(ledgerTransactions, ({ many, one }) => ({
  entries: many(ledgerEntries),
  job: one(jobs, { fields: [ledgerTransactions.jobId], references: [jobs.id] }),
}));

export const ledgerEntriesRelations = relations(ledgerEntries, ({ one }) => ({
  transaction: one(ledgerTransactions, {
    fields: [ledgerEntries.transactionId],
    references: [ledgerTransactions.id],
  }),
}));

export const payoutBatchesRelations = relations(payoutBatches, ({ many }) => ({
  lines: many(payoutLines),
}));

export const payoutLinesRelations = relations(payoutLines, ({ one }) => ({
  batch: one(payoutBatches, { fields: [payoutLines.batchId], references: [payoutBatches.id] }),
  driver: one(drivers, { fields: [payoutLines.driverId], references: [drivers.id] }),
}));

export const disputesRelations = relations(disputes, ({ one }) => ({
  job: one(jobs, { fields: [disputes.jobId], references: [jobs.id] }),
}));
