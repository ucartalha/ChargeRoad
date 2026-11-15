import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {isDeepStrictEqual} from 'node:util';
import * as ts from 'typescript';
import {EvPlanningService} from '../ev-planning.service';
import {ChargeStopOptimizer} from '../charge-stop-optimizer';
import {PlanningSession} from '../planning-session';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {ChargingCurveEngine} from '../../charging/charging-engine';
import {RoadProviderError} from '../../roads/road-client';
import * as sampler from '../../weather/weather-sampler';
import {WEATHER_POLICY,WEATHER_SAMPLING_POLICY} from '../../weather/weather-policy';
import {withPlanningMetrics,type PlanningMetricSnapshot} from '../../observability/planning-metrics';
import {eligibilityWorld,type EligibilityCase} from './eligibility-fixtures';
import {normalized,digest,type Objective} from './frontier-performance-harness';
import {SessionRepeatAudit,type AuditOperation} from './session-repeat-audit';

export const REPEAT_CASES=['normal','direct','catalogue_claims','catalogue_membership','corridors','equal_alternatives','opening_hours','stale','unknown_excluded','shared_pool','long_route','many_stations','sole_station',
 'soh','thermal','expired_weather','different_hour','weather_budget','road_budget','state_budget','cancel','quota','timeout'] as const;
