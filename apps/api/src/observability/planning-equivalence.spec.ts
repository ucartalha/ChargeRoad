import {optimizerWorld} from '../planning/__tests__/optimizer.fixtures';
import {withPlanningMetrics} from './planning-metrics';
import type {PlanningMetricSnapshot} from './planning-metrics';
const clean=(value:unknown)=>JSON.parse(JSON.stringify(value,(key,v)=>key==='elapsedMilliseconds'?undefined:v));
describe('Instrumentation is observational, not a solver policy',()=>{
 const before=process.env.PLANNING_METRICS_ENABLED;
 beforeAll(()=>{process.env.PLANNING_METRICS_ENABLED='false';jest.useFakeTimers({doNotFake:['performance','hrtime','nextTick','setImmediate','setTimeout','clearTimeout','setInterval','clearInterval']});jest.setSystemTime(new Date('2026-11-13T09:00:00Z'));});
 afterAll(()=>{jest.useRealTimers();if(before===undefined)delete process.env.PLANNING_METRICS_ENABLED;else process.env.PLANNING_METRICS_ENABLED=before;});
 it.each(['minimum_total_duration','minimum_energy','minimum_charging_stops'] as const)('retains the entire deterministic outcome/replay for %s',async objective=>{
  const off=optimizerWorld(),on=optimizerWorld();off.request.policy.objective=on.request.policy.objective=objective;
  const baseline=await off.service.plan(off.request,off.preparation,off.options);let snapshot!:PlanningMetricSnapshot;
  const observed=await withPlanningMetrics(on.request.requestId,()=>on.service.plan(on.request,on.preparation,on.options),{enabled:true,sink:s=>snapshot=s});
  expect(clean(observed)).toEqual(clean(baseline));expect(snapshot.counters.road_leg_acquisitions).toBe(on.roads.routes.mock.calls.length);
  expect(snapshot.counters.weather_forecast_query_items).toBe(on.weather.forecast.mock.calls.reduce((n,c)=>n+c[0].length,0));
  expect(snapshot.counters.expanded_states).toBe(observed.search!.expandedStates);expect(snapshot.counters.transitions).toBe(observed.search!.evaluatedTransitions);
  expect(snapshot.counters.road_queries_budgeted).toBe(observed.search!.roadQueries);expect(snapshot.counters.frontier_peak).toBeGreaterThan(0);
  expect(snapshot.stages.plan_compile!.count).toBeGreaterThan(0);expect(snapshot.stages.energy_evaluation!.count).toBe(snapshot.counters.energy_evaluations);
  expect(snapshot.counters.road_http_acquisitions).toBe(0);expect(snapshot.counters.weather_http_acquisitions).toBe(0);
 });
 it('retains an insufficient-data early return without artificial provider activity',async()=>{
  const w=optimizerWorld();delete w.vehicle.energyModel;let snapshot!:PlanningMetricSnapshot;
  const value=await withPlanningMetrics(w.request.requestId,()=>w.service.plan(w.request,w.preparation,w.options),{enabled:true,sink:s=>snapshot=s});
  expect(value.result.status).toBe('insufficient_data');expect(w.roads.routes).not.toHaveBeenCalled();expect(snapshot.counters.road_leg_acquisitions).toBe(0);
  expect(snapshot.outcome).toBe('insufficient_data');expect(snapshot.stages.vehicle_profile!.count).toBe(2);
 });
});
