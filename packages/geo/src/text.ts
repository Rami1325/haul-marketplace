/**
 * ---------------------------------------------------------------------------
 * Address text — what Israelis actually type
 * ---------------------------------------------------------------------------
 * An Israeli address field receives Hebrew with and without the street word,
 * with and without a geresh, with the house number before or after the name,
 * and sometimes in Latin because the phone's keyboard was left in English.
 * "רח' דיזנגוף 50", "דיזנגוף 50 תל אביב" and "dizengoff 50" are the same
 * request and must rank the same way.
 *
 * This lives outside the fake provider because it is not fake behaviour. Any
 * adapter needs it — to key a cache, to decide whether two keystrokes are the
 * same query, and to strip the noise before spending a paid lookup on it.
 * ---------------------------------------------------------------------------
 */

/**
 * Street-type words that carry no identifying information. Stripped from both
 * the query and the seeded street names by the same pass, so "דרך נמיר" and
 * "נמיר" collapse to one key rather than to two that never meet.
 */
const STREET_WORDS = ['רחוב', 'רח', 'שדרות', 'שדרת', 'שד', 'סמטת', 'סמטה', 'דרך', 'street', 'st'];

/** Niqqud, cantillation marks and the Hebrew punctuation nobody types twice the same way. */
const HEBREW_DIACRITICS = /[֑-ׇ]/g;
/** ASCII quotes plus geresh, gershayim and the curly forms a phone keyboard substitutes. */
const QUOTE_MARKS = /['"`׳״‘’“”]/g;

/**
 * Fold an address query to a comparison key.
 *
 * Lower-casing is for the Latin half — Hebrew has no case — and is safe to
 * apply to both.
 */
export function normaliseAddressQuery(input: string): string {
  const folded = input
    .normalize('NFKC')
    .replace(HEBREW_DIACRITICS, '')
    .replace(QUOTE_MARKS, '')
    .replace(/[.,\-–—_]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const kept = folded.split(' ').filter((word) => word.length > 0 && !STREET_WORDS.includes(word));
  // A query that was nothing but a street word still deserves an answer of some
  // kind, so fall back to the folded text rather than to the empty string.
  return kept.length > 0 ? kept.join(' ') : folded;
}

/**
 * House numbers here are not integers. "12א" is a separate building from 12,
 * and "12/3" is a specific unit in a block — both are printed on the door and
 * both must survive into the address the driver sees.
 */
const HOUSE_NUMBER = /^\d{1,4}(?:[א-ת]|\/\d{1,3})?$/;

export interface ParsedAddressQuery {
  /** Normalised tokens with the house number removed. */
  readonly terms: readonly string[];
  /** As typed, minus surrounding noise. Null when the customer gave no number. */
  readonly houseNumber: string | null;
}

/**
 * Split a query into the part that names a street and the part that names a
 * door. The number may lead or trail — Hebrew is written right to left but
 * typed left to right, and both orders show up in real form submissions.
 */
export function parseAddressQuery(input: string): ParsedAddressQuery {
  const tokens = normaliseAddressQuery(input)
    .split(' ')
    .filter((token) => token.length > 0);

  const index = tokens.findIndex((token) => HOUSE_NUMBER.test(token));
  if (index === -1) return { terms: tokens, houseNumber: null };

  const houseNumber = tokens[index] ?? null;
  return {
    terms: [...tokens.slice(0, index), ...tokens.slice(index + 1)],
    houseNumber,
  };
}

/** The leading integer of a house number — "12א" and "12/3" both position at 12. */
export function houseNumberValue(houseNumber: string): number | null {
  const match = /^\d{1,4}/.exec(houseNumber);
  return match ? Number(match[0]) : null;
}

/**
 * FNV-1a. Used wherever the fake needs a stable pseudo-random value — a detour
 * factor, a postal code — because the same query must give the same answer on
 * every machine and in every run, or the tests assert nothing.
 */
export function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** A hash mapped onto [0, 1). */
export function unitInterval(hash: number): number {
  return (hash >>> 0) / 0x1_0000_0000;
}
