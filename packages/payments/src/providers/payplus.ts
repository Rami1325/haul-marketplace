/**
 * ---------------------------------------------------------------------------
 * PayPlus adapter — skeleton
 * ---------------------------------------------------------------------------
 * Endpoint map taken from the published API index. Deliberately not a working
 * implementation: it needs a terminal, credentials and a sandbox to verify
 * against, and an adapter written blind against a payments API is an adapter
 * that fails in production rather than in a test.
 *
 * What this file is for is holding the research so it is not re-done, and
 * naming the two questions that must be answered before it can be finished.
 *
 * Docs: https://docs.payplus.co.il/  ·  index at /llms.txt
 * ---------------------------------------------------------------------------
 */

import {
  PaymentErrorCode,
  PaymentProviderId,
  type AcquiringProvider,
  type Authorization,
  type AuthorizeRequest,
  type Capture,
  type CaptureRequest,
  type PaymentMethod,
  type PaymentResult,
  type Refund,
  type RefundRequest,
  type TokeniseRequest,
} from '../acquiring.js';

export const PAYPLUS_ENDPOINTS = {
  /** J5 — reserve an amount. No money moves. */
  approval: '/Transactions/Approval',
  /** J4 — take the money. */
  charge: '/Transactions/Charge',
  /** Capture against an existing J5 by its transaction uid. */
  chargeByTransactionUid: '/Transactions/ChargeByTransactionUID',
  /** Same-day only, before the deposit cut-off. Not a general-purpose void. */
  cancel: '/Transactions/Cancel',
  refund: '/Transactions/Refund',
  refundByTransactionUid: '/Transactions/RefundByTransactionUID',
  tokenAdd: '/Token/Add',
  /** Israeli tax documents — חשבונית מס is a legal obligation, not a nicety. */
  invoiceGetDocuments: '/Invoice/GetDocuments',
  paymentPagesIpn: '/PaymentPages/ipn',
} as const;

/**
 * Blocking questions for PayPlus before this adapter can be written.
 * Both change the architecture, not just the implementation.
 */
export const OPEN_QUESTIONS = [
  // If a J5 hold survives only ~24-48h, the T-24h authorization window for
  // scheduled jobs has to move closer still, and the retry policy tightens.
  'How long does a J5 approval remain valid before the issuer releases it?',

  // A cancellation fee is a partial capture of the original hold. Without
  // partial capture it must become a fresh charge against the token, which is
  // a worse customer experience and a different legal posture.
  'Can ChargeByTransactionUID capture LESS than the J5 approved amount?',

  // Determines whether "void" is a real operation or whether releases after the
  // cut-off have to be modelled as refunds — which customers see differently.
  'Is there a void/release for a J5 outside the same-day Cancel window?',

  // Israel Invoices (חשבוניות ישראל) allocation numbers are being phased in;
  // B2B in Phase 3 will need them.
  'Does the Books/Documents API issue allocation numbers for חשבוניות ישראל?',
] as const;

export interface PayPlusConfig {
  apiKey: string;
  secretKey: string;
  terminalUid: string;
  cashierUid: string;
  baseUrl: string;
}

class NotImplemented extends Error {
  constructor(operation: string) {
    super(
      `PayPlus adapter: ${operation} is not implemented yet. ` +
        `Resolve OPEN_QUESTIONS and verify against a sandbox terminal first.`,
    );
  }
}

export class PayPlusAcquiringProvider implements AcquiringProvider {
  readonly id = PaymentProviderId.PayPlus;

  /** Unverified — see OPEN_QUESTIONS. Assume the worst until confirmed. */
  readonly supportsPartialCapture = false;
  /** Conservative placeholder. Confirm with PayPlus before relying on it. */
  readonly authorizationValidityHours = 24;

  constructor(private readonly config: PayPlusConfig) {}

  /** Kept so the config is not flagged unused while the adapter is a skeleton. */
  get terminal(): string {
    return this.config.terminalUid;
  }

  async tokenise(_request: TokeniseRequest): Promise<PaymentResult<PaymentMethod>> {
    throw new NotImplemented('tokenise');
  }
  async authorize(_request: AuthorizeRequest): Promise<PaymentResult<Authorization>> {
    throw new NotImplemented('authorize');
  }
  async capture(_request: CaptureRequest): Promise<PaymentResult<Capture>> {
    throw new NotImplemented('capture');
  }
  async voidAuthorization(
    _authorizationId: string,
    _idempotencyKey: string,
  ): Promise<PaymentResult<Authorization>> {
    throw new NotImplemented('voidAuthorization');
  }
  async refund(_request: RefundRequest): Promise<PaymentResult<Refund>> {
    throw new NotImplemented('refund');
  }
  async getAuthorization(_authorizationId: string): Promise<PaymentResult<Authorization>> {
    throw new NotImplemented('getAuthorization');
  }
}

/** Maps a PayPlus status code to our error taxonomy. Extend as codes are observed. */
export function mapPayPlusError(statusCode: string): PaymentErrorCode {
  switch (statusCode) {
    case '000':
      return PaymentErrorCode.Unknown; // success — caller should not be here
    case '004':
    case '033':
      return PaymentErrorCode.Declined;
    case '039':
      return PaymentErrorCode.ExpiredCard;
    default:
      return PaymentErrorCode.Unknown;
  }
}
