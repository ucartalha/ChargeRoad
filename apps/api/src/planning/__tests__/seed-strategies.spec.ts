import {ChargeStopOptimizer} from '../charge-stop-optimizer';
import {CATALOGUE_SCENARIO_POLICY} from '../catalogue-station-scenario';
import {PlanningSession} from '../planning-session';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {ChargingCurveEngine} from '../../charging/charging-engine';
import type {PlanningContext} from '../optimizer-types';
import {optimizerWorld} from './optimizer.fixtures';

// Optimizer 1.5.0: the seed chain is built with two reach strategies (far jumps, then nearer stops). The second
// one may only replace the incumbent with a strictly better plan, so seeding can never make a plan worse.
const timers=['hrtime','nextTick','performance','queueMicrotask','requestAnimationFrame','cancelAnimationFrame','requestIdleCallback','cancelIdleCallback',
  'setImmediate','clearImmediate','setInterval','clearInterval','setTimeout','clearTimeout'] as const;
afterEach(()=>jest.useRealTimers());
async function solve(objective:string,startSoc:number,strategies:readonly number[]){
  jest.useFakeTimers({now:Date.parse('2026-11-17T09:00:00Z'),doNotFake:[...timers]});
  const policy=CATALOGUE_SCENARIO_POLICY as unknown as {seedReachFractions:readonly number[]},saved=policy.seedReachFractions;policy.seedReachFractions=strategies;
  try{
    const w=optimizerWorld();w.request.policy.objective=objective as never;w.request.startingChargePercent=startSoc;
    const context:PlanningContext={request:w.request,vehicle:w.vehicle,evaluatedAt:w.now,options:w.options,candidates:w.candidates,
      nodes:Object.entries(w.locations).map(([id,location])=>({id,location,stationId:['origin','destination'].includes(id)?null:id})),baseRoutes:[w.route('origin','destination')]};
    const session=new PlanningSession(context,w.roads as never,w.weather as never,new EnergyConsumptionEngine(),new ChargingCurveEngine(),w.preparation.road,performance.now()+60000,context.baseRoutes);
    const outcome=await new ChargeStopOptimizer(()=>0).solve(context,session,new AbortController().signal);
    const plan=outcome.result.status==='planned'?outcome.result.plan:null;
    return {status:outcome.result.status,seconds:plan?.scenario?.totalSeconds??null,stops:plan?.chargingStops.length??null};
  }finally{policy.seedReachFractions=saved;}
}

describe('Two seed strategies (optimizer 1.5.0)',()=>{
  it('declares the far strategy first and a nearer one second',()=>{
    const fractions=(CATALOGUE_SCENARIO_POLICY as unknown as {seedReachFractions:readonly number[]}).seedReachFractions;
    expect(fractions).toHaveLength(2);expect(fractions[0]).toBe(CATALOGUE_SCENARIO_POLICY.seedReachFraction);expect(fractions[1]).toBeLessThan(fractions[0]);
  });
  it.each([['minimum_total_duration',40],['minimum_total_duration',100],['minimum_charging_stops',40],['minimum_energy',60]])(
    'never yields a worse or missing plan than the far strategy alone: %s from %i %%',async(objective,soc)=>{
      const far=await solve(objective,soc,[CATALOGUE_SCENARIO_POLICY.seedReachFraction]);
      const both=await solve(objective,soc,(CATALOGUE_SCENARIO_POLICY as unknown as {seedReachFractions:readonly number[]}).seedReachFractions);
      if(far.status==='planned'){expect(both.status).toBe('planned');
        if(objective==='minimum_charging_stops')expect(both.stops!).toBeLessThanOrEqual(far.stops!);
        else if(objective==='minimum_total_duration')expect(both.seconds!).toBeLessThanOrEqual(far.seconds!+1e-6);}
    });
});
