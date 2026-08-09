import { ElevatorKind, ParkingSituation, summariseManifest } from '@haul/types';
import { describe, expect, it } from 'vitest';
import { crewFactorFor, estimateWorkingMinutes, recommendCrewSize } from '../working-minutes.js';
import { TEST_CATALOG, TEST_RATE_CARD, access, manifest } from './fixtures.js';

const card = TEST_RATE_CARD;

function totalsFor(lines: Array<[string, number]>) {
  return summariseManifest(manifest(lines), TEST_CATALOG);
}

function estimate(
  lines: Array<[string, number]>,
  stops: Parameters<typeof estimateWorkingMinutes>[0]['stops'],
  crewSize = 2,
) {
  return estimateWorkingMinutes({ totals: totalsFor(lines), stops, crewSize }, card);
}

const groundFloorBothEnds = [
  { access: access(), volumeM3: 3 },
  { access: access(), volumeM3: 3 },
];

describe('crew scaling is sublinear', () => {
  it('treats two movers as the baseline the catalog is calibrated to', () => {
    expect(crewFactorFor(2, 0.8)).toBe(1);
  });

  it('does not pretend a third mover is a third faster', () => {
    // Linear would be 0.667. People queue on a staircase.
    const three = crewFactorFor(3, 0.8);
    expect(three).toBeGreaterThan(0.667);
    expect(three).toBeLessThan(0.8);
  });

  it('makes one mover much slower than two', () => {
    expect(crewFactorFor(1, 0.8)).toBeGreaterThan(1.6);
  });

  it('keeps adding movers monotonically faster', () => {
    let previous = Infinity;
    for (const crew of [1, 2, 3, 4, 5]) {
      const factor = crewFactorFor(crew, 0.8);
      expect(factor).toBeLessThan(previous);
      previous = factor;
    }
  });
});

describe('the estimate responds to the things that actually cost time', () => {
  it('grows with the size of the load', () => {
    let previous = 0;
    for (const boxes of [5, 20, 60]) {
      const result = estimate([['box_medium', boxes]], groundFloorBothEnds);
      expect(result.total).toBeGreaterThan(previous);
      previous = result.total;
    }
  });

  it('charges real time for stairs', () => {
    const flat = estimate(
      [['box_medium', 30]],
      [
        { access: access(), volumeM3: 3 },
        { access: access(), volumeM3: 3 },
      ],
    );
    const fourth = estimate(
      [['box_medium', 30]],
      [
        { access: access({ floor: 4, stairFlights: 4 }), volumeM3: 3 },
        { access: access(), volumeM3: 3 },
      ],
    );
    expect(fourth.total).toBeGreaterThan(flat.total);
    expect(fourth.stairs).toBeGreaterThan(0);
  });

  it('treats a lift as faster than stairs but not free', () => {
    const stairs = estimate(
      [['box_medium', 30]],
      [
        { access: access({ floor: 4, stairFlights: 4 }), volumeM3: 3 },
        { access: access(), volumeM3: 3 },
      ],
    );
    const lift = estimate(
      [['box_medium', 30]],
      [
        {
          access: access({ floor: 4, stairFlights: 4, elevator: ElevatorKind.Standard }),
          volumeM3: 3,
        },
        { access: access(), volumeM3: 3 },
      ],
    );
    expect(lift.total).toBeLessThan(stairs.total);
    expect(lift.stairs).toBe(0);
    expect(lift.elevator).toBeGreaterThan(0);
  });

  it('sees a small lift as no lift at all for furniture', () => {
    const small = estimate(
      [['sofa_3_seat', 1]],
      [
        {
          access: access({ floor: 3, stairFlights: 3, elevator: ElevatorKind.Small }),
          volumeM3: 1.8,
        },
        { access: access(), volumeM3: 1.8 },
      ],
    );
    const none = estimate(
      [['sofa_3_seat', 1]],
      [
        {
          access: access({ floor: 3, stairFlights: 3, elevator: ElevatorKind.None }),
          volumeM3: 1.8,
        },
        { access: access(), volumeM3: 1.8 },
      ],
    );
    expect(small.total).toBe(none.total);
  });

  it('costs time for contested parking', () => {
    const easy = estimate([['box_medium', 20]], groundFloorBothEnds);
    const hard = estimate(
      [['box_medium', 20]],
      [
        { access: access({ parking: ParkingSituation.StreetHard }), volumeM3: 3 },
        { access: access(), volumeM3: 3 },
      ],
    );
    expect(hard.total).toBeGreaterThan(easy.total);
  });

  it('costs time for a long carry beyond the free allowance', () => {
    const near = estimate(
      [['box_medium', 20]],
      [
        { access: access({ carryDistanceMeters: 10 }), volumeM3: 3 },
        { access: access(), volumeM3: 3 },
      ],
    );
    const far = estimate(
      [['box_medium', 20]],
      [
        { access: access({ carryDistanceMeters: 120 }), volumeM3: 3 },
        { access: access(), volumeM3: 3 },
      ],
    );
    expect(near.longCarry).toBe(0);
    expect(far.longCarry).toBeGreaterThan(0);
    expect(far.total).toBeGreaterThan(near.total);
  });
});

