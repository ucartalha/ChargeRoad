import {routeStopLimit,seedingAllowed,STOP_LIMIT_POLICY,IMPROVE_RESERVE_POLICY,OPTIMIZER_VERSION} from '../optimizer-policy';
import {PlanningSession} from '../planning-session';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {ChargingCurveEngine} from '../../charging/charging-engine';
import {ChargeStopOptimizer} from '../charge-stop-optimizer';
import {PLANNING_WEATHER_POLICY} from '../../weather/planning-weather-policy';
import type {PlanningContext} from '../optimizer-types';
import {optimizerWorld} from './optimizer.fixtures';

// Optimizer 1.8.0 (2026-11-19, phone İstanbul→Erzurum from ~40 % SOC: computation_limit).
// 1) The fixed 6-stop cap made a 7–8 stop trip impossible; the cap now follows route length and range.
// 2) Seed chains spent the whole weather budget, so stop targets were never improved (100 % stops, 35–62 % arrival);
//    after the first plan, further seeding stops while less than IMPROVE_RESERVE_POLICY.fraction of the budget is left.
// 3) A fallback corridor route started with the first route's exhausted budgets and could never plan.
describe('Stop limit by route length',()=>{
  it('is ceil(route km / range km) + slack, between min and max',()=>{
    expect(STOP_LIMIT_POLICY).toMatchObject({min:6,max:12,slack:1});
    expect(routeStopLimit(1266000,175)).toBe(9);expect(routeStopLimit(1127000,175)).toBe(8);
    expect(routeStopLimit(458000,175)).toBe(6);expect(routeStopLimit(5000000,175)).toBe(12);
    for(const range of [null,undefined,0,-1,NaN])expect(routeStopLimit(1266000,range as never)).toBe(STOP_LIMIT_POLICY.unknownRange);
  });
  it('the planning service never lowers the caller limit and raises it for long routes',async()=>{
    const seen:number[]=[],solve=ChargeStopOptimizer.prototype.solve;
    const spy=jest.spyOn(ChargeStopOptimizer.prototype,'solve').mockImplementation(async function(this:ChargeStopOptimizer,ctx,...rest){seen.push(ctx.options.maxStops);return solve.call(this,ctx,...rest);});
    try{const w=optimizerWorld();await w.service.plan(w.request,w.preparation,{...w.options,maxStops:7});
      expect(seen.length).toBeGreaterThan(0);for(const n of seen)expect(n).toBeGreaterThanOrEqual(7);}finally{spy.mockRestore();}
  });
});
describe('Improvement reserve',()=>{
  it('allows seeding before any plan and while at least the reserve is left',()=>{
    expect(IMPROVE_RESERVE_POLICY.fraction).toBe(.3);
    expect(seedingAllowed(false,{used:99,limit:100})).toBe(true);expect(seedingAllowed(true,undefined)).toBe(true);
    expect(seedingAllowed(true,{used:60,limit:100})).toBe(true);expect(seedingAllowed(true,{used:71,limit:100})).toBe(false);
    expect(seedingAllowed(true,{used:5,limit:Infinity})).toBe(true);
  });
});
describe('Session weather budget',()=>{
  function session(){
    const w=optimizerWorld();const route=w.route('origin','destination');
    const context:PlanningContext={request:w.request,vehicle:w.vehicle,evaluatedAt:w.now,options:w.options,candidates:w.candidates,
      nodes:Object.entries(w.locations).map(([id,location])=>({id,location,stationId:['origin','destination'].includes(id)?null:id})),baseRoutes:[route],
      weatherSampling:{} as never};
    return {s:new PlanningSession(context,w.roads as never,w.weather as never,new EnergyConsumptionEngine(),new ChargingCurveEngine(),w.preparation.road,performance.now()+60000,context.baseRoutes),route,w};
  }
  it('reports the same projection limit the session enforces, and a reset clears search budgets',()=>{
    const {s,route,w}=session();
    expect(s.weatherBudget()).toEqual({used:0,limit:Math.min(PLANNING_WEATHER_POLICY.maxSegmentEvaluations,Math.max(w.options.maxWeatherQueries,route.segments.length*PLANNING_WEATHER_POLICY.maxSegmentPasses))});
    s.counters.weatherQueries=500;s.counters.roadQueries=9;s.resetSearchBudgets();
    expect(s.counters).toEqual({roadQueries:0,weatherQueries:0});expect(s.weatherBudget().used).toBe(0);
  });
  it('optimizer version is at least 1.8.0',()=>expect(OPTIMIZER_VERSION).toMatch(/^chargeroad-optimizer\/1\.(8|9)\./));
});
// Optimizer 1.8.0: improveFixedStopTargets measured its allowance as (maxWeatherQueries − used projections) although
// maxWeatherQueries counts sample-location units (10 000) and the counter counts segment projections (~40 000 on
// İstanbul→Erzurum): the allowance was 0 and long routes were never improved (100 % stops, 62 % arrival).
import {improveWeatherAllowance,CHARGE_TARGET_SEARCH_POLICY} from '../charge-target-search';
describe('Improvement weather allowance',()=>{
  const context={options:{maxWeatherQueries:10000}} as never;
  it('uses the projection budget the session enforces',()=>{
    const port={counters:{weatherQueries:40000},weatherBudget:()=>({used:40000,limit:48000})} as never;
    expect(improveWeatherAllowance(context,port)).toBe(Math.floor(8000*CHARGE_TARGET_SEARCH_POLICY.remainingBudgetFraction));
  });
  it('keeps the old rule when the port reports no finite projection budget',()=>{
    expect(improveWeatherAllowance(context,{counters:{weatherQueries:2000}} as never)).toBe(Math.floor(8000*CHARGE_TARGET_SEARCH_POLICY.remainingBudgetFraction));
    expect(improveWeatherAllowance(context,{counters:{weatherQueries:2000},weatherBudget:()=>({used:2000,limit:Infinity})} as never)).toBe(Math.floor(8000*CHARGE_TARGET_SEARCH_POLICY.remainingBudgetFraction));
    expect(improveWeatherAllowance(context,{counters:{weatherQueries:12000}} as never)).toBe(0);
  });
});
