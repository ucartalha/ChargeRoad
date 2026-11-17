import {ChargeStopOptimizer,respectsStopRules} from '../charge-stop-optimizer';
import {SOC_STOP_RULES} from '../optimizer-policy';
import {PlanningSession} from '../planning-session';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {ChargingCurveEngine} from '../../charging/charging-engine';
import type {PlanningContext,OptimizerState} from '../optimizer-types';
import {optimizerWorld} from './optimizer.fixtures';

// User rule (2026-11-17): no charging stop while the car still arrives with a high SOC (EV comfort band 10-80 %).
const stop=(arrival:number)=>({stop:{arrivalChargePercent:arrival}}) as never;
const state=(stops:unknown[]):OptimizerState=>({nodeId:'destination',soc:20,temperature:{origin:'unknown',value:null},capacity:null,at:'2026-11-17T12:00:00Z',
  legs:[],stops:stops as never,visited:['origin'],netKwh:0,seconds:0,distance:0});
const timers=['hrtime','nextTick','performance','queueMicrotask','requestAnimationFrame','cancelAnimationFrame','requestIdleCallback','cancelIdleCallback',
  'setImmediate','clearImmediate','setInterval','clearInterval','setTimeout','clearTimeout'] as const;
afterEach(()=>jest.useRealTimers());

describe('SOC stop rules (optimizer 1.5.0)',()=>{
  it('forbids a stop reached at 50 % or more',()=>{
    expect(SOC_STOP_RULES.noChargeAtOrAboveArrivalPercent).toBe(50);
    expect(respectsStopRules(state([]))).toBe(true);
    expect(respectsStopRules(state([stop(12),stop(49.9)]))).toBe(true);
    expect(respectsStopRules(state([stop(12),stop(50)]))).toBe(false);
  });
  it('plans through a later station instead of topping up early from a full battery',async()=>{
    jest.useFakeTimers({now:Date.parse('2026-11-17T09:00:00Z'),doNotFake:[...timers]});
    const w=optimizerWorld();w.request.startingChargePercent=100;
    const context:PlanningContext={request:w.request,vehicle:w.vehicle,evaluatedAt:w.now,options:w.options,candidates:w.candidates,
      nodes:Object.entries(w.locations).map(([id,location])=>({id,location,stationId:['origin','destination'].includes(id)?null:id})),baseRoutes:[w.route('origin','destination')]};
    const session=new PlanningSession(context,w.roads as never,w.weather as never,new EnergyConsumptionEngine(),new ChargingCurveEngine(),w.preparation.road,performance.now()+60000,context.baseRoutes);
    const outcome=await new ChargeStopOptimizer(()=>0).solve(context,session,new AbortController().signal);
    expect(outcome.result.status).toBe('planned');if(outcome.result.status!=='planned')return;
    expect(outcome.result.plan.chargingStops.length).toBeGreaterThan(0);
    for(const s of outcome.result.plan.chargingStops)expect(s.arrivalChargePercent).toBeLessThan(SOC_STOP_RULES.noChargeAtOrAboveArrivalPercent);
    expect(outcome.result.plan.warnings.some(w=>w.code==='soc_stop_rule_relaxed')).toBe(false);
  });
  it('still plans, with a warning, when the only feasible stop is reached above the rule',async()=>{
    jest.useFakeTimers({now:Date.parse('2026-11-17T09:00:00Z'),doNotFake:[...timers]});
    // Only station a (0.5 of 2 km): reached at ~75 % from a full battery, and the trip is impossible without it.
    const w=optimizerWorld();w.request.startingChargePercent=100;w.candidates.candidates=w.candidates.candidates.filter(c=>c.station.id==='a');
    const context:PlanningContext={request:w.request,vehicle:w.vehicle,evaluatedAt:w.now,options:w.options,candidates:w.candidates,
      nodes:Object.entries(w.locations).filter(([id])=>id!=='b').map(([id,location])=>({id,location,stationId:['origin','destination'].includes(id)?null:id})),baseRoutes:[w.route('origin','destination')]};
    const session=new PlanningSession(context,w.roads as never,w.weather as never,new EnergyConsumptionEngine(),new ChargingCurveEngine(),w.preparation.road,performance.now()+60000,context.baseRoutes);
    const outcome=await new ChargeStopOptimizer(()=>0).solve(context,session,new AbortController().signal);
    expect(outcome.result.status).toBe('planned');if(outcome.result.status!=='planned')return;
    expect(outcome.result.plan.chargingStops.map(s=>s.stationId)).toEqual(['a']);
    expect(outcome.result.plan.chargingStops[0].arrivalChargePercent).toBeGreaterThanOrEqual(SOC_STOP_RULES.noChargeAtOrAboveArrivalPercent);
    expect(outcome.result.plan.warnings.some(w=>w.code==='soc_stop_rule_relaxed')).toBe(true);
  });
});
