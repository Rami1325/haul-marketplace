import { haversineMeters, type LatLng } from '@haul/types';
import { describe, expect, it } from 'vitest';
import {
  MIN_PLAUSIBLE_CIRCUITY,
  circuityRatio,
  isImplausiblyDirect,
  straightLineMetersNotForPricing,
} from '../distance.js';
import { FakeGeoProvider } from '../providers/fake.js';
import { GeoErrorCode, GeoProviderId, unwrap } from '../result.js';
import { UnroutedDistanceError, distanceForPricing, type RoutedRoute } from '../routing.js';

const provider = () => new FakeGeoProvider();

/** Real pins in the launch cluster and around Gush Dan. */
const DIZENGOFF: LatLng = { lat: 32.0785, lng: 34.7742 };
const FLORENTIN: LatLng = { lat: 32.0568, lng: 34.7706 };
const RAMAT_GAN: LatLng = { lat: 32.084, lng: 34.809 };
const HERZLIYA: LatLng = { lat: 32.1645, lng: 34.843 };
const RISHON: LatLng = { lat: 31.964, lng: 34.804 };

/** Sunday 08:30 and Sunday 23:30, Jerusalem time, in UTC. */
const RUSH_HOUR = new Date('2026-08-09T05:30:00Z');
const LATE_NIGHT = new Date('2026-08-09T20:30:00Z');

async function route(stops: readonly LatLng[], extra: object = {}) {
  return unwrap(await provider().route({ stops: [...stops], ...extra }));
}

describe('routed, not straight-line', () => {
  it('always returns more metres than the crow flies', async () => {
    const pairs: ReadonlyArray<readonly [LatLng, LatLng]> = [
      [DIZENGOFF, FLORENTIN],
      [DIZENGOFF, RAMAT_GAN],
      [RAMAT_GAN, HERZLIYA],
      [DIZENGOFF, RISHON],
    ];

    for (const [from, to] of pairs) {
      const routed = await route([from, to]);
      const straight = haversineMeters(from, to);
      expect(routed.distanceMeters).toBeGreaterThan(straight);
    }
  });

  it('inflates by a factor a real road network would produce', async () => {
    const routed = await route([DIZENGOFF, RAMAT_GAN]);
    const ratio = circuityRatio(routed.distanceMeters, haversineMeters(DIZENGOFF, RAMAT_GAN));
    // Dense urban grid: nowhere near 1, nowhere near 2.
    expect(ratio).toBeGreaterThan(1.15);
    expect(ratio).toBeLessThan(1.7);
  });

  it('never produces a distance the circuity tripwire would flag', async () => {
    // The tripwire exists to catch a haversine number leaking through an
    // adapter. If the fake could trip it, it would train everyone to ignore it.
    for (const to of [FLORENTIN, RAMAT_GAN, HERZLIYA, RISHON]) {
      const routed = await route([DIZENGOFF, to]);
      expect(isImplausiblyDirect(routed.distanceMeters, haversineMeters(DIZENGOFF, to))).toBe(
        false,
      );
    }
  });

  it('flags a straight-line number dressed up as a routed one', async () => {
    const straight = haversineMeters(DIZENGOFF, RAMAT_GAN);
    expect(isImplausiblyDirect(straight, straight)).toBe(true);
    expect(circuityRatio(straight, straight)).toBeLessThan(MIN_PLAUSIBLE_CIRCUITY);
  });

  it('exempts hops too short for a detour to mean anything', async () => {
    const nearby: LatLng = { lat: DIZENGOFF.lat + 0.001, lng: DIZENGOFF.lng };
    const straight = haversineMeters(DIZENGOFF, nearby);
    expect(straight).toBeLessThan(500);
    expect(isImplausiblyDirect(straight, straight)).toBe(false);
  });

  it('leaves long motorway legs straighter than any city leg can be', async () => {
    // Route 2 up the coast: far enough that the model treats the leg as
    // motorway rather than grid. The two bands do not overlap, so this holds
    // for every pair of pins, not just for the ones that happen to be seeded.
    const cityLegs: ReadonlyArray<readonly [LatLng, LatLng]> = [
      [DIZENGOFF, FLORENTIN],
      [DIZENGOFF, RAMAT_GAN],
    ];
    for (const [from, to] of cityLegs) {
      const leg = await route([from, to]);
      expect(circuityRatio(leg.distanceMeters, haversineMeters(from, to))).toBeGreaterThan(1.19);
    }

    const farNorth: LatLng = { lat: 32.794, lng: 34.99 }; // Haifa
    const interurban = await route([DIZENGOFF, farNorth]);
    const straight = haversineMeters(DIZENGOFF, farNorth);
    expect(straight).toBeGreaterThan(30_000);
    expect(circuityRatio(interurban.distanceMeters, straight)).toBeLessThan(1.19);
  });
});

