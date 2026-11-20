/** Validation-only dependency substitution; the unmodified coordinator/session/real engines execute. */
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {isDeepStrictEqual} from 'node:util';
import * as ts from 'typescript';
import {EvPlanningService} from '../ev-planning.service';
import {PlanningSession} from '../planning-session';
import {ChargeStopOptimizer} from '../charge-stop-optimizer';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {ChargingCurveEngine} from '../../charging/charging-engine';
import {RoadProviderError} from '../../roads/road-client';
import {withPlanningMetrics,type PlanningMetricSnapshot} from '../../observability/planning-metrics';
import {eligibilityWorld,type EligibilityCase} from './eligibility-fixtures';
import {REPEAT_CASES,type RepeatCase} from './session-repeat-validation';
import {digest,normalized,type Objective} from './frontier-performance-harness';
import {ProofEnergyReuse,freshProofStats,proofCanonical,cloneProofPlain,type ProofStats} from './energy-reuse-proof';

export const PROOF_VARIANTS=['baseline','soh90','thermal_provenance'] as const;
export type ProofVariant=typeof PROOF_VARIANTS[number];
export type ProofStrategy='native'|'bypass'|'reuse';
export const PROOF_PROFILES=['small','medium','large','repeat_dense','repeat_sparse'] as const;
export type ProofProfile=typeof PROOF_PROFILES[number];
export const PROOF_CONFIG={warmups:2,blocks:4,processes:3,concurrency:1,capacity:16,maxRetainedUnits:2*1024*1024,
 p95RegressionPercent:5,requiredWallGainPercent:5,requiredCpuGainPercent:5} as const;
function exactOutcome(value:unknown){
 const result=cloneProofPlain(value),visit=(v:unknown)=>{if(v&&typeof v==='object')for(const key of Object.keys(v)){
  if(key==='elapsedMilliseconds')delete (v as Record<string,unknown>)[key];else visit((v as Record<string,unknown>)[key]);}};
 visit(result);return result;
}

function world(kind:RepeatCase,variant:ProofVariant){
 const base=(['equal_alternatives','soh','thermal','different_hour','expired_weather'].includes(kind)?'normal':kind) as EligibilityCase,w=eligibilityWorld(base);
 if(kind==='soh')w.request.stateOfHealthPercent={origin:'user_input',value:80,observedAt:w.now};
 if(kind==='thermal')w.request.initialBatteryTemperatureC.value=20;
 if(kind==='different_hour')w.request.departureAt=new Date(Date.parse(w.request.departureAt)+3600000).toISOString();
 if(variant==='soh90')w.request.stateOfHealthPercent={origin:'user_input',value:90,observedAt:w.now};
 if(variant==='thermal_provenance')w.request.initialBatteryTemperatureC={origin:'estimated',value:w.request.initialBatteryTemperatureC.value??30,estimatedAt:w.now,validAt:w.request.departureAt,modelVersion:'synthetic-provenance/1'};
 return w;
}
interface Scope {cache?:ProofEnergyReuse;logical:number;physical:number;}
function isolatedService(Session:typeof PlanningSession){
 const filename=resolve(__dirname,'../ev-planning.service.ts'),local=createRequire(filename),module={exports:{} as {EvPlanningService:typeof EvPlanningService}};
 const js=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
 new Function('exports','require','module','__filename','__dirname',js)(module.exports,(name:string)=>name==='./planning-session'?{PlanningSession:Session}:local(name),module,filename,dirname(filename));
 return module.exports.EvPlanningService;
}
export interface ProofRunOptions {strategy:ProofStrategy;kind:RepeatCase;variant:ProofVariant;objective:Objective;namespace:string;
 metrics?:boolean;trace?:boolean;profile?:ProofProfile;}
