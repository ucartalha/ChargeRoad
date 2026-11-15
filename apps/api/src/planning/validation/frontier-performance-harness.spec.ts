import {isDeepStrictEqual} from 'node:util';
import {StablePriorityQueue} from '../stable-priority-queue';
import {assertEquivalent,compileOptimizer,makeRunner,objectives,type Profile} from './frontier-performance-harness';

describe('Isolated production-source frontier performance seam',()=>{
 const flag=process.env.PLANNING_METRICS_ENABLED;
 beforeAll(()=>{process.env.PLANNING_METRICS_ENABLED='false';jest.useFakeTimers({now:new Date('2026-11-13T09:00:00Z'),doNotFake:['performance','hrtime','nextTick','setImmediate','setTimeout','clearTimeout','setInterval','clearInterval']});});
 afterAll(()=>{jest.useRealTimers();if(flag===undefined)delete process.env.PLANNING_METRICS_ENABLED;else process.env.PLANNING_METRICS_ENABLED=flag;});
 it('fails closed if the production queue import seam is no longer present',()=>{
  expect(()=>compileOptimizer(StablePriorityQueue,'export class ChargeStopOptimizer {}')).toThrow('Unexpected production queue import');
 });
 it.each(objectives)('anchors both strategies and telemetry modes to the real optimizer: %s',async objective=>{
  const fetch=jest.spyOn(global,'fetch').mockRejectedValue(new Error('No external data'));
  try{
   const native=await makeRunner('native')('small',objective,false),sort=await makeRunner('sort')('small',objective,false),heap=await makeRunner('heap')('small',objective,true);
   expect(()=>assertEquivalent(native,sort)).not.toThrow();expect(()=>assertEquivalent(sort,heap)).not.toThrow();
   expect(heap.metrics?.counters.frontier_peak).toBe(heap.queue.peak);expect(sort.metrics).toBeNull();expect(fetch).not.toHaveBeenCalled();
   expect(sort.queue.comparisons).not.toBe(heap.queue.comparisons);
   const badTrace={...heap,traceHash:'wrong'};expect(()=>assertEquivalent(sort,badTrace)).toThrow('EQUIVALENCE_FAILED');
   const badQueue={...heap,queue:{...heap.queue,popHash:'wrong'}};expect(()=>assertEquivalent(sort,badQueue)).toThrow('ORDER_FAILED');
   const changed=structuredClone(heap);changed.outcome.search.expandedStates++;expect(()=>assertEquivalent(sort,changed)).toThrow('EQUIVALENCE_FAILED');
  }finally{fetch.mockRestore();}
 });
 it.each(['medium','large'] as Profile[])('measures an actual bounded full plan in the %s bucket',async profile=>{
  const sort=await makeRunner('sort')(profile,'minimum_total_duration',false),heap=await makeRunner('heap')(profile,'minimum_total_duration',false);
  expect(isDeepStrictEqual(sort.outcome,heap.outcome)).toBe(true);expect(()=>assertEquivalent(sort,heap)).not.toThrow();
  expect(sort.outcome.result.status).toBe('planned');expect(sort.outcome.search.stoppedReason).toBe('state_budget');
  expect(heap.queue.peak).toBeGreaterThanOrEqual(profile==='medium'?64:257);if(profile==='medium')expect(heap.queue.peak).toBeLessThanOrEqual(256);
  expect(heap.queue.pop).toBe(2);expect(heap.queue.push).toBe(sort.queue.push);
 });
});
