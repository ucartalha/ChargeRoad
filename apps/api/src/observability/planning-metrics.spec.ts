import {setImmediate as immediate} from 'node:timers/promises';
import {Logger} from '@nestjs/common';
import {withPlanningMetrics,countMetric,setMetric,maxMetric,startStage,observeStage,measureAsync,measureSync,markAbort,metricCounters} from './planning-metrics';
import type {PlanningMetricSnapshot} from './planning-metrics';
const id='11111111-1111-4111-8111-111111111111';
describe('Opt-in bounded request-local metrics',()=>{
 it('is a transparent disabled path with no sink, timer context or counter effects',async()=>{
  const sink=jest.fn(),value={opaque:true},operation=Promise.resolve(value);
  const result=withPlanningMetrics(id,()=>{countMetric('energy_evaluations');return operation;},{enabled:false,sink});
  expect(result).toBe(operation);expect(await result).toBe(value);expect(sink).not.toHaveBeenCalled();
 });
 it('does not let overlapping requests or nested records contaminate each other',async()=>{
  const records:PlanningMetricSnapshot[]=[];
  await Promise.all([1,7].map((amount,i)=>withPlanningMetrics(i===0?id:'22222222-2222-4222-8222-222222222222',async()=>{
   countMetric('energy_evaluations',amount);await immediate();await withPlanningMetrics(id,async()=>{countMetric('charge_integrations',amount);});
  },{enabled:true,sink:s=>records.push(s)})));
  expect(records).toHaveLength(2);expect(records.map(s=>s.counters.energy_evaluations).sort((a,b)=>a-b)).toEqual([1,7]);
  for(const r of records)expect(r.counters.charge_integrations).toBe(r.counters.energy_evaluations);
 });
 it('counts repeated stages once per completion, preserves throws and ignores duplicate closes',async()=>{
  let record!:PlanningMetricSnapshot;const failure=new Error('private location/payload must not be serialized');
  await expect(withPlanningMetrics(id,async()=>{const end=startStage('plan_compile');end();end();
   await measureAsync('energy_evaluation',async()=>{await immediate();});measureSync('weather_sampling',()=>1);
   observeStage('job_wait',10);observeStage('job_wait',-1);throw failure;
  },{enabled:true,sink:s=>record=s})).rejects.toBe(failure);
  expect(record.stages.plan_compile?.count).toBe(1);expect(record.stages.energy_evaluation?.active).toBe(0);expect(record.stages.job_wait?.totalMs).toBe(10);
  expect(record.outcome).toBe('error');expect(JSON.stringify(record)).not.toContain(failure.message);
 });
 it('logs only bounded whitelisted aggregate data and clamps invalid counter operations',async()=>{
  let record!:PlanningMetricSnapshot;
  await withPlanningMetrics(id,async()=>{countMetric('energy_evaluations',2);countMetric('energy_evaluations',-1);setMetric('charge_integrations',NaN);
   maxMetric('frontier_peak',4);maxMetric('frontier_peak',1);countMetric('GPS_SECRET' as any,1);observeStage('GPS_SECRET' as any,1);
   return {status:'planned',latitude:39,secret:'PRIVATE_TOKEN',startingChargePercent:75,geometry:[1,2]};
  },{enabled:true,sink:s=>record=s});
  expect(record.counters.energy_evaluations).toBe(2);expect(record.counters.frontier_peak).toBe(4);expect(Object.keys(record.counters)).toEqual([...metricCounters]);
  expect(JSON.stringify(record)).not.toMatch(/PRIVATE_TOKEN|startingChargePercent|latitude|geometry|GPS_SECRET/);
 });
 it('telemetry failures, non-UUID IDs and throwing result getters never change the business result',async()=>{
  const value=Object.defineProperty({},'result',{get(){throw new Error('getter failure');}}),sink=jest.fn();
  expect(await withPlanningMetrics(id,async()=>value,{enabled:true,sink:()=>{throw new Error('logger failed');}})).toBe(value);
  await withPlanningMetrics('sensitive-invalid-id',async()=>value,{enabled:true,sink});expect(sink).not.toHaveBeenCalled();
 });
 it('records cancellation/deadline separately, and refuses late writes after record closure',async()=>{
  let record!:PlanningMetricSnapshot,late!:()=>void;
  const abort=new AbortController();abort.abort(new DOMException('secret is not logged','TimeoutError'));
  await withPlanningMetrics(id,async()=>{markAbort(abort.signal);late=startStage('road_http');},{enabled:true,sink:s=>record=s});
  expect(record.counters.timeout).toBe(1);expect(record.outcome).toBe('timeout');expect(record.incomplete).toBe(true);expect(record.stages.road_http?.active).toBe(1);late();expect(record.stages.road_http?.count).toBe(0);
 });
 it('a configured flag produces a correlated record with authoritative existing counters, not a second budget',async()=>{
  const before=process.env.PLANNING_METRICS_ENABLED;process.env.PLANNING_METRICS_ENABLED='true';const log=jest.spyOn(Logger.prototype,'log').mockImplementation(()=>{});
  try{await withPlanningMetrics(id,async()=>({result:{status:'computation_limit',reasons:[{code:'PLANNING_PREPARATION_DEADLINE'}]},search:{expandedStates:3,evaluatedTransitions:4,roadQueries:5,weatherQueries:6}}));
   const record=JSON.parse(log.mock.calls[0][0]);expect(record.requestId).toBe(id);expect(record.counters).toMatchObject({expanded_states:3,transitions:4,road_queries_budgeted:5,weather_queries_budgeted:6,timeout:1});
  }finally{log.mockRestore();if(before===undefined)delete process.env.PLANNING_METRICS_ENABLED;else process.env.PLANNING_METRICS_ENABLED=before;}
 });
});
