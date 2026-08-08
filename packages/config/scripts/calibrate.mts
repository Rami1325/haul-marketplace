import { CATALOG_BY_ID, MANIFEST_PRESETS } from '../../config/src/catalog.js';
import { TEL_AVIV_RATE_CARD, TEL_AVIV_MARKET_ANCHORS } from '../../config/src/cities/tel-aviv.js';
import { computeQuote } from '../../pricing/src/engine.js';
import { RateCardSchema } from '../../pricing/src/rate-card.js';
import { ElevatorKind, ParkingSituation, CraneNeed, StopKind, DayKind } from '../../types/src/index.js';

const access = (o: any = {}) => ({ floor:0, elevator:ElevatorKind.Standard, stairFlights:0, carryDistanceMeters:0, parking:ParkingSituation.StreetEasy, narrowStairwell:false, crane:CraneNeed.NotNeeded, permitRequired:false, notes:null, ...o });
const scenarios = [
  { p:'apartment_2_rooms', v:'van', crew:2 },
  { p:'apartment_3_rooms', v:'box_truck_4t', crew:3 },
  { p:'apartment_4_rooms', v:'box_truck_4t', crew:3 },
  { p:'apartment_5_rooms_plus', v:'box_truck_8t', crew:4 },
];

function run(card: any, s: any) {
  const preset = MANIFEST_PRESETS.find(x => x.id === s.p)!;
  return computeQuote({
    cityId:'tel-aviv',
    manifest:{ lines: preset.lines.map(l => ({catalogItemId:l.catalogItemId, quantity:l.quantity, customLabel:null, stopIndex:0, addedDuringJob:false, loadedAt:null, unloadedAt:null})), presetId:s.p, source:'preset' as const },
    stops:[{kind:StopKind.Pickup,access:access()},{kind:StopKind.Dropoff,access:access()}],
    routedDistanceMeters:9000, vehicleClassId:s.v as any, crewSize:s.crew,
    schedule:{at:new Date('2026-10-13T07:00:00Z'),dayKind:DayKind.Workday,isCholHaMoed:false,localHour:9,month:10},
  }, card, CATALOG_BY_ID);
}

let best: any = null;
for (const floor of [0.34,0.40,0.46,0.52,0.58,0.64,0.70]) {
  for (const scale of [5,7,9,11,14,18,24]) {
    for (const labor of [100,115,130,145,160]) {
      const card = RateCardSchema.parse({
        ...TEL_AVIV_RATE_CARD,
        laborPerMoverHour: Math.round(labor*100/1.18),
        workingMinutes: { ...TEL_AVIV_RATE_CARD.workingMinutes, bulkEfficiencyFloor: floor, bulkEfficiencyScale: scale },
      });
      let err = 0; const rows: string[] = [];
      for (const s of scenarios) {
        const r = run(card, s);
        const anchor = TEL_AVIV_MARKET_ANCHORS.find(a => a.presetId === s.p)!;
        const ratio = r.lockedTotal / anchor.typical;
        err += (ratio-1)**2;
        rows.push(`${s.p.padEnd(24)} ₪${(r.lockedTotal/100).toFixed(0).padStart(5)} vs ₪${(anchor.typical/100).toFixed(0)} (${ratio.toFixed(2)}x) ${r.estimatedWorkingMinutes}min`);
      }
      if (!best || err < best.err) best = { err, floor, scale, labor, rows };
    }
  }
}
console.log(`best: floor=${best.floor} scale=${best.scale} labor=₪${best.labor}/hr  rms=${Math.sqrt(best.err/4).toFixed(3)}`);
best.rows.forEach((r: string) => console.log('  ' + r));
