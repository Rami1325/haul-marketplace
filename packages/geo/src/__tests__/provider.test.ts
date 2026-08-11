import { describe, expect, it } from 'vitest';
import { GeoConfigurationError, createGeoProvider } from '../provider.js';
import { GeoProviderId } from '../result.js';
import { FakeGeoProvider } from '../providers/fake.js';
import { GoogleGeoProvider } from '../providers/google.js';

describe('createGeoProvider', () => {
  it('gives a fresh checkout a working provider with no configuration at all', () => {
    const provider = createGeoProvider({});
    expect(provider).toBeInstanceOf(FakeGeoProvider);
    expect(provider.id).toBe(GeoProviderId.Fake);
  });

  it('honours an explicit choice of fake', () => {
    expect(createGeoProvider({ GEO_PROVIDER: 'fake' })).toBeInstanceOf(FakeGeoProvider);
    // Operators paste values with stray case and whitespace.
    expect(createGeoProvider({ GEO_PROVIDER: '  FAKE ' })).toBeInstanceOf(FakeGeoProvider);
  });

  it('builds the Google adapter when a key is present', () => {
    const provider = createGeoProvider({
      GEO_PROVIDER: 'google',
      GOOGLE_MAPS_API_KEY: 'test-key',
    });
    expect(provider).toBeInstanceOf(GoogleGeoProvider);
    expect(provider.id).toBe(GeoProviderId.Google);
  });

  it('refuses to start Google without a key instead of failing on first keystroke', () => {
    expect(() => createGeoProvider({ GEO_PROVIDER: 'google' })).toThrow(GeoConfigurationError);
    expect(() => createGeoProvider({ GEO_PROVIDER: 'google', GOOGLE_MAPS_API_KEY: '  ' })).toThrow(
      GeoConfigurationError,
    );
  });

  it('rejects a provider name it does not implement', () => {
    // A typo that silently fell back to the fake would quote real customers off
    // seeded streets.
    expect(() => createGeoProvider({ GEO_PROVIDER: 'mapbox' })).toThrow(GeoConfigurationError);
  });

  it('will not default to the fake in production', () => {
    expect(() => createGeoProvider({ NODE_ENV: 'production' })).toThrow(GeoConfigurationError);
    // Explicit is still allowed — a staging box may genuinely want it.
    expect(createGeoProvider({ NODE_ENV: 'production', GEO_PROVIDER: 'fake' })).toBeInstanceOf(
      FakeGeoProvider,
    );
  });

  it('passes options through, so a test can pin the fake’s clock', () => {
    const clock = () => new Date('2026-08-09T05:30:00Z');
    const provider = createGeoProvider({}, { fake: { now: clock } });
    expect(provider).toBeInstanceOf(FakeGeoProvider);
  });
});
