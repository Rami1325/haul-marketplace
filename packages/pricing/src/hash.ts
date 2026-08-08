/**
 * Stable hash of a pricing input.
 *
 * Recorded on every quote so that months later, when a customer asks why they
 * were charged what they were, the answer is a lookup rather than an argument.
 * Identical inputs must always produce an identical hash — which also makes it
 * the cheapest possible regression test on the engine.
 *
 * Not a security primitive. FNV-1a, doubled to 64 bits, chosen because it needs
 * no crypto module and therefore runs identically in the browser, in React
 * Native, and on the server — which is the whole point of a shared engine.
 */

/** JSON with object keys sorted, so key order cannot change the hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(',')}}`;
}

export function stableHash(value: unknown): string {
  const text = canonicalJson(value);

  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= code + i;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }

  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
