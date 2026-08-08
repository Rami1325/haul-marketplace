import { agorot, type Agorot } from '@haul/types';
import {
  AuthorizationStatus,
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

/**
 * ---------------------------------------------------------------------------
 * In-memory acquiring provider
 * ---------------------------------------------------------------------------
 * Lets the entire booking flow — quote, authorize, dispatch, capture, refund —
 * run end to end with no PSP account, no credentials and no network. That means
 * the web app and the dispatch service are developable and testable before the
 * PayPlus/HYP contract is even signed.
 *
 * It enforces the same rules a real provider does, which is the point: capture
 * cannot exceed the authorization, expired holds fail, and every call is
 * idempotent. A fake that is more permissive than production is a fake that
 * hides bugs until launch week.
 * ---------------------------------------------------------------------------
 */

export interface FakeProviderOptions {
  /** Match the shortest window we might see in production, not the longest. */
  authorizationValidityHours?: number;
  supportsPartialCapture?: boolean;
  /** Injected clock, so tests can move time without waiting. */
  now?: () => Date;
  /** Force specific failures. Keyed by idempotency key. */
  failWith?: Map<string, PaymentErrorCode>;
}

export class FakeAcquiringProvider implements AcquiringProvider {
  readonly id = PaymentProviderId.Fake;
  readonly supportsPartialCapture: boolean;
  readonly authorizationValidityHours: number;

  private readonly now: () => Date;
  private readonly failWith: Map<string, PaymentErrorCode>;

  private readonly methods = new Map<string, PaymentMethod>();
  private readonly authorizations = new Map<string, Authorization>();
  private readonly captures = new Map<string, Capture>();
  private readonly refunds = new Map<string, Refund>();
  /** Idempotency: key → the id of whatever that call produced. */
  private readonly idempotency = new Map<string, string>();
  private readonly capturedByAuthorization = new Map<string, number>();

  private sequence = 0;

  constructor(options: FakeProviderOptions = {}) {
    this.authorizationValidityHours = options.authorizationValidityHours ?? 72;
    this.supportsPartialCapture = options.supportsPartialCapture ?? true;
    this.now = options.now ?? (() => new Date());
    this.failWith = options.failWith ?? new Map();
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_fake_${String(this.sequence).padStart(6, '0')}`;
  }

  private injectedFailure<T>(idempotencyKey: string): PaymentResult<T> | null {
    const code = this.failWith.get(idempotencyKey);
    if (!code) return null;
    return { ok: false, code, message: `injected failure: ${code}` };
  }

  async tokenise(request: TokeniseRequest): Promise<PaymentResult<PaymentMethod>> {
    const token = this.nextId('tok');
    const method: PaymentMethod = {
      token,
      providerId: PaymentProviderId.Fake,
      customerId: request.customerId,
      lastFour: '4242',
      brand: 'ויזה',
      expiryMonth: 12,
      expiryYear: this.now().getUTCFullYear() + 3,
      issuer: 'Fake Issuer',
      createdAt: this.now(),
      disabledAt: null,
    };
    this.methods.set(token, method);
    return { ok: true, value: method };
  }

  async authorize(request: AuthorizeRequest): Promise<PaymentResult<Authorization>> {
    const injected = this.injectedFailure<Authorization>(request.idempotencyKey);
    if (injected) return injected;

    const existingId = this.idempotency.get(request.idempotencyKey);
    if (existingId) {
      const existing = this.authorizations.get(existingId);
      if (existing) return { ok: true, value: existing };
    }

    if (!this.methods.has(request.token)) {
      return {
        ok: false,
        code: PaymentErrorCode.InvalidRequest,
        message: `unknown token ${request.token}`,
      };
    }
    if (request.amount <= 0) {
      return {
        ok: false,
        code: PaymentErrorCode.InvalidRequest,
        message: 'authorization amount must be positive',
      };
    }

    const issuedAt = this.now();
    const authorization: Authorization = {
      id: this.nextId('auth'),
      providerRef: this.nextId('ppref'),
      providerId: PaymentProviderId.Fake,
      jobId: request.jobId,
      customerId: request.customerId,
      token: request.token,
      amount: request.amount,
      currency: 'ILS',
      status: AuthorizationStatus.Active,
      authorizedAt: issuedAt,
      expiresAt: new Date(issuedAt.getTime() + this.authorizationValidityHours * 3_600_000),
      approvalNumber: String(1_000_000 + this.sequence),
      declineReason: null,
    };

    this.authorizations.set(authorization.id, authorization);
    this.idempotency.set(request.idempotencyKey, authorization.id);
    return { ok: true, value: authorization };
  }

  async capture(request: CaptureRequest): Promise<PaymentResult<Capture>> {
    const injected = this.injectedFailure<Capture>(request.idempotencyKey);
    if (injected) return injected;

    const existingId = this.idempotency.get(request.idempotencyKey);
    if (existingId) {
      const existing = this.captures.get(existingId);
      if (existing) return { ok: true, value: existing };
    }

    const authorization = this.authorizations.get(request.authorizationId);
    if (!authorization) {
      return {
        ok: false,
        code: PaymentErrorCode.InvalidRequest,
        message: `unknown authorization ${request.authorizationId}`,
      };
    }

    if (this.now() > authorization.expiresAt) {
      this.authorizations.set(authorization.id, {
        ...authorization,
        status: AuthorizationStatus.Expired,
      });
      return {
        ok: false,
        code: PaymentErrorCode.AuthorizationExpired,
        message: `hold lapsed at ${authorization.expiresAt.toISOString()}`,
      };
    }

    if (
      authorization.status !== AuthorizationStatus.Active &&
      authorization.status !== AuthorizationStatus.PartiallyCaptured
    ) {
      return {
        ok: false,
        code: PaymentErrorCode.InvalidRequest,
        message: `authorization is ${authorization.status}`,
      };
    }

    const already = this.capturedByAuthorization.get(authorization.id) ?? 0;
    const amount = request.amount ?? (agorot(authorization.amount - already) as Agorot);

    if (amount <= 0) {
      return {
        ok: false,
        code: PaymentErrorCode.InvalidRequest,
        message: 'capture amount must be positive',
      };
    }
    if (already + amount > authorization.amount) {
      // The rule the price lock leans on: we can take less than we held, never more.
      return {
        ok: false,
        code: PaymentErrorCode.CaptureExceedsAuthorization,
        message: `cannot capture ${amount} — only ${authorization.amount - already} remains held`,
      };
    }
    if (!this.supportsPartialCapture && amount !== authorization.amount) {
      return {
        ok: false,
        code: PaymentErrorCode.InvalidRequest,
        message: 'provider does not support partial capture',
      };
    }

    const capture: Capture = {
      id: this.nextId('cap'),
      providerRef: this.nextId('ppcap'),
      authorizationId: authorization.id,
      jobId: authorization.jobId,
      amount,
      capturedAt: this.now(),
      invoiceDocumentId: null,
    };

    this.captures.set(capture.id, capture);
    this.idempotency.set(request.idempotencyKey, capture.id);

    const total = already + amount;
    this.capturedByAuthorization.set(authorization.id, total);
    this.authorizations.set(authorization.id, {
      ...authorization,
      status:
        total === authorization.amount
          ? AuthorizationStatus.Captured
          : AuthorizationStatus.PartiallyCaptured,
    });

    return { ok: true, value: capture };
  }

  async voidAuthorization(
    authorizationId: string,
    idempotencyKey: string,
  ): Promise<PaymentResult<Authorization>> {
    const injected = this.injectedFailure<Authorization>(idempotencyKey);
    if (injected) return injected;

    const authorization = this.authorizations.get(authorizationId);
    if (!authorization) {
      return {
        ok: false,
        code: PaymentErrorCode.InvalidRequest,
        message: `unknown authorization ${authorizationId}`,
      };
    }

    // Releasing an already-released hold is a success, not an error. Cancellation
    // retries are routine and must not surface as failures.
    if (authorization.status === AuthorizationStatus.Voided) {
      return { ok: true, value: authorization };
    }

    const voided: Authorization = { ...authorization, status: AuthorizationStatus.Voided };
    this.authorizations.set(authorizationId, voided);
    return { ok: true, value: voided };
  }

  async refund(request: RefundRequest): Promise<PaymentResult<Refund>> {
    const injected = this.injectedFailure<Refund>(request.idempotencyKey);
    if (injected) return injected;

    const existingId = this.idempotency.get(request.idempotencyKey);
    if (existingId) {
      const existing = this.refunds.get(existingId);
      if (existing) return { ok: true, value: existing };
    }

    const capture = this.captures.get(request.captureId);
    if (!capture) {
      return {
        ok: false,
        code: PaymentErrorCode.InvalidRequest,
        message: `unknown capture ${request.captureId}`,
      };
    }

    const alreadyRefunded = [...this.refunds.values()]
      .filter((r) => r.captureId === capture.id)
      .reduce((acc, r) => acc + r.amount, 0);

    if (alreadyRefunded + request.amount > capture.amount) {
      return {
        ok: false,
        code: PaymentErrorCode.InvalidRequest,
        message: `refund exceeds the captured amount`,
      };
    }

    const refund: Refund = {
      id: this.nextId('ref'),
      providerRef: this.nextId('ppref'),
      captureId: capture.id,
      jobId: capture.jobId,
      amount: request.amount,
      reason: request.reason,
      refundedAt: this.now(),
    };
    this.refunds.set(refund.id, refund);
    this.idempotency.set(request.idempotencyKey, refund.id);
    return { ok: true, value: refund };
  }

  async getAuthorization(authorizationId: string): Promise<PaymentResult<Authorization>> {
    const authorization = this.authorizations.get(authorizationId);
    if (!authorization) {
      return {
        ok: false,
        code: PaymentErrorCode.InvalidRequest,
        message: `unknown authorization ${authorizationId}`,
      };
    }
    // Lazily expire, the way an issuer effectively does.
    if (
      authorization.status === AuthorizationStatus.Active &&
      this.now() > authorization.expiresAt
    ) {
      const expired: Authorization = { ...authorization, status: AuthorizationStatus.Expired };
      this.authorizations.set(authorizationId, expired);
      return { ok: true, value: expired };
    }
    return { ok: true, value: authorization };
  }

  // --- test helpers ---------------------------------------------------------

  capturedTotalFor(authorizationId: string): number {
    return this.capturedByAuthorization.get(authorizationId) ?? 0;
  }
}
