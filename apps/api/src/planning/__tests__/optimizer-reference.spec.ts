import {analyticalStopReference} from '../validation/optimizer-reference';
import {optimizerWorld} from './optimizer.fixtures';
import {replayOptimizer} from '../planning-replay';
describe('Independent small-graph and snapshot acceptance',()=>{
  it.each(['minimum_total_duration','minimum_charging_stops','minimum_energy'] as const)('matches exhaustive hand-integrated reference for %s',async objective=>{
    const reference=analyticalStopReference(objective),world=optimizerWorld();world.request.policy.objective=objective;
    const r=await world.service.plan(world.request,world.preparation,world.options);expect(r.result.status).toBe('planned');expect(reference.answer).not.toBeNull();
    if(r.result.status==='planned'){
      expect(Math.abs(r.result.plan.scenario!.totalSeconds-reference.answer!.seconds)).toBeLessThan(.01);
      expect(r.result.plan.search!.drivingNetBatteryKwh).toBeCloseTo(reference.answer!.netKwh,8);
      expect(r.result.plan.chargingStops).toHaveLength(reference.answer!.stops.length);
    }
  });
  it('replays captured roads and forecasts with external network calls prohibited',async()=>{
    const w=optimizerWorld(),original=await w.service.plan(w.request,w.preparation,w.options),fetch=jest.spyOn(global,'fetch').mockRejectedValue(new Error('Network prohibited'));
    try{const replayed=await replayOptimizer(JSON.parse(JSON.stringify(original.replay)),w.preparation.road,new AbortController().signal);
      expect(replayed.result.status).toBe('planned');if(original.result.status==='planned'&&replayed.result.status==='planned'){
        expect(replayed.result.plan.scenario).toEqual(original.result.plan.scenario);expect(replayed.result.plan.energySegments).toEqual(original.result.plan.energySegments);
        expect(replayed.result.plan.chargingStops).toEqual(original.result.plan.chargingStops);expect(replayed.result.plan.dataSnapshotChecksums).toEqual(original.result.plan.dataSnapshotChecksums);
      }expect(fetch).not.toHaveBeenCalled();
    }finally{fetch.mockRestore();}
  });
});
