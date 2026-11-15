import {SessionRepeatAudit,exactAuditKey} from '../validation/session-repeat-audit';
import {eligibilityWorld} from '../validation/eligibility-fixtures';
import {sampleRouteWeather} from '../../weather/weather-sampler';
describe('Validation-only exact-data repeat index, never a result cache',()=>{
 it('always executes repeated operations and preserves returned identity',()=>{
  const a=new SessionRepeatAudit('fixed'),value={result:true},work=jest.fn(()=>value);
  expect(a.sync('sample_weather',{route:1},work)).toBe(value);expect(a.sync('sample_weather',{route:1},work)).toBe(value);
  expect(work).toHaveBeenCalledTimes(2);expect(a.stats.sample_weather.exactArgumentRepeats).toBe(1);expect(a.stats.sample_weather.repeatedFulfilledDataInputs).toBe(1);
 });
 it('separates exact scalar/source/geometry/time/unknown data without buckets',()=>{
  const key=(value:unknown)=>exactAuditKey('fixed','sample_weather',value),base={routeId:'same',geometry:[1,2],at:'2026-11-15T09:00Z',soc:50,sourceVersion:'v1'};
  expect(key(base)).toBe(key({sourceVersion:'v1',soc:50,at:base.at,geometry:[1,2],routeId:'same'}));
  for(const data of [{...base,soc:50+1e-10},{...base,at:'2026-11-15T09:00:00.001Z'},{...base,sourceVersion:'v2'},{...base,geometry:[1,3]}])expect(key(data)).not.toBe(key(base));
  expect(key({x:undefined})).not.toBe(key({}));expect(key(null)).not.toBe(key(undefined));expect(key(-0)).not.toBe(key(0));expect(()=>key(NaN)).toThrow();
 });
 it('does not swallow failures or turn negative/changed results into a saved computation',async()=>{
  const audit=new SessionRepeatAudit('fixed'),failure=new Error('opaque');
  await expect(audit.async('energy_evaluate',{data:1},async()=>{throw failure;})).rejects.toBe(failure);
  expect(audit.stats.energy_evaluate.thrown).toBe(1);expect(audit.stats.energy_evaluate.repeatedFulfilledDataInputs).toBe(0);
  const first=await audit.async('energy_evaluate',{data:1},async()=>({status:'insufficient_data'}));
  const second=await audit.async('energy_evaluate',{data:1},async()=>({status:'estimated'}));expect(first.status).not.toBe(second.status);expect(audit.stats.energy_evaluate.outputConflicts).toBe(1);
 });
 it('bounds diagnostic keys, detects mutation, and never reuses evicted results',()=>{
  const audit=new SessionRepeatAudit('fixed',true,2);for(const x of [1,2,3,1])audit.sync('sample_weather',{x},()=>x);
  expect(audit.stats.sample_weather.keysPeak).toBe(2);expect(audit.stats.sample_weather.evictions).toBe(2);
  const input={x:1};audit.sync('sample_weather',input,()=>{input.x=2;return 1;});expect(audit.stats.sample_weather.mutatedInputs).toBe(1);
 });
 it('does not inspect inputs when disabled; rejects accessors only diagnostically',()=>{
  const trap=Object.defineProperty({},'private',{enumerable:true,get(){throw new Error('Do not read');}}),work=jest.fn(()=>1),off=new SessionRepeatAudit('fixed',false);
  expect(off.sync('sample_weather',trap,work)).toBe(1);expect(off.stats.sample_weather.calls).toBe(0);
  const on=new SessionRepeatAudit('fixed');expect(on.sync('sample_weather',trap,work)).toBe(1);expect(on.stats.sample_weather.keySkipped).toBeGreaterThan(0);
 });
 it('demonstrates sampler output aliasing: future reuse must own immutable copies',()=>{
  const w=eligibilityWorld('normal'),input={route:w.route('origin','destination'),departureAt:w.request.departureAt,stops:[]},first=sampleRouteWeather(input);
  const latitude=first.queries[0].location.latitude;first.queries[0].location.latitude+=1;
  expect(sampleRouteWeather(input).queries[0].location.latitude).toBe(latitude);
  expect(first.samples[0]).toBe(input.route.segments[0].geometry[0]);
 });
});
