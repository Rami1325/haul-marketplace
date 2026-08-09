import { z } from 'zod';
import { AgorotSchema, NonNegativeAgorotSchema, type Agorot } from '@haul/types';

/**
 * ---------------------------------------------------------------------------
 * Acquiring — customer money in
 * ---------------------------------------------------------------------------
 * One of two rails. This one takes money from a card; `payout.ts` sends money
 * to a driver's bank. In a Stripe Connect world these would be one product. In
 * Israel they are not, and pretending otherwise is how the ledger ends up
 * wrong.
 *
 * The interface is deliberately shaped around what Israeli PSPs actually do,
 * which is J5/J4 processing:
 *
 *   J5  approval    — reserve an amount against the card. No money moves.
 *   J4  charge      — take the money. Once.
 *
 * Two constraints follow from that, and both are load-bearing for Price Lock:
 *
 *  1. **A J5 hold does not live for weeks.** Roughly seven in ten moves are
 *     booked further ahead than a hold survives, so a scheduled job keeps a
 *     tokenised card and gets its hold shortly before dispatch opens. That is
 *     why `JobState.Scheduled` exists.
 *  2. **Capture may be for less than was authorized**, never more. A
 *     cancellation fee captures a slice of the hold and releases the rest. If a
 *     provider cannot do partial capture, that is a blocking finding, not a
 *     workaround — see `SUPPORTS_PARTIAL_CAPTURE` on each adapter.
 * ---------------------------------------------------------------------------
 */

export const PaymentProviderId = {
  /** In-memory. Local development and tests. */
  Fake: 'fake',
  PayPlus: 'payplus',
  Hyp: 'hyp',
} as const;
export type PaymentProviderId = (typeof PaymentProviderId)[keyof typeof PaymentProviderId];

// --- payment methods --------------------------------------------------------

export const PaymentMethodSchema = z.object({
  /** Provider-side token. We never see or store a PAN. */
  token: z.string().min(1).max(255),
  providerId: z.enum([PaymentProviderId.Fake, PaymentProviderId.PayPlus, PaymentProviderId.Hyp]),
  customerId: z.string().min(1).max(64),

  lastFour: z.string().length(4),
  /** ויזה / ישראכרט / מאסטרקארד / אמריקן אקספרס */
  brand: z.string().max(40),
  expiryMonth: z.number().int().min(1).max(12),
  expiryYear: z.number().int().min(2024).max(2100),

  /** Israeli cards are issued by a handful of local issuers; useful for support. */
  issuer: z.string().max(60).nullable().default(null),

  createdAt: z.coerce.date(),
  /** Set when the card was rejected and should not be retried. */
  disabledAt: z.coerce.date().nullable().default(null),
});
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

// --- authorizations ---------------------------------------------------------

export const AuthorizationStatus = {
  /** Hold is live. */
  Active: 'active',
  /** Fully captured. */
  Captured: 'captured',
  /** Partially captured; remainder released. */
  PartiallyCaptured: 'partially_captured',
  /** Released without capture. */
  Voided: 'voided',
  /** Lapsed at the issuer. Money was never taken and cannot now be taken. */
  Expired: 'expired',
  Declined: 'declined',
} as const;
export type AuthorizationStatus = (typeof AuthorizationStatus)[keyof typeof AuthorizationStatus];

export const AuthorizationSchema = z.object({
  id: z.string().min(1).max(128),
  providerRef: z.string().min(1).max(255),
  providerId: z.enum([PaymentProviderId.Fake, PaymentProviderId.PayPlus, PaymentProviderId.Hyp]),

  jobId: z.string().min(1).max(64),
  customerId: z.string().min(1).max(64),
  token: z.string().min(1).max(255),

  amount: NonNegativeAgorotSchema,
  currency: z.literal('ILS').default('ILS'),
  status: z.enum([
    AuthorizationStatus.Active,
    AuthorizationStatus.Captured,
    AuthorizationStatus.PartiallyCaptured,
    AuthorizationStatus.Voided,
    AuthorizationStatus.Expired,
    AuthorizationStatus.Declined,
  ]),

  authorizedAt: z.coerce.date(),
  /**
   * When the hold lapses. Tracked because a silently expired hold means the
   * truck arrives with no valid payment — the worst possible moment to find out.
   * A scheduled job re-checks this before dispatch opens.
   */
  expiresAt: z.coerce.date(),

  /** Issuer approval number (מספר אישור). Support asks for this by name. */
  approvalNumber: z.string().max(64).nullable().default(null),
  declineReason: z.string().max(255).nullable().default(null),
});
export type Authorization = z.infer<typeof AuthorizationSchema>;

export const CaptureSchema = z.object({
  id: z.string().min(1).max(128),
  providerRef: z.string().min(1).max(255),
  authorizationId: z.string().min(1).max(128),
  jobId: z.string().min(1).max(64),
  amount: NonNegativeAgorotSchema,
  capturedAt: z.coerce.date(),
  /** Tax-invoice document id, once issued. Israeli law wants a חשבונית מס. */
  invoiceDocumentId: z.string().max(128).nullable().default(null),
});
export type Capture = z.infer<typeof CaptureSchema>;

