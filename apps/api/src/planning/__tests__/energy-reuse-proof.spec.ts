import {isDeepStrictEqual} from 'node:util';
import {setImmediate as yieldLoop} from 'node:timers/promises';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {energyFixture,terrain,idealMechanics} from '../../energy/__tests__/fixtures';
import {ProofEnergyReuse,proofCanonical,ownedEnergyCopy} from '../validation/energy-reuse-proof';
import {runEnergyProof,assertEnergyProofEquivalent} from '../validation/energy-reuse-harness';
import type {EnergyEvaluationResult} from '@chargeroad/shared';

describe('CR-PERF-005 B1 energy-only offline proof, never production reuse',()=>{
 beforeAll(()=>{jest.useFakeTimers({now:new Date('2026-11-16T09:00:00Z'),doNotFake:['performance','hrtime','setImmediate','clearImmediate','setTimeout','clearTimeout','setInterval','clearInterval','nextTick','queueMicrotask']});});
 afterAll(()=>jest.useRealTimers());
 it('owns the write and every read while preserving mutable caller results',async()=>{
  const input=energyFixture(),engine=new EnergyConsumptionEngine(),signal=new AbortController().signal,c=new ProofEnergyReuse(engine,'test');
  const reference=await engine.evaluate(input,signal),first=await c.evaluate(input,signal);expect(first.status).toBe('estimated');
  expect(c.stats.writes).toBe(1);first.finalChargePercent=-123;first.segments[0].endChargePercent=-123;
  const second=await c.evaluate(input,signal);expect(isDeepStrictEqual(second,reference)).toBe(true);second.segments[0].weatherQueryIds.push('mutated');
  const third=await c.evaluate(input,signal);expect(isDeepStrictEqual(third,reference)).toBe(true);expect(second).not.toBe(third);
  expect(c.stats.hits).toBe(2);expect(c.stats.physicalCalls).toBe(1);expect(Object.isFrozen(second)).toBe(false);
  c.dispose();expect(c.stats.retainedUnits).toBe(0);
 });
 it('uses unambiguous full typed keys rather than SOC/time buckets or a lookup hash',()=>{
  const key=(v:unknown)=>proofCanonical(v).key;
  const values=[{}, {a:undefined},{a:null},{a:0},{a:-0},{a:1e-12},{a:1.000000000001},{a:[1,2]},{a:[2,1]},{a:'1;d2;'}];
  expect(new Set(values.map(key)).size).toBe(values.length);expect(key({b:2,a:1})).toBe(key({a:1,b:2}));
  for(const value of [NaN,Infinity,new Date(),new Map(),new Set(),Object.assign(Object.create({custom:true}),{a:1}),new Proxy({a:1},{})])expect(()=>key(value)).toThrow();
  const getter={get a(){throw Error('must not read accessor');}};expect(()=>key(getter)).toThrow('accessor');
  expect(()=>key(new Array(1))).toThrow();expect(()=>proofCanonical({a:'too big'},2)).toThrow();
 });
 it('includes SOC, thermal origin, SOH, capacity, staleness, model, route, forecast, departure and target differences',()=>{
  const base=energyFixture(),key=proofCanonical(base).key;
  const changes=[(x:typeof base)=>x.request.startingChargePercent+=1e-10,(x:typeof base)=>x.vehicle.version+='-new',
   (x:typeof base)=>x.vehicle.energyModel!.version+='-new',(x:typeof base)=>x.vehicle.capacity.referenceUsableBatteryKwh+=.001,
   (x:typeof base)=>x.request.stateOfHealthPercent.value=90,(x:typeof base)=>x.request.initialBatteryTemperatureC={origin:'unknown',value:null},
   (x:typeof base)=>x.route.segments[0].geometry[0].latitude+=1e-10,(x:typeof base)=>x.weather[0].fetchedAt='2026-11-09T00:00:00Z',
   (x:typeof base)=>x.weather[0].windSpeedKph=1,(x:typeof base)=>x.request.departureAt='2026-11-10T08:00:00.001+03:00',
   (x:typeof base)=>x.request.constraints.targetArrivalChargePercent+=.001,(x:typeof base)=>x.evaluatedAt='2026-11-10T07:59:59+03:00'];
  for(const change of changes){const value=structuredClone(base);change(value);expect(proofCanonical(value).key).not.toBe(key);}
 });
 it.each(['negative','unknown','stale','error','deadline'] as const)('does not cache %s results or exceptions',async kind=>{
  const input=energyFixture(),signal=new AbortController().signal;
  if(kind==='negative')input.request.startingChargePercent=0;
  if(kind==='unknown')input.weather[0].temperatureCelsius=null;
  if(kind==='stale')input.weather[0].forecastIssuedAt='2020-01-01T00:00:00Z';
  if(kind==='error')(input as any).request=null;
  let ticks=0;const engine=kind==='deadline'?new EnergyConsumptionEngine(()=>++ticks%3===0?1e9:0):new EnergyConsumptionEngine();
  const cache=new ProofEnergyReuse(engine,'test',true,16,2*1024*1024,kind==='deadline'?'custom':'stock');
  for(let i=0;i<2;i++)try{await cache.evaluate(input,signal);}catch{expect(kind).toBe('error');}
  expect(cache.stats.hits).toBe(0);expect(cache.stats.writes).toBe(0);expect(cache.stats.physicalCalls).toBe(2);
 });
 it('keeps eviction bounded, discards at close and never resurrects after close',async()=>{
  const cache=new ProofEnergyReuse(new EnergyConsumptionEngine(),'test',true,1),signal=new AbortController().signal,input=energyFixture();
  await cache.evaluate(input,signal);const other=structuredClone(input);other.request.startingChargePercent=79;
  await cache.evaluate(other,signal);expect(cache.stats.evictions).toBe(1);expect(cache.stats.entriesPeak).toBe(1);
  await cache.evaluate(input,signal);expect(cache.stats.hits).toBe(0);cache.dispose();expect(cache.stats.retainedUnits).toBe(0);
  const fresh=new ProofEnergyReuse(new EnergyConsumptionEngine(),'late');const pending=fresh.evaluate(input,signal);fresh.dispose();await pending;
  expect(fresh.stats.writes).toBe(0);expect(fresh.stats.retainedUnits).toBe(0);
 });
 it('preserves abort identity on a warm entry and declines hits at absolute-deadline boundaries',async()=>{
  const cache=new ProofEnergyReuse(new EnergyConsumptionEngine(),'test'),input=energyFixture(),cancel=new AbortController();
  await cache.evaluate(input,cancel.signal);cancel.abort(new Error('same abort ownership'));
  await expect(cache.evaluate(input,cancel.signal)).rejects.toBe(cancel.signal.reason);expect(cache.stats.hits).toBe(0);
  const signal=new AbortController().signal;await cache.evaluate(input,signal,performance.now()-1);expect(cache.stats.hits).toBe(0);
 });
 it('does not skip native yields or share in-flight work between different abort owners',async()=>{
  const input=energyFixture();input.vehicle.capacity.referenceUsableBatteryKwh=800;input.request.constraints.minimumReserveChargePercent=0;
  // A speed trace splits native integration into >64 actual steps without a fake engine.
  const s=input.route.segments[0];s.speedProfile=Array.from({length:101},(_,i)=>({elapsedSeconds:s.drivingDurationSeconds*i/100,speedKph:s.expectedSpeedKph}));
  const engine=new EnergyConsumptionEngine(),cache=new ProofEnergyReuse(engine,'test'),a=new AbortController(),b=new AbortController();
  const prime=await cache.evaluate(input,b.signal);expect(prime.audit.reduce((n,r)=>n+r.integrationSteps,0)).toBeGreaterThanOrEqual(64);expect(cache.stats.writes).toBe(0);
  const one=cache.evaluate(input,a.signal),two=cache.evaluate(input,b.signal);a.abort(new Error('only first owner'));
  await expect(one).rejects.toBe(a.signal.reason);expect((await two).status).toBe('estimated');expect(cache.stats.physicalCalls).toBe(3);expect(cache.stats.hits).toBe(0);
  await yieldLoop();expect(cache.stats.yielding).toBeGreaterThan(0);
 });
 it('rejects special output semantics instead of letting structuredClone erase prototypes',async()=>{
  const result=await new EnergyConsumptionEngine().evaluate(energyFixture(),new AbortController().signal),copy=ownedEnergyCopy(result).value;
  expect(isDeepStrictEqual(copy,result)).toBe(true);
  expect(()=>ownedEnergyCopy(Object.assign(Object.create(null),result) as EnergyEvaluationResult)).toThrow('prototype');
  expect(()=>ownedEnergyCopy(Object.freeze(result))).toThrow();
 });
 it.each(['warm','full','cold','unknown'] as const)('preserves downhill regeneration and thermal semantics: %s',async mode=>{
  const input=energyFixture();idealMechanics(input);terrain(input,[[0,100],[1000,0]]);
  if(mode==='full')input.request.startingChargePercent=100;
  if(mode==='cold')input.request.initialBatteryTemperatureC={origin:'user_input',value:-10,observedAt:input.request.departureAt};
  if(mode==='unknown')input.request.initialBatteryTemperatureC={origin:'unknown',value:null};
  const engine=new EnergyConsumptionEngine(),signal=new AbortController().signal,cache=new ProofEnergyReuse(engine,'regen');
  const native=await engine.evaluate(input,signal);
  expect(isDeepStrictEqual(await cache.evaluate(input,signal),native)).toBe(true);
  expect(isDeepStrictEqual(await cache.evaluate(input,signal),native)).toBe(true);
  expect(cache.stats.physicalCalls+cache.stats.hits).toBe(2);
  if(mode==='unknown')expect(cache.stats.hits).toBe(0);
  cache.dispose();expect(cache.stats.retainedUnits).toBe(0);
 });
 it.each(['minimum_total_duration','minimum_charging_stops','minimum_energy'] as const)('anchors the isolated before/proof seam to native production: %s',async objective=>{
  const settings={kind:'normal' as const,variant:'baseline' as const,objective,namespace:'test',metrics:true,trace:true};
  const native=await runEnergyProof({...settings,strategy:'native'}),a=await runEnergyProof({...settings,strategy:'bypass'}),b=await runEnergyProof({...settings,strategy:'reuse'});
  expect(()=>assertEnergyProofEquivalent(native,a)).not.toThrow();expect(()=>assertEnergyProofEquivalent(a,b)).not.toThrow();
 },30000);
});
