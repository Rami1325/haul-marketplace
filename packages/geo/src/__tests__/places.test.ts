import { describe, expect, it } from 'vitest';
import { GeocodePrecision, isDispatchable, withAccessDetails } from '../places.js';
import { FakeGeoProvider } from '../providers/fake.js';
import { GeoErrorCode, unwrap } from '../result.js';
import { straightLineMetersNotForPricing } from '../distance.js';

const provider = () => new FakeGeoProvider();

/** Central Tel Aviv — the launch cluster, and the default the app biases toward. */
const TEL_AVIV_CENTRE = { lat: 32.0785, lng: 34.7742 };

async function suggest(query: string, bias?: { lat: number; lng: number }) {
  const result = await provider().autocomplete(
    bias ? { query, bias: { centre: bias, radiusMeters: 5_000 } } : { query },
  );
  return unwrap(result);
}

describe('Hebrew address entry', () => {
  it('finds a street and a house number typed the way an Israeli types them', async () => {
    const suggestions = await suggest('דיזנגוף 50');
    expect(suggestions.length).toBeGreaterThan(0);

    const details = unwrap(await provider().details(suggestions[0]?.placeId ?? ''));
    expect(details.address).not.toBeNull();
    expect(details.address?.street).toBe('דיזנגוף');
    expect(details.address?.houseNumber).toBe('50');
    expect(details.address?.city).toBe('תל אביב-יפו');
    expect(details.address?.countryCode).toBe('IL');
  });

  it('treats the street word and the geresh as noise, not as content', async () => {
    const plain = await suggest('דיזנגוף 50');
    const decorated = await suggest("רח' דיזנגוף 50");
    expect(decorated[0]?.placeId).toBe(plain[0]?.placeId);
  });

  it('accepts the Latin transliteration a phone keyboard produces', async () => {
    const hebrew = await suggest('דיזנגוף 50');
    const latin = await suggest('Dizengoff 50');
    expect(latin[0]?.placeId).toBe(hebrew[0]?.placeId);
  });

  it('accepts a house number written before the street name', async () => {
    const after = await suggest('אלנבי 40');
    const before = await suggest('40 אלנבי');
    expect(before[0]?.placeId).toBe(after[0]?.placeId);
  });

  it('keeps house numbers that are not integers — 12א is a different door from 12', async () => {
    const suffixed = await suggest('אלנבי 12א');
    const plain = await suggest('אלנבי 12');
    expect(suffixed[0]?.placeId).not.toBe(plain[0]?.placeId);

    const details = unwrap(await provider().details(suffixed[0]?.placeId ?? ''));
    expect(details.address?.houseNumber).toBe('12א');
  });

  it('returns nothing rather than everything for a one-character query', async () => {
    expect(await suggest('ד')).toHaveLength(0);
  });
});

describe('determinism', () => {
  it('answers the same query with the same suggestions, in the same order', async () => {
    const first = await suggest('אבן גבירול 30');
    const second = await suggest('אבן גבירול 30');
    expect(second).toEqual(first);
  });

  it('carries no state between instances — a fresh provider answers identically', async () => {
    const a = unwrap(await new FakeGeoProvider().autocomplete({ query: 'רוטשילד 22' }));
    const b = unwrap(await new FakeGeoProvider().autocomplete({ query: 'רוטשילד 22' }));
    expect(b).toEqual(a);
  });

  it('breaks ranking ties in a fixed order, so a list never reshuffles itself', async () => {
    // Three real streets share this name across Gush Dan, so nothing but the
    // tie-break separates them when no bias is given.
    const first = await suggest('זבוטינסקי');
    const second = await suggest("ז'בוטינסקי");
    expect(first.length).toBeGreaterThan(1);
    expect(second.map((s) => s.placeId)).toEqual(first.map((s) => s.placeId));
  });

  it('round-trips every suggestion it offers through details()', async () => {
    for (const suggestion of await suggest('סוקולוב')) {
      const details = unwrap(await provider().details(suggestion.placeId));
      expect(details.placeId).toBe(suggestion.placeId);
      expect(details.precision).toBe(suggestion.precision);
    }
  });
});

describe('ranking', () => {
  it('puts the nearest namesake first when the customer says where they are', async () => {
    const ramatGan = await suggest('זבוטינסקי', { lat: 32.084, lng: 34.809 });
    const petahTikva = await suggest('זבוטינסקי', { lat: 32.088, lng: 34.87 });

    expect(ramatGan[0]?.secondaryText).toBe('רמת גן');
    expect(petahTikva[0]?.secondaryText).toBe('פתח תקווה');
  });

  it('lets a named city outrank proximity', async () => {
    const suggestions = await suggest('סוקולוב הרצליה', TEL_AVIV_CENTRE);
    expect(suggestions[0]?.secondaryText).toBe('הרצליה');
  });

  it('reports the bias distance as straight-line, and only when asked to', async () => {
    const unbiased = await suggest('דיזנגוף 50');
    expect(unbiased[0]?.straightLineMetersFromBias).toBeNull();

    const biased = await suggest('דיזנגוף 50', TEL_AVIV_CENTRE);
    const details = unwrap(await provider().details(biased[0]?.placeId ?? ''));
    expect(biased[0]?.straightLineMetersFromBias).toBe(
      straightLineMetersNotForPricing(TEL_AVIV_CENTRE, details.coordinates),
    );
  });
});

