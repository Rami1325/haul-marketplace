import { DEFAULT_LOCALE, LocaleSchema, SUPPORTED_LOCALES, type Locale } from '@haul/types';

/**
 * ---------------------------------------------------------------------------
 * Locale — negotiated, never guessed
 * ---------------------------------------------------------------------------
 * There is no i18n library in this app and that is a decision, not an omission.
 * The data is already bilingual coming out of the packages — `labelHe`/`labelEn`
 * on every catalog item, `nameHe`/`nameEn` on every vehicle, a Hebrew reason
 * string on a crane recommendation — and `@haul/ui` already owns direction.
 * What is genuinely missing is a URL segment and a catalog of chrome, which is
 * this directory. Bolting a routing library on top of a framework this new buys
 * a message-extraction pipeline nobody asked for and a second opinion about
 * which locale is active.
 *
 * The three constants are re-exported rather than restated. `he` is the default
 * and `he` reads right-to-left in exactly one place in this repo, next to the
 * schema that validates a locale in the first place; a second copy here is the
 * second thing to get wrong on the day Russian or Arabic is added.
 * ---------------------------------------------------------------------------
 */

export { DEFAULT_LOCALE, SUPPORTED_LOCALES };
export type { Locale };

/**
 * The cookie a customer's explicit choice is remembered in.
 *
 * Read by the proxy on every navigation, so it is deliberately not prefixed
 * `__Host-`: that prefix forbids a `Domain` attribute and demands `Secure`,
 * which is right for a session and wrong for a preference that has to survive
 * `http://localhost:3000`.
 */
export const LOCALE_COOKIE = 'haul_locale';

/**
 * Whether a piece of text — a URL segment, a cookie, an `Accept-Language` tag —
 * is a locale this product serves.
 *
 * Parsed with the schema rather than compared against the array, because the
 * array is `readonly Locale[]` and asking it whether it `includes` a `string`
 * requires a cast that would go on compiling after the union changes. The guard
 * that decides what a `Locale` is should be the one that defines it.
 */
export function isSupportedLocale(value: string | undefined | null): value is Locale {
  return value !== undefined && value !== null && LocaleSchema.safeParse(value).success;
}

/**
 * The best supported locale named by an `Accept-Language` header, or null.
 *
 * Quality values are honoured because they are the only thing that distinguishes
 * a browser configured for Hebrew with English as a fallback from one configured
 * the other way round, and both send both tags. Region is dropped: `he-IL` and
 * `he` are the same product, and `en-GB` is not a locale we would refuse an
 * English speaker over.
 *
 * A header naming only unsupported languages returns null rather than English.
 * Falling back to English for a Russian speaker in Tel Aviv would be a guess
 * dressed as a negotiation; the default locale is a decision the product has
 * already made.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;

  const ranked = header
    .split(',')
    .map((range) => {
      const [tag = '', ...parameters] = range.trim().split(';');
      const q = parameters.find((parameter) => parameter.trim().startsWith('q='));
      const quality = q === undefined ? 1 : Number.parseFloat(q.trim().slice(2));
      return {
        language: tag.trim().toLowerCase().split('-')[0] ?? '',
        quality: Number.isFinite(quality) ? quality : 0,
      };
    })
    // `q=0` is the explicit form of "not this one", so it is a filter and not a
    // low-ranked preference.
    .filter((entry) => entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const { language } of ranked) {
    if (isSupportedLocale(language)) return language;
  }
  return null;
}