describe('the crane trades stair time for setup time', () => {
  it('removes the stair carry for the volume it hoists', () => {
    const stops = [
      {
        access: access({ floor: 5, stairFlights: 5, narrowStairwell: true }),
        volumeM3: 4,
        craneVolumeM3: 4,
      },
      { access: access(), volumeM3: 4 },
    ];
    const withCrane = estimate(
      [
        ['sofa_3_seat', 2],
        ['box_medium', 4],
      ],
      stops,
    );
    expect(withCrane.stairs).toBe(0);
    expect(withCrane.crane).toBeGreaterThan(0);
  });

  it('still walks whatever the crane does not take', () => {
    const stops = [
      {
        access: access({ floor: 5, stairFlights: 5 }),
        volumeM3: 4,
        // Only the sofa goes over the balcony; the boxes still take the stairs.
        craneVolumeM3: 1.8,
      },
      { access: access(), volumeM3: 4 },
    ];
    const result = estimate(
      [
        ['sofa_3_seat', 1],
        ['box_medium', 22],
      ],
      stops,
    );
    expect(result.stairs).toBeGreaterThan(0);
    expect(result.crane).toBeGreaterThan(0);
  });

  it('is worth it on a high floor and not on a low one', () => {
    const heavyLoad: Array<[string, number]> = [
      ['sofa_3_seat', 2],
      ['wardrobe_3_door', 1],
    ];
    const volume = totalsFor(heavyLoad).totalVolumeM3;

    const highWalked = estimate(heavyLoad, [
      { access: access({ floor: 6, stairFlights: 6 }), volumeM3: volume },
      { access: access(), volumeM3: volume },
    ]);
    const highCraned = estimate(heavyLoad, [
      { access: access({ floor: 6, stairFlights: 6 }), volumeM3: volume, craneVolumeM3: volume },
      { access: access(), volumeM3: volume },
    ]);
    // Six flights with a wardrobe: hoisting genuinely saves time.
    expect(highCraned.total).toBeLessThan(highWalked.total);

    const lowWalked = estimate(heavyLoad, [
      { access: access({ floor: 1, stairFlights: 1 }), volumeM3: volume },
      { access: access(), volumeM3: volume },
    ]);
    const lowCraned = estimate(heavyLoad, [
      { access: access({ floor: 1, stairFlights: 1 }), volumeM3: volume, craneVolumeM3: volume },
      { access: access(), volumeM3: volume },
    ]);
    // One flight: the setup costs more than the carry. The crane rules should
    // never recommend it here, and the time model agrees.
    expect(lowCraned.total).toBeGreaterThan(lowWalked.total);
  });
});

describe('the buffer', () => {
  it('is always applied, because the price is locked', () => {
    // Every minute of underestimate is a minute the driver works for free.
    const result = estimate([['box_medium', 20]], groundFloorBothEnds);
    expect(result.bufferMinutes).toBeGreaterThan(0);
    expect(result.total).toBeGreaterThanOrEqual(result.beforeBuffer);
  });

  it('scales with the size of the job', () => {
    const small = estimate([['box_medium', 5]], groundFloorBothEnds);
    const large = estimate([['box_medium', 60]], groundFloorBothEnds);
    expect(large.bufferMinutes).toBeGreaterThan(small.bufferMinutes);
  });
});

describe('sanity', () => {
  it('never returns zero minutes for a real job', () => {
    const result = estimate([['box_medium', 1]], groundFloorBothEnds);
    expect(result.total).toBeGreaterThan(0);
  });

  it('produces a plausible duration for a typical one-bedroom move', () => {
    // דירת 2 חדרים, second floor walk-up, two movers. Israeli movers would
    // call this a half-day job. If the model says 40 minutes or 12 hours,
    // it is wrong in a way no amount of rate-card tuning will fix.
    const result = estimate(
      [
        ['box_medium', 25],
        ['sofa_3_seat', 1],
        ['mattress_double', 1],
        ['wardrobe_3_door', 1],
        ['fridge_large', 1],
        ['dining_chair', 4],
      ],
      [
        { access: access({ floor: 2, stairFlights: 2 }), volumeM3: 7 },
        { access: access({ floor: 1, stairFlights: 1 }), volumeM3: 7 },
      ],
      2,
    );
    expect(result.total).toBeGreaterThan(150); // more than 2.5 hours
    expect(result.total).toBeLessThan(420); // less than 7 hours
  });

  it('recommends a bigger crew for a job that would otherwise run all day', () => {
    const huge: Array<[string, number]> = [
      ['box_medium', 80],
      ['sofa_3_seat', 2],
      ['wardrobe_3_door', 3],
      ['fridge_large', 2],
    ];
    const volume = totalsFor(huge).totalVolumeM3;
    const stops = [
      { access: access({ floor: 3, stairFlights: 3 }), volumeM3: volume },
      { access: access({ floor: 2, stairFlights: 2 }), volumeM3: volume },
    ];

    const crew = recommendCrewSize({ totals: totalsFor(huge), stops }, card, {
      requiresTwoPeople: true,
    });
    expect(crew).toBeGreaterThanOrEqual(3);
  });

  it('never recommends a single mover for items needing two', () => {
    const crew = recommendCrewSize(
      { totals: totalsFor([['sofa_3_seat', 1]]), stops: groundFloorBothEnds },
      card,
      { requiresTwoPeople: true },
    );
    expect(crew).toBeGreaterThanOrEqual(2);
  });
});
