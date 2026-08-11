import { Locale } from '@haul/types';
import { en } from '@/i18n/messages/en.js';
import { he, type Messages } from '@/i18n/messages/he.js';

export { en, he };
export type { Messages };

/**
 * The catalog for a locale.
 *
 * A `Record<Locale, Messages>` lookup rather than a conditional, so adding a
 * locale to `@haul/types` fails to compile here until a catalog exists for it —
 * instead of silently resolving to Hebrew for the new language.
 */
const CATALOGS: Readonly<Record<Locale, Messages>> = {
  [Locale.He]: he,
  [Locale.En]: en,
};

export function messagesFor(locale: Locale): Messages {
  return CATALOGS[locale];
}