describe('precision', () => {
  it('offers the street, not a building, when no house number was given', async () => {
    const suggestions = await suggest('שינקין');
    expect(suggestions[0]?.precision).toBe(GeocodePrecision.Street);
    expect(isDispatchable(suggestions[0]?.precision ?? GeocodePrecision.Locality)).toBe(false);

    // A street has no door, so there is no address to send a truck to.
    const details = unwrap(await provider().details(suggestions[0]?.placeId ?? ''));
    expect(details.address).toBeNull();
  });

  it('falls back to the street when the house number does not exist on it', async () => {
    // Sheinkin stops well short of 900.
    const suggestions = await suggest('שינקין 900');
    expect(suggestions[0]?.precision).toBe(GeocodePrecision.Street);
  });

  it('marks a chosen building as dispatchable', async () => {
    const suggestions = await suggest('בן יהודה 120');
    expect(suggestions[0]?.precision).toBe(GeocodePrecision.Rooftop);
    expect(isDispatchable(suggestions[0]?.precision ?? GeocodePrecision.Locality)).toBe(true);
  });

  it('gives different house numbers different pins on the same street', async () => {
    const near = await suggest('דיזנגוף 10');
    const far = await suggest('דיזנגוף 300');
    const low = unwrap(await provider().details(near[0]?.placeId ?? ''));
    const high = unwrap(await provider().details(far[0]?.placeId ?? ''));
    expect(straightLineMetersNotForPricing(low.coordinates, high.coordinates)).toBeGreaterThan(
      1_000,
    );
  });
});

describe('the parts no geocoder knows', () => {
  it('never invents an entrance or an apartment', async () => {
    const suggestions = await suggest('אבן גבירול 30');
    const details = unwrap(await provider().details(suggestions[0]?.placeId ?? ''));
    expect(details.address?.entrance).toBeNull();
    expect(details.address?.apartment).toBeNull();
    expect(details.address?.notes).toBeNull();
  });

  it('joins the customer’s half of the address to the geocoder’s half', async () => {
    const suggestions = await suggest('אבן גבירול 30');
    const details = unwrap(await provider().details(suggestions[0]?.placeId ?? ''));
    const address = details.address;
    expect(address).not.toBeNull();
    if (!address) return;

    const complete = withAccessDetails(address, {
      entrance: 'ב',
      apartment: '5',
      notes: 'קוד שער 1234',
    });
    expect(complete.entrance).toBe('ב');
    expect(complete.apartment).toBe('5');
    expect(complete.notes).toBe('קוד שער 1234');
    // The geocoded half is untouched.
    expect(complete.coordinates).toEqual(address.coordinates);
    expect(complete.houseNumber).toBe(address.houseNumber);
  });
});

describe('reverse geocoding', () => {
  it('turns a dropped pin into an interpolated address on the nearest street', async () => {
    const details = unwrap(await provider().reverseGeocode({ lat: 32.1645, lng: 34.843 }));
    expect(details.precision).toBe(GeocodePrecision.Interpolated);
    expect(details.address?.city).toBe('הרצליה');
    expect(details.address?.street).toBe('סוקולוב');
  });

  it('admits it does not know, rather than snapping a pin from far away', async () => {
    // Well out to sea off Tel Aviv — inside Israel's bounding box, nowhere near
    // a seeded street.
    const result = await provider().reverseGeocode({ lat: 32.08, lng: 34.6 });
    expect(result).toMatchObject({ ok: false, code: GeoErrorCode.NotFound });
  });

  it('rejects a pin outside Israel as out of area rather than as not found', async () => {
    const result = await provider().reverseGeocode({ lat: 48.8584, lng: 2.2945 });
    expect(result).toMatchObject({ ok: false, code: GeoErrorCode.OutsideServiceArea });
  });
});

describe('errors', () => {
  it('separates a place id we never issued from one that has no building', async () => {
    const malformed = await provider().details('ChIJnotours');
    expect(malformed).toMatchObject({ ok: false, code: GeoErrorCode.InvalidRequest });

    const unknownStreet = await provider().details('fake:addr:no-such-street:5');
    expect(unknownStreet).toMatchObject({ ok: false, code: GeoErrorCode.NotFound });
  });

  it('can be told to fail, so the booking flow’s error path is developable', async () => {
    const failing = new FakeGeoProvider({ failWith: GeoErrorCode.ProviderUnavailable });
    const result = await failing.autocomplete({ query: 'דיזנגוף 50' });
    expect(result).toMatchObject({ ok: false, code: GeoErrorCode.ProviderUnavailable });
  });
});

describe('language', () => {
  it('answers in English when asked, without changing which place it found', async () => {
    const hebrew = unwrap(await provider().autocomplete({ query: 'דיזנגוף 50', language: 'he' }));
    const english = unwrap(await provider().autocomplete({ query: 'דיזנגוף 50', language: 'en' }));

    expect(english[0]?.secondaryText).toBe('Tel Aviv-Yafo');
    const details = unwrap(await provider().details(english[0]?.placeId ?? '', { language: 'en' }));
    expect(details.address?.street).toBe('Dizengoff');
    // Same building, whichever language it was described in.
    expect(details.coordinates).toEqual(
      unwrap(await provider().details(hebrew[0]?.placeId ?? '')).coordinates,
    );
  });
});
