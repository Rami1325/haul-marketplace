/**
 * @haul/payments — two rails, because that is the shape of the problem in Israel.
 *
 *   acquiring  — customer money in, via a local PSP (PayPlus / HYP), J5 then J4
 *   payout     — driver money out, via the bank; no PSP offers this here
 *
 * The consequence worth remembering: no vendor knows what a driver is owed.
 * The ledger in `postings.ts` is the system of record, not a reconciliation aid.
 */

export * from './acquiring.js';
export * from './payout.js';
export * from './postings.js';
export { FakeAcquiringProvider, type FakeProviderOptions } from './providers/fake.js';
export {
  PayPlusAcquiringProvider,
  PAYPLUS_ENDPOINTS,
  OPEN_QUESTIONS as PAYPLUS_OPEN_QUESTIONS,
  mapPayPlusError,
  type PayPlusConfig,
} from './providers/payplus.js';
