import { describe, expect, it } from 'vitest';
import {
  GOOGLE_ENDPOINTS,
  GOOGLE_FIELD_MASKS,
  GoogleGeoProvider,
  OPEN_QUESTIONS,
  isNoRouteResponse,
  israeliAddressFromComponents,
  mapGoogleHttpStatus,
  mapGoogleStatus,
  parseGoogleDuration,
} from '../providers/google.js';
import { GeoErrorCode, isRetryable } from '../result.js';

const config = { apiKey: 'test-key', regionCode: 'IL', languageCode: 'he' } as const;

describe('error mapping', () => {
  it('routes each Google status to an action the booking flow can take', () => {
    expect(mapGoogleStatus('INVALID_ARGUMENT')).toBe(GeoErrorCode.InvalidRequest);
    expect(mapGoogleStatus('NOT_FOUND')).toBe(GeoErrorCode.NotFound);
    expect(mapGoogleStatus('PERMISSION_DENIED')).toBe(GeoErrorCode.Unauthenticated);
    expect(mapGoogleStatus('UNAUTHENTICATED')).toBe(GeoErrorCode.Unauthenticated);
    expect(mapGoogleStatus('RESOURCE_EXHAUSTED')).toBe(GeoErrorCode.QuotaExceeded);
    expect(mapGoogleStatus('UNAVAILABLE')).toBe(GeoErrorCode.ProviderUnavailable);
    expect(mapGoogleStatus('DEADLINE_EXCEEDED')).toBe(GeoErrorCode.ProviderUnavailable);
  });

  it('does not pretend to recognise a status it has never seen', () => {
    expect(mapGoogleStatus('SOMETHING_NEW')).toBe(GeoErrorCode.Unknown);
    expect(mapGoogleStatus('')).toBe(GeoErrorCode.Unknown);
  });

  it('falls back to the HTTP status when the body is not Google’s', () => {
    // A proxy or an edge cache in front of Google returns HTML, not an error object.
    expect(mapGoogleHttpStatus(403)).toBe(GeoErrorCode.Unauthenticated);
    expect(mapGoogleHttpStatus(429)).toBe(GeoErrorCode.QuotaExceeded);
    expect(mapGoogleHttpStatus(502)).toBe(GeoErrorCode.ProviderUnavailable);
    expect(mapGoogleHttpStatus(418)).toBe(GeoErrorCode.Unknown);
  });

  it('marks the transient failures as retryable and the permanent ones as not', () => {
    // The distinction the retry policy is built on: a bad key is not going to
    // fix itself, and hammering a quota error makes it worse.
    expect(isRetryable(mapGoogleStatus('UNAVAILABLE'))).toBe(true);
    expect(isRetryable(mapGoogleStatus('RESOURCE_EXHAUSTED'))).toBe(true);
    expect(isRetryable(mapGoogleStatus('PERMISSION_DENIED'))).toBe(false);
    expect(isRetryable(mapGoogleStatus('INVALID_ARGUMENT'))).toBe(false);
    expect(isRetryable(mapGoogleStatus('NOT_FOUND'))).toBe(false);
  });

  it('reads an empty routes array as "no road", not as a transport failure', () => {
    expect(isNoRouteResponse([])).toBe(true);
    expect(isNoRouteResponse([{ distanceMeters: 8_400 }])).toBe(false);
  });
});

