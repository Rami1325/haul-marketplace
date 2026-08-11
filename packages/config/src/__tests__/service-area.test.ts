import type { LatLng } from '@haul/types';
import { describe, expect, it } from 'vitest';
import {
  CITIES,
  ServiceCoverage,
  TEL_AVIV_CITY,
  isInServiceArea,
  serviceAreaFor,
} from '../cities/index.js';

/**
 * ---------------------------------------------------------------------------
 * Service area
 * ---------------------------------------------------------------------------
 * The launch answer is "one neighbourhood cluster inside Gush Dan", and the edge
 * of that cluster is a judgement rather than a line. So the interesting property
 * is not where the boundary sits — it will move — but that crossing it produces
 * a sentence rather than a closed door.
 * ---------------------------------------------------------------------------
 */

const DIZENGOFF_CENTER: LatLng = { lat: 32.0757, lng: 34.7748 };
const FLORENTIN: LatLng = { lat: 32.0561, lng: 34.7683 };
const RAMAT_GAN: LatLng = { lat: 32.0684, lng: 34.8248 };
const HERZLIYA: LatLng = { lat: 32.1624, lng: 34.8443 };
const HAIFA: LatLng = { lat: 32.794, lng: 34.9896 };
const EILAT: LatLng = { lat: 29.5577, lng: 34.9519 };

describe('inside the launch cluster', () => {
  it('says nothing at all', () => {
    for (const point of [DIZENGOFF_CENTER, FLORENTIN, TEL_AVIV_CITY.launchArea.centre]) {
      const check = serviceAreaFor(point, TEL_AVIV_CITY);
      expect(check.coverage).toBe(ServiceCoverage.Core);
      expect(check.noticeHe).toBeNull();
      expect(check.noticeEn).toBeNull();
    }
  });
});

describe('outside the cluster but inside the metro', () => {
  it('still takes the job, with something to say about it', () => {
    for (const point of [RAMAT_GAN, HERZLIYA]) {
      const check = serviceAreaFor(point, TEL_AVIV_CITY);
      expect(check.coverage).toBe(ServiceCoverage.Fringe);
      expect(isInServiceArea(point, TEL_AVIV_CITY)).toBe(true);
      expect(check.noticeHe).not.toBeNull();
      expect(check.noticeEn).not.toBeNull();
    }
  });
});

describe('somewhere we do not work yet', () => {
  it('tells a customer in Haifa, in both languages, and does not refuse them', () => {
    const check = serviceAreaFor(HAIFA, TEL_AVIV_CITY);

    expect(check.coverage).toBe(ServiceCoverage.Outside);
    expect(isInServiceArea(HAIFA, TEL_AVIV_CITY)).toBe(false);
    // The whole design: an answer with a sentence in it, not a thrown error and
    // not a boolean the caller has to invent copy for.
    expect(check.noticeHe).toBeTruthy();
    expect(check.noticeEn).toBeTruthy();
    expect(check.cityId).toBe(TEL_AVIV_CITY.id);
  });

  it('names the area we do serve, taken from the city record rather than the copy', () => {
    // So a second city does not need a second set of hardcoded sentences.
    const check = serviceAreaFor(EILAT, TEL_AVIV_CITY);
    expect(check.noticeHe).toContain(TEL_AVIV_CITY.serviceArea.servedNameHe);
    expect(check.noticeEn).toContain(TEL_AVIV_CITY.serviceArea.servedNameEn);
  });
});

describe('the shape of the answer', () => {
  it('grows the reported distance as the point moves away', () => {
    const distances = [DIZENGOFF_CENTER, RAMAT_GAN, HERZLIYA, HAIFA, EILAT].map(
      (point) => serviceAreaFor(point, TEL_AVIV_CITY).distanceMeters,
    );
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]!).toBeGreaterThan(distances[i - 1]!);
    }
  });

  it('never returns a coverage outside the three the caller can render', () => {
    const known: string[] = Object.values(ServiceCoverage);
    for (const city of CITIES) {
      for (const point of [DIZENGOFF_CENTER, RAMAT_GAN, HAIFA, EILAT]) {
        expect(known).toContain(serviceAreaFor(point, city).coverage);
      }
    }
  });

  it('keeps the core inside the served area for every city', () => {
    // A cluster wider than the area it sits in would make `Fringe` unreachable
    // and the notice dead code.
    for (const city of CITIES) {
      expect(city.serviceArea.servedRadiusMeters).toBeGreaterThan(city.launchArea.radiusMeters);
    }
  });
});
