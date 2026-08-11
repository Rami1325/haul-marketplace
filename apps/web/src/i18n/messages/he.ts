/**
 * ---------------------------------------------------------------------------
 * Hebrew — the authoritative catalog
 * ---------------------------------------------------------------------------
 * `Messages` is `typeof he`, so this file *is* the shape. An English catalog
 * missing a key fails to compile, and an English catalog carrying a key Hebrew
 * does not have fails too — `satisfies` performs excess-property checking, so
 * parity is bidirectional and neither direction needs a test to notice.
 *
 * That ordering is the point. A catalog whose type comes from English makes
 * Hebrew the thing that lags, and a Hebrew-first product where Hebrew lags is a
 * product that reads as translated. Israeli users can tell in one screen.
 *
 * **Deliberately tiny, and it should stay that way.** Everything a customer
 * reads about their move — 169 catalog items, 6 vehicle classes, 7 presets, the
 * cancellation vocabulary, the crane reason string — is already bilingual coming
 * out of `@haul/config` and `@haul/types`, carried as `labelHe`/`labelEn` next to
 * the data it describes. Copying any of it here would create a second Hebrew for
 * the same object, and the two would diverge on the day a preset is renamed.
 * This file is chrome: the words that belong to the shell rather than to the
 * domain.
 *
 * No `as const`. Literal types would make `Messages` a set of exact strings, and
 * the English catalog would then fail for the crime of saying something else.
 * ---------------------------------------------------------------------------
 */
export const he = {
  /** `<title>`. The product's own line, not a description of the page. */
  documentTitle: 'HAUL — משאית וזוג ידיים, במחיר שלא זז',
  documentDescription:
    'הובלות לפי מחיר נעול. אתם מרכיבים רשימה, מקבלים מחיר אחד — וזה המחיר שתשלמו.',

  tagline: 'משאית וזוג ידיים, לפי דרישה — במחיר שלא זז.',

  /** Above the sample figure, so nobody mistakes the scaffold for a real quote. */
  exampleQuoteCaption: 'הצעת מחיר לדוגמה',
  priceLockLabel: 'מחיר נעול',
  priceLockNote: 'המחיר כולל מע"מ. רק ארבעה דברים יכולים לשנות אותו, וכולם מוצגים מראש.',

  startBooking: 'קבלת מחיר',
};

/**
 * The contract every other catalog is measured against. Structural on purpose:
 * there is no registry of keys to keep in step with, because the Hebrew file is
 * the registry.
 */
export type Messages = typeof he;
