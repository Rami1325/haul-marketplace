import { SUPPORTED_LOCALES } from '@haul/types';
import { describe, expect, it } from 'vitest';
import { en, he, messagesFor } from '@/i18n/messages/index.js';
import { DEFAULT_LOCALE, isSupportedLocale, localeFromAcceptLanguage } from '@/i18n/locales.js';

/**
 * ---------------------------------------------------------------------------
 * The catalogs, and the negotiation in front of them
 * ---------------------------------------------------------------------------
 * `Messages = typeof he` already makes key parity a compile error in both
 * directions — a missing key fails the `satisfies`, and an extra one fails its
 * excess-property check. This suite exists because that guarantee is invisible
 * once the catalogs stop being object literals: a spread, a helper, a `Partial`
 * anywhere in the chain and the structural check goes quiet while the type still
 * says `Messages`. The key sets are therefore compared as data.
 *
 * The one thing a type cannot state at all is that a *value* was translated. An
 * English catalog is only useful if it is not the Hebrew one with a new name.
 * ---------------------------------------------------------------------------
 */

/**
 * Both catalogs as plain records. `Messages` is a type alias over an object
 * literal, so TypeScript gives it an implicit index signature and this is a
 * widening rather than a cast.
 */
const HE: Record<string, string> = he;
const EN: Record<string, string> = en;

const keysOf = (catalog: Record<string, string>): string[] => Object.keys(catalog).sort();

/** The Hebrew block. A `he` value with none of it is an English string. */
const HEBREW_LETTER = /[֐-׿]/;

describe('he and en describe the same catalog', () => {
  it('have identical key sets', () => {
    expect(keysOf(EN)).toEqual(keysOf(HE));
  });

  it('carry a non-empty string under every key', () => {
    for (const catalog of [HE, EN]) {
      for (const [key, value] of Object.entries(catalog)) {
        expect(typeof value, key).toBe('string');
        expect(value.trim().length, key).toBeGreaterThan(0);
      }
    }
  });

  it('are actually translated, rather than copying Hebrew into en', () => {
    expect(keysOf(HE).filter((key) => HE[key] === EN[key])).toEqual([]);
  });

  it('keeps the Hebrew catalog Hebrew', () => {
    // A catalog that has quietly become English is the failure mode of a
    // Hebrew-first product built by people who read English.
    for (const [key, value] of Object.entries(HE)) {
      expect(HEBREW_LETTER.test(value), `${key} has no Hebrew in it`).toBe(true);
    }
  });

  it('resolves a catalog for every locale the product claims to support', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(keysOf(messagesFor(locale))).toEqual(keysOf(HE));
    }
  });
});

describe('locale negotiation', () => {
  it('accepts what the product supports and nothing else', () => {
    expect(isSupportedLocale('he')).toBe(true);
    expect(isSupportedLocale('en')).toBe(true);
    expect(isSupportedLocale('ru')).toBe(false);
    expect(isSupportedLocale('HE')).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
    expect(isSupportedLocale('')).toBe(false);
  });

  it('reads Accept-Language by quality, not by order', () => {
    // The header a browser configured English-first with Hebrew available sends,
    // and the one configured the other way round. Both name both languages, so
    // position alone answers this wrongly half the time.
    expect(localeFromAcceptLanguage('he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7')).toBe('he');
    expect(localeFromAcceptLanguage('en-GB,en;q=0.9,he;q=0.8')).toBe('en');
    expect(localeFromAcceptLanguage('en;q=0.4,he;q=0.9')).toBe('he');
  });

  it('drops the region, because he-IL and he are the same product', () => {
    expect(localeFromAcceptLanguage('he-IL')).toBe('he');
    expect(localeFromAcceptLanguage('en-AU')).toBe('en');
  });

  it('treats q=0 as a refusal rather than a low preference', () => {
    expect(localeFromAcceptLanguage('he;q=0,en;q=0.5')).toBe('en');
  });

  it('returns null rather than guessing', () => {
    // A header naming only Russian gets `DEFAULT_LOCALE` from the caller, which
    // is a decision the product has made. Returning English here would be a
    // guess wearing a negotiation's clothes.
    expect(localeFromAcceptLanguage('ru-RU,ru;q=0.9')).toBeNull();
    expect(localeFromAcceptLanguage('*')).toBeNull();
    expect(localeFromAcceptLanguage('')).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });

  it('defaults to Hebrew', () => {
    expect(DEFAULT_LOCALE).toBe('he');
  });
});