export async function runEnergyProof(options:ProofRunOptions){
 const w=world(options.kind,options.variant),scopes:Scope[]=[],trace:[string,string][]=[],calls:Record<string,number>={},cancel=new AbortController();
 w.request.policy.objective=options.objective;
 if(options.profile){w.options.maxStates=options.profile==='small'?2:options.profile==='medium'?16:options.profile==='large'?8:12;}
 const record=(role:string,args:unknown[])=>{calls[role]=(calls[role]??0)+1;if(options.trace)trace.push([role,digest(proofCanonical(args.map(v=>v instanceof AbortSignal?{aborted:v.aborted}:v),8*1024*1024,false,200000).key)]);};
 const wrap=<T extends(...args:any[])=>any>(role:string,fn:T)=>(...args:Parameters<T>):ReturnType<T>=>{record(role,args);return fn(...args);};
 let road:(...args:Parameters<typeof w.roads.routes>)=>ReturnType<typeof w.roads.routes>=w.roads.routes;
 let forecast:(...args:Parameters<typeof w.weather.forecast>)=>ReturnType<typeof w.weather.forecast>=w.weather.forecast;
 if(options.kind==='equal_alternatives'){w.preparation.road.alternatives=2;const fn=road;road=async(...args)=>{const r=await fn(...args);return {...r,data:{...r.data,routes:r.data.routes.flatMap(route=>[route,{...structuredClone(route),id:route.id+'-twin'}])}};};}
 if(options.kind==='quota')road=async()=>{throw new RoadProviderError('synthetic',429,60,'ROAD_PROVIDER_RATE_LIMITED');};
 if(options.kind==='timeout')road=async()=>{throw new RoadProviderError('synthetic',503,60,'ROAD_PROVIDER_TIMEOUT');};
 if(options.kind==='expired_weather'){const fn=forecast;forecast=async(...args)=>{const r=await fn(...args);r.data.forEach(f=>f.forecastIssuedAt=new Date(Date.now()-7*86400000).toISOString());return r;};}
 const energy=new EnergyConsumptionEngine(),nativeEvaluate=energy.evaluate.bind(energy);let totalPhysical=0,totalLogical=0;
 energy.evaluate=(raw,signal)=>{totalPhysical++;return nativeEvaluate(raw,signal);};
 const logicalNative={evaluate:(raw:unknown,signal:AbortSignal)=>{totalLogical++;record('energy_intent',[raw]);return energy.evaluate(raw,signal);}} as EnergyConsumptionEngine;
 class Session extends PlanningSession {
  constructor(...args:ConstructorParameters<typeof PlanningSession>){
   const scope:Scope={logical:0,physical:0};
   const cache=options.strategy==='reuse'?new ProofEnergyReuse(energy,options.namespace,options.metrics,PROOF_CONFIG.capacity,PROOF_CONFIG.maxRetainedUnits):undefined;
   scope.cache=cache;scopes.push(scope);
   const proxy={evaluate:(raw:unknown,signal:AbortSignal)=>{scope.logical++;totalLogical++;record('energy_intent',[raw]);
    return cache?cache.evaluate(raw,signal,args[6]):energy.evaluate(raw,signal);}} as EnergyConsumptionEngine;
   super(args[0],args[1],args[2],proxy,args[4],args[5],args[6],args[7]);
  }
 }
 // Module compilation is outside plan timing; no global module/prototype/cache is patched.
 const Service=options.strategy==='native'?EvPlanningService:isolatedService(Session),charging=new ChargingCurveEngine();
 charging.evaluate=wrap('charging',charging.evaluate.bind(charging)) as typeof charging.evaluate;
 const service=new Service({resolveId:wrap('vehicle_id',w.vehicles.resolveId),profile:wrap('vehicle_profile',w.vehicles.profile)} as never,
  {routes:wrap('road',road)} as never,{findAlongRoutes:wrap('stations',w.stations.findAlongRoutes)} as never,{forecast:wrap('weather',forecast)} as never,
  logicalNative,charging,new ChargeStopOptimizer());
 if(options.kind==='cancel')cancel.abort(new Error('synthetic_cancel'));
 const fixtureHash=digest({kind:options.kind,variant:options.variant,profile:options.profile,request:w.request,vehicle:w.vehicle,candidates:w.candidates,options:w.options,preparation:w.preparation});
 let metrics:PlanningMetricSnapshot|undefined;
 const execute=async()=>{try{return await service.plan(w.request,w.preparation,w.options,cancel.signal);}catch(error){if(error!==cancel.signal.reason)throw error;return {cancelled:true};}};
 const cpu=process.cpuUsage(),heapBefore=process.memoryUsage().heapUsed,start=performance.now();
 const outcome=await withPlanningMetrics(w.request.requestId,execute,{enabled:options.metrics??false,scope:'benchmark',sink:s=>{metrics=s;}});
 // Include cache teardown in the measured lifecycle; no retained results escape this solve.
 for(const scope of scopes)scope.cache?.dispose();
 const wallMs=performance.now()-start,cpuUsed=process.cpuUsage(cpu),heapAfter=process.memoryUsage().heapUsed,stats=freshProofStats();
 const peaks=new Set(['entriesPeak','retainedPeak','nodesPeak']);
 for(const scope of scopes)if(scope.cache)for(const key of Object.keys(stats) as (keyof ProofStats)[])
  stats[key]=peaks.has(key)?Math.max(stats[key],scope.cache.stats[key]):stats[key]+scope.cache.stats[key];
 const exact=exactOutcome(outcome);
 return {outcome:exact,fixtureHash,outputHash:digest(proofCanonical(exact,32*1024*1024,false,1000000).key),traceHash:options.trace?digest(trace):null,calls,
  logicalEnergyCalls:totalLogical,physicalEnergyCalls:totalPhysical,cache:stats,metrics:metrics??null,wallMs,cpuUserMs:cpuUsed.user/1000,cpuSystemMs:cpuUsed.system/1000,
  heapBefore,heapAfter,window:{start,end:start+wallMs},retainedAfterDispose:stats.retainedUnits,status:(outcome as any).result?.status??'cancelled'};
}
export function assertEnergyProofEquivalent(a:Awaited<ReturnType<typeof runEnergyProof>>,b:Awaited<ReturnType<typeof runEnergyProof>>){
 const mismatches=[!isDeepStrictEqual(a.outcome,b.outcome)?'outcome':null,a.fixtureHash!==b.fixtureHash?'fixture':null,a.outputHash!==b.outputHash?'output_hash':null,
  a.traceHash!==b.traceHash?'trace':null,!isDeepStrictEqual(a.calls,b.calls)?'calls':null,a.logicalEnergyCalls!==b.logicalEnergyCalls?'logical_energy':null].filter(Boolean);
 if(mismatches.length)throw Error('ENERGY_REUSE_SEMANTIC_MISMATCH/'+mismatches.join(','));
 if(a.metrics&&b.metrics&&!isDeepStrictEqual(a.metrics.counters,b.metrics.counters))throw Error('ENERGY_REUSE_ACCOUNTING_MISMATCH');
 if(a.physicalEnergyCalls-b.physicalEnergyCalls!==b.cache.hits-a.cache.hits||b.retainedAfterDispose!==0)throw Error('ENERGY_REUSE_PHYSICAL_ACCOUNTING_MISMATCH');
}
export const proofScenarioKinds=REPEAT_CASES;
