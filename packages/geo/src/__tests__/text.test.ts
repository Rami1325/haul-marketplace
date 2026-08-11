import { describe, expect, it } from 'vitest';
import {
  hash32,
  houseNumberValue,
  normaliseAddressQuery,
  parseAddressQuery,
  unitInterval,
} from '../text.js';

describe('normalising what Israelis type', () => {
  it('collapses the ways of writing the same street to one key', () => {
    const forms = ['רחוב דיזנגוף', "רח' דיזנגוף", 'דיזנגוף', '  דיזנגוף  ', 'רח״ דיזנגוף'];
    const keys = new Set(forms.map(normaliseAddressQuery));
    expect(keys.size).toBe(1);
  });

  it('folds the boulevard word the same way, so שדרות רוטשילד finds רוטשילד', () => {
    expect(normaliseAddressQuery('שדרות רוטשילד')).toBe(normaliseAddressQuery('רוטשילד'));
    expect(normaliseAddressQuery("שד' רוטשילד")).toBe(normaliseAddressQuery('רוטשילד'));
  });

  it('lower-cases the Latin half and leaves the Hebrew alone', () => {
    expect(normaliseAddressQuery('Dizengoff Street')).toBe('dizengoff');
    expect(normaliseAddressQuery('דיזנגוף')).toBe('דיזנגוף');
  });

  it('still returns something when the query was nothing but a street word', () => {
    // Better a useless key than an empty one that matches every street.
    expect(normaliseAddressQuery('רחוב')).toBe('רחוב');
  });
});

describe('splitting the street from the door', () => {
  it('finds the house number whichever side of the name it was typed', () => {
    expect(parseAddressQuery('דיזנגוף 50')).toEqual({ terms: ['דיזנגוף'], houseNumber: '50' });
    expect(parseAddressQuery('50 דיזנגוף')).toEqual({ terms: ['דיזנגוף'], houseNumber: '50' });
  });

  it('keeps the forms a door plate actually carries', () => {
    expect(parseAddressQuery('אלנבי 12א').houseNumber).toBe('12א');
    expect(parseAddressQuery('אלנבי 12/3').houseNumber).toBe('12/3');
  });

  it('reports no number rather than guessing one', () => {
    expect(parseAddressQuery('אבן גבירול').houseNumber).toBeNull();
  });

  it('keeps the city as a term so it can disambiguate namesakes', () => {
    expect(parseAddressQuery('סוקולוב 10 הרצליה').terms).toEqual(['סוקולוב', 'הרצליה']);
  });

  it('positions a lettered or slashed number by its leading integer', () => {
    expect(houseNumberValue('12א')).toBe(12);
    expect(houseNumberValue('12/3')).toBe(12);
    expect(houseNumberValue('ג')).toBeNull();
  });
});

describe('the hash the fake is built on', () => {
  it('is stable — the whole test suite depends on it', () => {
    expect(hash32('דיזנגוף 50')).toBe(hash32('דיזנגוף 50'));
    expect(hash32('a')).not.toBe(hash32('b'));
  });

  it('spreads across the unit interval without leaving it', () => {
    const values = ['a', 'b', 'c', 'דיזנגוף', '32.0785,34.7742'].map((s) =>
      unitInterval(hash32(s)),
    );
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(new Set(values).size).toBe(values.length);
  });
});