describe('duration parsing', () => {
  it('reads the protobuf duration format', () => {
    expect(parseGoogleDuration('1234s')).toBe(1_234);
    expect(parseGoogleDuration('0s')).toBe(0);
    expect(parseGoogleDuration(' 90.5s ')).toBe(91);
  });

  it('takes the fractional seconds the reference says to expect', () => {
    // The Routes reference states the format outright — "a duration in seconds
    // with up to nine fractional digits, ending with 's'. Example: 3.5s" — so
    // it is not an open question, and leaving it on the list invites the next
    // reader to "fix" this parser into rejecting the fractions Google sends.
    expect(OPEN_QUESTIONS.some((question) => /duration/i.test(question))).toBe(false);
    expect(parseGoogleDuration('3.5s')).toBe(4);
    expect(parseGoogleDuration('1234.123456789s')).toBe(1_234);
  });

  it('returns null rather than a plausible-looking zero', () => {
    // A duration parsed as 0 prices a job for no driving at all, which is
    // exactly the failure that survives review.
    expect(parseGoogleDuration('1234')).toBeNull();
    expect(parseGoogleDuration('PT20M')).toBeNull();
    expect(parseGoogleDuration('')).toBeNull();
    expect(parseGoogleDuration('-5s')).toBeNull();
  });
});

describe('address components', () => {
  const components = [
    { longText: '50', types: ['street_number'] },
    { longText: 'דיזנגוף', shortText: 'דיזנגוף', types: ['route'] },
    { longText: 'תל אביב-יפו', types: ['locality', 'political'] },
    { longText: '6433222', types: ['postal_code'] },
    { longText: 'ישראל', shortText: 'IL', types: ['country', 'political'] },
  ];

  it('builds an Israeli address from the standard component types', () => {
    const address = israeliAddressFromComponents({
      placeId: 'ChIJexample',
      formattedAddress: 'דיזנגוף 50, תל אביב-יפו',
      location: { lat: 32.0785, lng: 34.7742 },
      addressComponents: components,
    });

    expect(address).not.toBeNull();
    expect(address?.street).toBe('דיזנגוף');
    expect(address?.houseNumber).toBe('50');
    expect(address?.city).toBe('תל אביב-יפו');
    expect(address?.postalCode).toBe('6433222');
    expect(address?.placeId).toBe('ChIJexample');
  });

  it('never claims to know the entrance or the apartment', () => {
    const address = israeliAddressFromComponents({
      placeId: 'ChIJexample',
      formattedAddress: 'דיזנגוף 50, תל אביב-יפו',
      location: { lat: 32.0785, lng: 34.7742 },
      addressComponents: [...components, { longText: 'ב', types: ['subpremise'] }],
    });
    // Even when a subpremise turns up, it is not treated as a כניסה — see
    // OPEN_QUESTIONS. The booking form is the only source for that field.
    expect(address?.entrance).toBeNull();
    expect(address?.apartment).toBeNull();
  });

  it('returns null when there is no building to send a truck to', () => {
    const streetOnly = israeliAddressFromComponents({
      placeId: 'ChIJstreet',
      formattedAddress: 'דיזנגוף, תל אביב-יפו',
      location: { lat: 32.08, lng: 34.774 },
      addressComponents: components.filter((c) => !c.types.includes('street_number')),
    });
    expect(streetOnly).toBeNull();
  });

  it('refuses a place in another country instead of stamping it IL', () => {
    // `regionCode: 'IL'` biases the search, it does not restrict it — that is
    // `includedRegionCodes`. So a Latin street name Israel shares with half of
    // Europe can surface a Paris place, and `AddressSchema.countryCode` is a
    // literal with a default, so nothing downstream can tell the two apart.
    const paris = israeliAddressFromComponents({
      placeId: 'ChIJparis',
      formattedAddress: '12 Rue Balfour, 75008 Paris, France',
      location: { lat: 48.8738, lng: 2.295 },
      addressComponents: [
        { longText: '12', types: ['street_number'] },
        { longText: 'Rue Balfour', types: ['route'] },
        { longText: 'Paris', types: ['locality', 'political'] },
        { longText: '75008', types: ['postal_code'] },
        { longText: 'France', shortText: 'FR', types: ['country', 'political'] },
      ],
    });
    expect(paris).toBeNull();
  });

  it('refuses a pin outside the country even when the components say IL', () => {
    // The two guards are independent because the two ways to get here are
    // different bugs: a wrong place, and a right place with a wrong pin.
    const displaced = israeliAddressFromComponents({
      placeId: 'ChIJexample',
      formattedAddress: 'דיזנגוף 50, תל אביב-יפו',
      location: { lat: 48.8738, lng: 2.295 },
      addressComponents: components,
    });
    expect(displaced).toBeNull();
  });

  it('refuses a payload with no country component at all', () => {
    // Silence is not agreement. An unasked-for field mask, a partial response,
    // a provider change — all arrive here as a missing component, and the safe
    // reading is "ask the customer again", not "assume Israel".
    const countryless = israeliAddressFromComponents({
      placeId: 'ChIJexample',
      formattedAddress: 'דיזנגוף 50, תל אביב-יפו',
      location: { lat: 32.0785, lng: 34.7742 },
      addressComponents: components.filter((c) => !c.types.includes('country')),
    });
    expect(countryless).toBeNull();
  });

  it('drops a postal code it cannot vouch for rather than failing the geocode', () => {
    const address = israeliAddressFromComponents({
      placeId: 'ChIJexample',
      formattedAddress: 'דיזנגוף 50, תל אביב-יפו',
      location: { lat: 32.0785, lng: 34.7742 },
      addressComponents: components.map((c) =>
        c.types.includes('postal_code') ? { longText: '64332-22', types: c.types } : c,
      ),
    });
    expect(address).not.toBeNull();
    expect(address?.postalCode).toBeNull();
  });
});