describe('the door into pricing', () => {
  it('hands the pricing engine the routed metres, not the crow’s', async () => {
    const routed = await route([DIZENGOFF, RAMAT_GAN]);
    expect(distanceForPricing(routed)).toBe(routed.distanceMeters);
    expect(distanceForPricing(routed)).not.toBe(
      straightLineMetersNotForPricing(DIZENGOFF, RAMAT_GAN),
    );
  });

  it('refuses an estimated route outright', () => {
    const estimated: RoutedRoute = {
      distanceMeters: 8_400,
      durationSeconds: 1_200,
      legs: [{ distanceMeters: 8_400, durationSeconds: 1_200, polyline: null, isEstimated: true }],
      isEstimated: true,
      providerId: GeoProviderId.Fake,
    };
    expect(() => distanceForPricing(estimated)).toThrow(UnroutedDistanceError);
  });

  it('refuses a route where only one leg was estimated', () => {
    // The dangerous case: the total looks fine, one leg was guessed, and the
    // quote gets locked anyway.
    const partly: RoutedRoute = {
      distanceMeters: 12_000,
      durationSeconds: 1_800,
      legs: [
        { distanceMeters: 8_400, durationSeconds: 1_200, polyline: null, isEstimated: false },
        { distanceMeters: 3_600, durationSeconds: 600, polyline: null, isEstimated: true },
      ],
      isEstimated: false,
      providerId: GeoProviderId.Fake,
    };
    expect(() => distanceForPricing(partly)).toThrow(UnroutedDistanceError);
  });

  it('refuses a total that is not the sum of its legs', async () => {
    // The leak decision 9 is actually written against. Nothing is flagged: the
    // legs are real, `isEstimated` is false everywhere, and only the total —
    // the one number `distanceForPricing` returns — was replaced with the
    // crow's answer somewhere between the router and the quote.
    const routed = await route([DIZENGOFF, RAMAT_GAN]);
    const substituted: RoutedRoute = {
      ...routed,
      distanceMeters: straightLineMetersNotForPricing(DIZENGOFF, RAMAT_GAN),
    };
    expect(substituted.distanceMeters).toBeLessThan(routed.distanceMeters);
    expect(() => distanceForPricing(substituted)).toThrow(UnroutedDistanceError);
  });

  it('never estimates — the fake routes or it fails', async () => {
    const routed = await route([DIZENGOFF, HERZLIYA, RAMAT_GAN]);
    expect(routed.isEstimated).toBe(false);
    // `some`, not `every`: a route where one hop was guessed and the rest were
    // routed is the case the previous test calls dangerous, and it is the case
    // a multi-stop booking hits first. `every` would only prove one leg is
    // honest, which is the assertion a fallback-per-hop change sails through.
    expect(routed.legs.some((leg) => leg.isEstimated)).toBe(false);
    // And the door agrees, on the same route the customer would have booked.
    expect(() => distanceForPricing(routed)).not.toThrow();
  });
});

describe('multi-stop', () => {
  it('returns one leg per hop and a total that is their sum', async () => {
    const routed = await route([DIZENGOFF, RAMAT_GAN, HERZLIYA]);
    expect(routed.legs).toHaveLength(2);
    expect(routed.distanceMeters).toBe(
      routed.legs.reduce((total, leg) => total + leg.distanceMeters, 0),
    );
    expect(routed.durationSeconds).toBe(
      routed.legs.reduce((total, leg) => total + leg.durationSeconds, 0),
    );
  });

  it('costs more to visit a detour than to drive straight past it', async () => {
    // Two dropoffs is not the same job as one, and the price has to know.
    const direct = await route([DIZENGOFF, RISHON]);
    const viaHerzliya = await route([DIZENGOFF, HERZLIYA, RISHON]);
    expect(viaHerzliya.distanceMeters).toBeGreaterThan(direct.distanceMeters);
  });

  it('rejects a route with fewer than two stops', async () => {
    const result = await provider().route({ stops: [DIZENGOFF] });
    expect(result).toMatchObject({ ok: false, code: GeoErrorCode.InvalidRequest });
  });

  it('reports a stop outside the country as out of area, not as a bad request', async () => {
    const result = await provider().route({ stops: [DIZENGOFF, { lat: 48.8584, lng: 2.2945 }] });
    expect(result).toMatchObject({ ok: false, code: GeoErrorCode.OutsideServiceArea });
  });
});

