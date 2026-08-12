/**
 * ---------------------------------------------------------------------------
 * Identifiers
 * ---------------------------------------------------------------------------
 * Two kinds, for two audiences.
 *
 * Internal ids are prefixed ULID-ish strings: sortable by creation time, safe
 * in a URL, and self-describing in a log line (`job_01J...` beats a bare UUID
 * when you're reading a stack trace at 2am).
 *
 * The customer-facing reference is short, unambiguous when spoken aloud, and
 * excludes characters people confuse — no O/0, no I/1. "HL-4821" is what
 * someone reads to a support agent over a bad phone line in a stairwell.
 * ---------------------------------------------------------------------------
 */

export const ID_PREFIX = {
  /** A booking in progress. Becomes a `job` if the customer finishes. */
  draft: 'drf',
  job: 'job',
  quote: 'qte',
  offer: 'ofr',
  driver: 'drv',
  customer: 'cus',
  vehicle: 'veh',
  document: 'doc',
  adjustment: 'adj',
  photo: 'pho',
  ledger: 'ldg',
  dispute: 'dsp',
  promo: 'prm',
} as const;
export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * ULID: 48-bit timestamp + 80 bits of randomness, Crockford base32.
 * Lexicographic sort equals chronological sort, which makes `ORDER BY id` a
 * legitimate index-friendly answer to "most recent first".
 */
export function ulid(now: number = Date.now(), random: () => number = Math.random): string {
  let timePart = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[t % 32]! + timePart;
    t = Math.floor(t / 32);
  }
  let randomPart = '';
  for (let i = 0; i < 16; i++) {
    randomPart += CROCKFORD[Math.floor(random() * 32)]!;
  }
  return timePart + randomPart;
}

export function newId(prefix: IdPrefix, now?: number, random?: () => number): string {
  return `${prefix}_${ulid(now, random)}`;
}

export function idPrefixOf(id: string): string | null {
  const idx = id.indexOf('_');
  return idx === -1 ? null : id.slice(0, idx);
}

export function isIdOfKind(id: string, prefix: IdPrefix): boolean {
  return idPrefixOf(id) === prefix;
}

/** Unambiguous when spoken: no O/0, no I/1, no S/5. */
const HUMAN_ALPHABET = '23456789ACDEFGHJKLMNPQRTUVWXYZ';

/**
 * Short reference for a job — `HL-4821`. Collisions are possible in principle,
 * so the database enforces uniqueness and the generator retries; it is a
 * convenience label, not an identity.
 */
export function humanReference(random: () => number = Math.random): string {
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += HUMAN_ALPHABET[Math.floor(random() * HUMAN_ALPHABET.length)]!;
  }
  return `HL-${suffix}`;
}

/** Four digits the customer reads to the driver at handover. */
export function completionPin(random: () => number = Math.random): string {
  return String(Math.floor(random() * 10000)).padStart(4, '0');
}