export const RefundSchema = z.object({
  id: z.string().min(1).max(128),
  providerRef: z.string().min(1).max(255),
  captureId: z.string().min(1).max(128),
  jobId: z.string().min(1).max(64),
  amount: NonNegativeAgorotSchema,
  reason: z.string().max(255),
  refundedAt: z.coerce.date(),
});
export type Refund = z.infer<typeof RefundSchema>;

// --- results ----------------------------------------------------------------

export const PaymentErrorCode = {
  Declined: 'declined',
  InsufficientFunds: 'insufficient_funds',
  ExpiredCard: 'expired_card',
  /** The hold lapsed before we captured. Recoverable: re-authorize. */
  AuthorizationExpired: 'authorization_expired',
  /** Asked to capture more than was held. Always a bug on our side. */
  CaptureExceedsAuthorization: 'capture_exceeds_authorization',
  ProviderUnavailable: 'provider_unavailable',
  InvalidRequest: 'invalid_request',
  Unknown: 'unknown',
} as const;
export type PaymentErrorCode = (typeof PaymentErrorCode)[keyof typeof PaymentErrorCode];

/** Whether retrying the identical request could plausibly succeed. */
export function isRetryable(code: PaymentErrorCode): boolean {
  return code === PaymentErrorCode.ProviderUnavailable || code === PaymentErrorCode.Unknown;
}

export type PaymentResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly code: PaymentErrorCode;
      readonly message: string;
      /** Raw provider payload, kept for support and for adapter debugging. */
      readonly providerRaw?: unknown;
    };

// --- the interface ----------------------------------------------------------

export interface AuthorizeRequest {
  jobId: string;
  customerId: string;
  token: string;
  amount: Agorot;
  /** Shown on the customer's statement. Israeli descriptors are short. */
  descriptor?: string;
  idempotencyKey: string;
}

export interface CaptureRequest {
  authorizationId: string;
  /** Must be ≤ the authorized amount. Omit to capture in full. */
  amount?: Agorot;
  idempotencyKey: string;
}

export interface RefundRequest {
  captureId: string;
  amount: Agorot;
  reason: string;
  idempotencyKey: string;
}

export interface TokeniseRequest {
  customerId: string;
  /**
   * Provider-hosted page or SDK result. We never receive raw card data — that
   * is what keeps HAUL out of PCI scope beyond SAQ-A.
   */
  providerPayload: unknown;
}

/**
 * Every method is idempotent on `idempotencyKey`. Webhooks arrive more than
 * once and networks fail mid-call; a payment layer that double-charges under
 * retry is worse than one that occasionally fails closed.
 */
export interface AcquiringProvider {
  readonly id: PaymentProviderId;

  /**
   * Whether this provider can capture less than the authorized amount.
   *
   * Not a nice-to-have: a cancellation fee is a partial capture of the original
   * hold. Without it, the fee has to be a fresh charge on a token, which is a
   * materially worse customer experience and a different legal posture.
   */
  readonly supportsPartialCapture: boolean;

  /** How long a hold survives. Drives when a scheduled job is authorized. */
  readonly authorizationValidityHours: number;

  tokenise(request: TokeniseRequest): Promise<PaymentResult<PaymentMethod>>;
  authorize(request: AuthorizeRequest): Promise<PaymentResult<Authorization>>;
  capture(request: CaptureRequest): Promise<PaymentResult<Capture>>;
  /** Release a hold in full. Must be safe to call on an already-released hold. */
  voidAuthorization(
    authorizationId: string,
    idempotencyKey: string,
  ): Promise<PaymentResult<Authorization>>;
  refund(request: RefundRequest): Promise<PaymentResult<Refund>>;
  getAuthorization(authorizationId: string): Promise<PaymentResult<Authorization>>;
}

/**
 * When to place the hold on a scheduled job: far enough ahead that a failure
 * can be chased, comfortably inside the provider's validity window.
 */
export function authorizationLeadTimeHours(provider: AcquiringProvider): number {
  const desiredLead = 24;
  // Leave a safety margin, and never schedule the hold outside its own lifetime.
  return Math.min(desiredLead, Math.max(2, Math.floor(provider.authorizationValidityHours / 2)));
}

/** Amount left on a hold after any partial capture. */
export function remainingOnAuthorization(
  authorization: Pick<Authorization, 'amount' | 'status'>,
  capturedSoFar: Agorot,
): Agorot {
  if (authorization.status === 'voided' || authorization.status === 'expired') {
    return 0 as Agorot;
  }
  return Math.max(0, authorization.amount - capturedSoFar) as Agorot;
}

export const AgorotAmountSchema = AgorotSchema;