export type RepeatCase=typeof REPEAT_CASES[number];
const signalData=(value:unknown)=>{
 if(value&&typeof value==='object'&&'aborted'in value&&'addEventListener'in value){const signal=value as AbortSignal;
  return {diagnosticSignalAborted:signal.aborted,deadlineEquivalence:'NOT_PROVEN'};}
 return value;
};
function memoryModule<T>(file:string,replacements:Record<string,unknown>):T{
 const filename=resolve(__dirname,'../'+file),source=readFileSync(filename,'utf8'),local=createRequire(filename),module={exports:{}};
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
 new Function('exports','require','module','__filename','__dirname',compiled)(module.exports,(name:string)=>Object.hasOwn(replacements,name)?replacements[name]:local(name),module,filename,dirname(filename));return module.exports as T;
}
let active:SessionRepeatAudit|undefined,ObservedService:typeof EvPlanningService|undefined;
function observedService(){
 if(ObservedService)return ObservedService;
 const session=memoryModule<{PlanningSession:typeof PlanningSession}>('planning-session.ts',{'../weather/weather-sampler':{...sampler,
  sampleRouteWeather:(...args:Parameters<typeof sampler.sampleRouteWeather>)=>active!.sync('sample_weather',args,()=>sampler.sampleRouteWeather(...args))}});
 for(const [method,operation] of [['drive','session_drive'],['charge','session_charge'],['route','session_route'],['weather','session_weather']] as const){
  const prototype=session.PlanningSession.prototype as unknown as Record<string,(...args:any[])=>Promise<unknown>>,original=prototype[method];
  prototype[method]=function(...args:any[]){const audit=active!;return audit.async(operation,args.map(signalData),()=>original.apply(this,args));};
 }
 ObservedService=memoryModule<{EvPlanningService:typeof EvPlanningService}>('ev-planning.service.ts',{'./planning-session':session}).EvPlanningService;return ObservedService;
}
function fixture(kind:RepeatCase){
 const base=(['equal_alternatives','soh','thermal','different_hour','expired_weather'].includes(kind)?'normal':kind) as EligibilityCase;
 const w=eligibilityWorld(base);
 if(kind==='soh')w.request.stateOfHealthPercent={origin:'user_input',value:80,observedAt:w.now};
 if(kind==='thermal')w.request.initialBatteryTemperatureC.value=20;
 if(kind==='different_hour')w.request.departureAt=new Date(Date.parse(w.request.departureAt)+3600000).toISOString();
 return w;
}
async function run(kind:RepeatCase,objective:Objective,observed:boolean,metricsEnabled=true){
 const w=fixture(kind),trace:[string,string][]=[],calls:Record<string,number>={},abort=new AbortController();w.request.policy.objective=objective;
 const audit=new SessionRepeatAudit(digest({version:'session-data-observation/1',weather:WEATHER_POLICY,sampling:WEATHER_SAMPLING_POLICY}),observed);active=audit;
 const call=<T extends(...args:any[])=>any>(role:string,operation:AuditOperation,fn:T)=>(...args:Parameters<T>):ReturnType<T>=>{
  calls[role]=(calls[role]??0)+1;trace.push([role,digest(normalized(args))]);
  return audit.async(operation,args.map(signalData),()=>fn(...args)) as ReturnType<T>;
 };
 const traceOnly=<T extends(...args:any[])=>any>(role:string,fn:T)=>(...args:Parameters<T>):ReturnType<T>=>{calls[role]=(calls[role]??0)+1;trace.push([role,digest(normalized(args))]);return fn(...args);};
 let road:(...args:Parameters<typeof w.roads.routes>)=>ReturnType<typeof w.roads.routes>=w.roads.routes;
 if(kind==='equal_alternatives'){w.preparation.road.alternatives=2;const fn=road;road=async(...args)=>{const r=await fn(...args);return {...r,data:{...r.data,routes:r.data.routes.flatMap(route=>[route,{...structuredClone(route),id:route.id+'-twin'}])}};};}
 if(kind==='quota')road=async()=>{throw new RoadProviderError('synthetic',429,60,'ROAD_PROVIDER_RATE_LIMITED');};
 if(kind==='timeout')road=async()=>{throw new RoadProviderError('synthetic',503,60,'ROAD_PROVIDER_TIMEOUT');};
 let forecast:(...args:Parameters<typeof w.weather.forecast>)=>ReturnType<typeof w.weather.forecast>=w.weather.forecast;
 if(kind==='expired_weather'){const fn=forecast;forecast=async(...args)=>{const r=await fn(...args);r.data.forEach(f=>f.forecastIssuedAt=new Date(Date.now()-7*86400000).toISOString());return r;};}
 const energy=new EnergyConsumptionEngine(),charging=new ChargingCurveEngine();energy.evaluate=call('energy','energy_evaluate',energy.evaluate.bind(energy));charging.evaluate=call('charging','charging_evaluate',charging.evaluate.bind(charging));
 const Service=observed?observedService():EvPlanningService;
 const service=new Service({resolveId:traceOnly('vehicle_id',w.vehicles.resolveId),profile:traceOnly('vehicle_profile',w.vehicles.profile)} as never,
  {routes:call('road','road_provider',road)} as never,{findAlongRoutes:traceOnly('stations',w.stations.findAlongRoutes)} as never,
  {forecast:call('weather','weather_provider',forecast)} as never,energy,charging,new ChargeStopOptimizer());
 if(kind==='cancel')abort.abort(new Error('synthetic_cancel'));let metrics:PlanningMetricSnapshot|undefined;
 const inputHash=digest(normalized({kind,request:w.request,options:w.options,preparation:w.preparation,vehicle:w.vehicle,candidates:w.candidates}));
 const execute=async()=>{try{return await service.plan(w.request,w.preparation,w.options,abort.signal);}catch(error){if(error!==abort.signal.reason)throw error;return {cancelled:true};}};
 const outcome=normalized(await withPlanningMetrics(w.request.requestId,execute,{enabled:metricsEnabled,scope:'benchmark',sink:s=>{metrics=s;}}));
 active=undefined;return {outcome,trace,calls,inputHash,metrics,audit:audit.stats};
}
export async function validateSessionRepeat(kind:RepeatCase,objective:Objective){
 const before=await run(kind,objective,false),observed=await run(kind,objective,true),off=await run(kind,objective,true,false);
 for(const next of [observed,off])if(!isDeepStrictEqual(before.outcome,next.outcome)||!isDeepStrictEqual(before.trace,next.trace)||!isDeepStrictEqual(before.calls,next.calls)||before.inputHash!==next.inputHash)throw new Error('SESSION_AUDIT_CHANGED_BEHAVIOR/'+kind+'/'+objective);
 if(!isDeepStrictEqual(before.metrics!.counters,observed.metrics!.counters)||off.metrics!==undefined)throw new Error('EXISTING_METRICS_CHANGED');
 if(kind==='normal'&&observed.audit.sample_weather.calls!==before.metrics!.counters.energy_evaluations)throw new Error('Sampling/energy accounting mismatch');
 return {kind,objective,inputHash:before.inputHash,outcomeHash:digest(before.outcome),traceHash:digest(before.trace),equivalent:true,status:before.outcome.result?.status??'cancelled',
  stoppedReason:before.outcome.search?.stoppedReason??null,calls:before.calls,existingCounters:observed.metrics!.counters,operations:observed.audit,
  savedProviderHttp:0,savedEnergyEvaluations:0,savedChargingEvaluations:0,savedPureComputations:0};
}
