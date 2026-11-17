import {ChargeStopOptimizer} from '../charge-stop-optimizer';
import {PlanningSession} from '../planning-session';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {ChargingCurveEngine} from '../../charging/charging-engine';
import type {PlanningContext} from '../optimizer-types';
import {optimizerWorld} from './optimizer.fixtures';

// E1: search-time energy evaluations skip the unpublished input checksum; plan outcomes must not change.
type Options=Parameters<EnergyConsumptionEngine['evaluate']>[2];
class EagerEngine extends EnergyConsumptionEngine {
  readonly seen:(Options|undefined)[]=[];
  evaluate(raw:unknown,signal:AbortSignal,options?:Options):never{this.seen.push(options);return super.evaluate(raw,signal) as never;}
}
class ObservedEngine extends EnergyConsumptionEngine {
  readonly seen:(Options|undefined)[]=[];
  evaluate(raw:unknown,signal:AbortSignal,options?:Options):never{this.seen.push(options);return super.evaluate(raw,signal,options as never) as never;}
}
const timers=['hrtime','nextTick','performance','queueMicrotask','requestAnimationFrame','cancelAnimationFrame','requestIdleCallback','cancelIdleCallback',
  'setImmediate','clearImmediate','setInterval','clearInterval','setTimeout','clearTimeout'] as const;
async function solve(engine:EnergyConsumptionEngine,objective:string,maxStates:number){
  // The fixture reads the wall clock; pin only Date so both arms see identical inputs.
  jest.useFakeTimers({now:Date.parse('2026-11-17T09:00:00Z'),doNotFake:[...timers]});
  const w=optimizerWorld();w.request.policy.objective=objective as never;w.options.maxStates=maxStates;
  const context:PlanningContext={request:w.request,vehicle:w.vehicle,evaluatedAt:w.now,options:w.options,candidates:w.candidates,
    nodes:Object.entries(w.locations).map(([id,location])=>({id,location,stationId:['origin','destination'].includes(id)?null:id})),baseRoutes:[w.route('origin','destination')]};
  const session=new PlanningSession(context,w.roads as never,w.weather as never,engine,new ChargingCurveEngine(),w.preparation.road,performance.now()+60000,context.baseRoutes);
  const outcome=await new ChargeStopOptimizer(()=>0).solve(context,session,new AbortController().signal);
  return JSON.parse(JSON.stringify(outcome,(key,value)=>key==='elapsedMilliseconds'?0:value));
}

afterEach(()=>jest.useRealTimers());
describe('Search energy evaluations without input checksum',()=>{
  it.each([
    ['minimum_total_duration',256],['minimum_charging_stops',256],['minimum_energy',256],['minimum_total_duration',2],
  ])('keeps the full optimizer outcome identical: %s / maxStates %i',async(objective,maxStates)=>{
    const eager=new EagerEngine(),observed=new ObservedEngine();
    const before=await solve(eager,objective,maxStates),after=await solve(observed,objective,maxStates);
    // Published parts are byte-identical.
    for(const key of ['result','validationInput','search'])expect(after[key]).toStrictEqual(before[key]);
    // The optimizer's internal replay snapshot differs only by the omitted per-leg energy checksum.
    const removed:string[]=[];
    const strip=(value:unknown,path:string):unknown=>Array.isArray(value)?value.map((v,i)=>strip(v,path+'/'+i)):value!==null&&typeof value==='object'?
      Object.fromEntries(Object.entries(value).filter(([k])=>k!=='inputChecksumSha256'||(removed.push(path),false)).map(([k,v])=>[k,strip(v,path+'/'+k)])):value;
    expect(after).toStrictEqual(strip(before,''));
    expect(removed.length).toBeGreaterThan(0);expect(removed.every(p=>/^\/replay\/state\/legs\/\d+\/energy$/.test(p))).toBe(true);
    expect(JSON.stringify(after)).not.toContain('inputChecksumSha256');
    expect(observed.seen.length).toBeGreaterThan(0);expect(observed.seen.length).toBe(eager.seen.length);
    expect(observed.seen.every(o=>o?.inputChecksum===false)).toBe(true);
  });
});
