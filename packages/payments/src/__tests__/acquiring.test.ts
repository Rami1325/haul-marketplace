import { shekels } from '@haul/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthorizationStatus, PaymentErrorCode, authorizationLeadTimeHours } from '../acquiring.js';
import { FakeAcquiringProvider } from '../providers/fake.js';

let clock = new Date('2026-08-08T09:00:00Z');
const now = () => clock;

function provider(overrides = {}) {
  return new FakeAcquiringProvider({ now, authorizationValidityHours: 72, ...overrides });
}

async function tokenised(p: FakeAcquiringProvider) {
  const result = await p.tokenise({ customerId: 'cus_1', providerPayload: {} });
  if (!result.ok) throw new Error('tokenise failed');
  return result.value.token;
}

beforeEach(() => {
  clock = new Date('2026-08-08T09:00:00Z');
});

describe('authorize then capture', () => {
  it('holds and then takes the exact locked amount', async () => {
    const p = provider();
    const token = await tokenised(p);

    const auth = await p.authorize({
      jobId: 'job_1',
      customerId: 'cus_1',
      token,
      amount: shekels(248),
      idempotencyKey: 'auth_1',
    });
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    expect(auth.value.status).toBe(AuthorizationStatus.Active);

    const capture = await p.capture({
      authorizationId: auth.value.id,
      idempotencyKey: 'cap_1',
    });
    expect(capture.ok).toBe(true);
    if (capture.ok) expect(capture.value.amount).toBe(shekels(248));
  });

  it('captures less than was held, for a cancellation fee', async () => {
    const p = provider();
    const token = await tokenised(p);
    const auth = await p.authorize({
      jobId: 'job_1',
      customerId: 'cus_1',
      token,
      amount: shekels(248),
      idempotencyKey: 'a',
    });
    if (!auth.ok) throw new Error('setup');

    const capture = await p.capture({
      authorizationId: auth.value.id,
      amount: shekels(60),
      idempotencyKey: 'c',
    });
    expect(capture.ok).toBe(true);
    if (capture.ok) expect(capture.value.amount).toBe(shekels(60));
  });

  it('never captures more than was held', async () => {
    // The rule Price Lock leans on. If this ever passes, the product is lying.
    const p = provider();
    const token = await tokenised(p);
    const auth = await p.authorize({
      jobId: 'job_1',
      customerId: 'cus_1',
      token,
      amount: shekels(248),
      idempotencyKey: 'a',
    });
    if (!auth.ok) throw new Error('setup');

    const capture = await p.capture({
      authorizationId: auth.value.id,
      amount: shekels(300),
      idempotencyKey: 'c',
    });
    expect(capture).toMatchObject({
      ok: false,
      code: PaymentErrorCode.CaptureExceedsAuthorization,
    });
  });

  it('refuses to capture an expired hold', async () => {
    const p = provider({ authorizationValidityHours: 24 });
    const token = await tokenised(p);
    const auth = await p.authorize({
      jobId: 'job_1',
      customerId: 'cus_1',
      token,
      amount: shekels(248),
      idempotencyKey: 'a',
    });
    if (!auth.ok) throw new Error('setup');

    clock = new Date('2026-08-10T09:00:00Z'); // two days later

    const capture = await p.capture({ authorizationId: auth.value.id, idempotencyKey: 'c' });
    expect(capture).toMatchObject({ ok: false, code: PaymentErrorCode.AuthorizationExpired });
  });

  it('reports a lapsed hold on read, so a scheduled job can be re-authorized', async () => {
    const p = provider({ authorizationValidityHours: 24 });
    const token = await tokenised(p);
    const auth = await p.authorize({
      jobId: 'job_1',
      customerId: 'cus_1',
      token,
      amount: shekels(248),
      idempotencyKey: 'a',
    });
    if (!auth.ok) throw new Error('setup');

    clock = new Date('2026-08-12T09:00:00Z');
    const read = await p.getAuthorization(auth.value.id);
    expect(read.ok && read.value.status).toBe(AuthorizationStatus.Expired);
  });
});

describe('idempotency', () => {
  it('returns the same authorization when a request is retried', async () => {
    const p = provider();
    const token = await tokenised(p);
    const request = {
      jobId: 'job_1',
      customerId: 'cus_1',
      token,
      amount: shekels(248),
      idempotencyKey: 'same_key',
    };

    const first = await p.authorize(request);
    const second = await p.authorize(request);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(second.value.id).toBe(first.value.id);
  });

  it('does not double-charge when a capture webhook arrives twice', async () => {
    const p = provider();
    const token = await tokenised(p);
    const auth = await p.authorize({
      jobId: 'job_1',
      customerId: 'cus_1',
      token,
      amount: shekels(248),
      idempotencyKey: 'a',
    });
    if (!auth.ok) throw new Error('setup');

    const request = { authorizationId: auth.value.id, idempotencyKey: 'cap_key' };
    const first = await p.capture(request);
    const second = await p.capture(request);

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(second.value.id).toBe(first.value.id);
    // The decisive check: the customer was charged once.
    expect(p.capturedTotalFor(auth.value.id)).toBe(shekels(248));
  });

  it('treats releasing an already-released hold as success', async () => {
    const p = provider();
    const token = await tokenised(p);
    const auth = await p.authorize({
      jobId: 'job_1',
      customerId: 'cus_1',
      token,
      amount: shekels(248),
      idempotencyKey: 'a',
    });
    if (!auth.ok) throw new Error('setup');

    expect((await p.voidAuthorization(auth.value.id, 'v1')).ok).toBe(true);
    expect((await p.voidAuthorization(auth.value.id, 'v2')).ok).toBe(true);
  });
});

describe('scheduled-job authorization timing', () => {
  it('places the hold comfortably inside the provider’s validity window', () => {
    // A 72h window gives the full 24h lead.
    expect(authorizationLeadTimeHours(provider({ authorizationValidityHours: 72 }))).toBe(24);
    // A tight 24h window pulls the hold closer rather than scheduling it
    // outside its own lifetime.
    expect(authorizationLeadTimeHours(provider({ authorizationValidityHours: 24 }))).toBe(12);
    // Even a very short window still leaves a couple of hours to react.
    expect(authorizationLeadTimeHours(provider({ authorizationValidityHours: 2 }))).toBe(2);
  });
});

describe('refunds', () => {
  it('will not refund more than was captured', async () => {
    const p = provider();
    const token = await tokenised(p);
    const auth = await p.authorize({
      jobId: 'job_1',
      customerId: 'cus_1',
      token,
      amount: shekels(248),
      idempotencyKey: 'a',
    });
    if (!auth.ok) throw new Error('setup');
    const capture = await p.capture({ authorizationId: auth.value.id, idempotencyKey: 'c' });
    if (!capture.ok) throw new Error('setup');

    const partial = await p.refund({
      captureId: capture.value.id,
      amount: shekels(100),
      reason: 'goodwill',
      idempotencyKey: 'r1',
    });
    expect(partial.ok).toBe(true);

    const excessive = await p.refund({
      captureId: capture.value.id,
      amount: shekels(200),
      reason: 'goodwill',
      idempotencyKey: 'r2',
    });
    expect(excessive.ok).toBe(false);
  });
});