describe('determinism', () => {
  it('routes the same pins to the same metres every time', async () => {
    const first = await route([DIZENGOFF, RAMAT_GAN, HERZLIYA]);
    const second = await route([DIZENGOFF, RAMAT_GAN, HERZLIYA]);
    expect(second).toEqual(first);
  });

  it('is the same across instances, so a test suite and a dev server agree', async () => {
    const a = unwrap(await new FakeGeoProvider().route({ stops: [DIZENGOFF, RISHON] }));
    const b = unwrap(await new FakeGeoProvider().route({ stops: [DIZENGOFF, RISHON] }));
    expect(b.distanceMeters).toBe(a.distanceMeters);
  });

  it('does not assume the return leg is the outbound leg reversed', async () => {
    // Central Tel Aviv is a one-way grid. Code that averages the two directions
    // or caches one as the other should fail here rather than in a payout.
    const out = await route([DIZENGOFF, FLORENTIN]);
    const back = await route([FLORENTIN, DIZENGOFF]);
    expect(back.distanceMeters).not.toBe(out.distanceMeters);
    // Different, but not a different city.
    const spread =
      Math.max(out.distanceMeters, back.distanceMeters) /
      Math.min(out.distanceMeters, back.distanceMeters);
    expect(spread).toBeLessThan(1.3);
  });
});

describe('traffic', () => {
  it('ignores the departure time unless traffic-aware routing was asked for', async () => {
    const rush = await route([DIZENGOFF, RAMAT_GAN], { departAt: RUSH_HOUR });
    const night = await route([DIZENGOFF, RAMAT_GAN], { departAt: LATE_NIGHT });
    expect(night.durationSeconds).toBe(rush.durationSeconds);
  });

  it('takes longer through the Sunday morning rush than late at night', async () => {
    const rush = await route([DIZENGOFF, RAMAT_GAN], { departAt: RUSH_HOUR, trafficAware: true });
    const night = await route([DIZENGOFF, RAMAT_GAN], { departAt: LATE_NIGHT, trafficAware: true });

    expect(rush.durationSeconds).toBeGreaterThan(night.durationSeconds);
    // Traffic changes how long the drive takes, never how far it is.
    expect(rush.distanceMeters).toBe(night.distanceMeters);
  });

  it('drives Gush Dan at a speed a truck could actually manage', async () => {
    const routed = await route([DIZENGOFF, RAMAT_GAN], { departAt: RUSH_HOUR, trafficAware: true });
    const kmh = (routed.distanceMeters / 1000 / routed.durationSeconds) * 3600;
    expect(kmh).toBeGreaterThan(8);
    expect(kmh).toBeLessThan(40);
  });
});

describe('dispatch matrix', () => {
  it('answers every origin against every destination', async () => {
    const drivers = [DIZENGOFF, RAMAT_GAN, HERZLIYA];
    const entries = unwrap(
      await provider().matrix({ origins: drivers, destinations: [FLORENTIN] }),
    );

    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(entry.leg).not.toBeNull();
      const origin = drivers[entry.originIndex];
      if (!origin || !entry.leg) continue;
      expect(entry.leg.distanceMeters).toBeGreaterThan(haversineMeters(origin, FLORENTIN));
    }
  });

  it('agrees with the single-route call for the same pair', async () => {
    const entries = unwrap(
      await provider().matrix({ origins: [DIZENGOFF], destinations: [RAMAT_GAN] }),
    );
    const single = await route([DIZENGOFF, RAMAT_GAN]);
    expect(entries[0]?.leg?.distanceMeters).toBe(single.distanceMeters);
  });

  it('drops an unreachable pair rather than inventing a leg for it', async () => {
    const entries = unwrap(
      await provider().matrix({
        origins: [DIZENGOFF, { lat: 48.8584, lng: 2.2945 }],
        destinations: [RAMAT_GAN],
      }),
    );
    expect(entries[0]?.leg).not.toBeNull();
    expect(entries[1]?.leg).toBeNull();
  });

  it('rejects an empty matrix', async () => {
    const result = await provider().matrix({ origins: [], destinations: [RAMAT_GAN] });
    expect(result).toMatchObject({ ok: false, code: GeoErrorCode.InvalidRequest });
  });
});
