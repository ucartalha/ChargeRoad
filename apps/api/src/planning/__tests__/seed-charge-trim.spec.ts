import {SEED_TRIM_POLICY} from '../optimizer-policy';
import {CHARGE_TARGET_SEARCH_POLICY} from '../charge-target-search';
import {optimizerWorld} from './optimizer.fixtures';

// Optimizer 1.7.0 (user report 2026-11-19: two 100 % stops under "shortest time"): on long routes the seed uses most of
// the search budget, so the later target-improvement phase never runs. The seed itself therefore charges only to what
// the next validated leg needs (+margin). Real-route evidence (Kadıköy→Kelkit 1 101.9 → 1 012.3 min) is in
// docs/validation; here the improvement phase is switched off to model the long-route situation.
// Synthetic: 82.5 %/km; the last station is 0.75 km before the destination, needing ~62 % + 20 % arrival = ~82 %.
const search=CHARGE_TARGET_SEARCH_POLICY as unknown as {maxCalls:number},trim=SEED_TRIM_POLICY as unknown as {minGainPercent:number};
let saved={calls:0,gain:0};
beforeEach(()=>{saved={calls:search.maxCalls,gain:trim.minGainPercent};search.maxCalls=0;});
afterEach(()=>{search.maxCalls=saved.calls;trim.minGainPercent=saved.gain;});
async function plan(objective:string,trimEnabled=true){
  const w=optimizerWorld();w.vehicle.consumptionReferences[0].valueKwhPer100Km=330;w.request.startingChargePercent=60;
  w.request.policy.objective=objective as never;trim.minGainPercent=trimEnabled?saved.gain:1000;
  const r=await w.service.plan(w.request,w.preparation,w.options);return {w,r};
}
describe('Seed charge-to-need trim (optimizer 1.7.0)',()=>{
  it('declares a small safety margin',()=>{expect(SEED_TRIM_POLICY.marginPercent).toBeGreaterThan(0);expect(SEED_TRIM_POLICY.marginPercent).toBeLessThanOrEqual(1);});
  it('charges the last stop only to what the final leg needs (minimum total duration)',async()=>{
    const {w,r}=await plan('minimum_total_duration');
    expect(r.result.status).toBe('planned');if(r.result.status!=='planned')return;
    const last=r.result.plan.chargingStops.at(-1)!;
    expect(last.targetChargePercent).toBeGreaterThan(80);expect(last.targetChargePercent).toBeLessThan(95);
    expect(r.result.plan.estimatedArrivalChargePercent).toBeGreaterThanOrEqual(w.request.constraints.targetArrivalChargePercent-1e-6);
  },60000);
  it('never changes a fewer-stops plan',async()=>{
    const on=await plan('minimum_charging_stops',true),off=await plan('minimum_charging_stops',false);
    expect(on.r.result.status).toBe('planned');if(on.r.result.status!=='planned'||off.r.result.status!=='planned')throw new Error('not planned');
    const stops=(p:typeof on.r.result)=>p.status==='planned'?p.plan.chargingStops.map(s=>[s.stationId,s.targetChargePercent]):[];
    expect(stops(on.r.result)).toEqual(stops(off.r.result));
  },60000);
});
// Optimizer 1.8.0: the stop before the destination is trimmed even inside the fast band, so the arrival is not overshot.
it('trims the final stop to what the destination leg needs even below the fast band (1.8.0)',()=>{
  const source=require('fs').readFileSync(require('path').resolve(__dirname,'../charge-stop-optimizer.ts'),'utf8');
  expect(source).toContain("stop.targetChargePercent<=fastBand+1e-7&&leg.to!=='destination'");
});