describe('the skeleton', () => {
  it('refuses to pretend it works', async () => {
    const google = new GoogleGeoProvider(config);
    await expect(google.autocomplete({ query: 'דיזנגוף 50' })).rejects.toThrow(/not implemented/i);
    await expect(google.route({ stops: [] })).rejects.toThrow(/not implemented/i);
  });

  it('carries the verified endpoints and the unanswered questions together', () => {
    expect(GOOGLE_ENDPOINTS.autocomplete).toContain('places.googleapis.com');
    expect(GOOGLE_ENDPOINTS.computeRoutes).toContain('routes.googleapis.com');
    // A field mask is the billing decision; an empty one would be a blank cheque.
    expect(GOOGLE_FIELD_MASKS.autocomplete.length).toBeGreaterThan(0);
    expect(OPEN_QUESTIONS.length).toBeGreaterThan(0);
  });

  it('states the waypoint limit the Routes API actually documents', () => {
    expect(new GoogleGeoProvider(config).maxIntermediateStops).toBe(25);
  });
});

describe('the autocomplete field mask', () => {
  it('asks for every field a suggestion is actually built from', () => {
    // `AddressSuggestion.precision` is non-nullable and
    // `straightLineMetersFromBias` has to come from somewhere. Neither survives
    // placeId + text + structuredFormat, and a mask that stops there is not a
    // minimum, it is a gap an implementer closes by hardcoding — `Rooftop` and
    // a street centroid passes `isDispatchable()` and sends a truck to the
    // middle of דיזנגוף.
    expect(GOOGLE_FIELD_MASKS.autocomplete).toContain('suggestions.placePrediction.types');
    expect(GOOGLE_FIELD_MASKS.autocomplete).toContain('suggestions.placePrediction.distanceMeters');
  });

  it('carries no whitespace, which Google rejects outright', () => {
    for (const mask of Object.values(GOOGLE_FIELD_MASKS)) {
      expect(mask).not.toMatch(/\s/);
    }
  });

  it('names the precision gap instead of letting someone hardcode past it', () => {
    // Places (New) has no `location_type`; rooftop-versus-interpolated is a
    // Geocoding API concept. `types` separates a building from a street and no
    // further, so the remaining half of the mapping stays an open question
    // rather than a plausible guess.
    expect(OPEN_QUESTIONS.some((question) => /precision/i.test(question))).toBe(true);
  });
});
