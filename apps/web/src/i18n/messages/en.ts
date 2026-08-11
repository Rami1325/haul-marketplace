import type { Messages } from '@/i18n/messages/he.js';

/**
 * English — the fallback, checked against Hebrew.
 *
 * `satisfies Messages` rather than `: Messages`. The annotation would widen this
 * object to the interface and hide anything extra; `satisfies` keeps the object's
 * own type and still reports a key Hebrew does not have, which is the half of
 * parity an annotation cannot catch.
 */
export const en = {
  documentTitle: 'HAUL — a truck and a pair of hands, at a price that does not move',
  documentDescription:
    'Moves at a locked price. Build a list, get one number — and that is the number you pay.',

  tagline: 'A truck and a pair of hands, on demand — at a price that does not move.',

  exampleQuoteCaption: 'Example quote',
  priceLockLabel: 'Locked price',
  priceLockNote:
    'VAT included. Only four things can change this, and all four are disclosed first.',

  startBooking: 'Get a price',
} satisfies Messages;
