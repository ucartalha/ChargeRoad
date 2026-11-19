import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import * as ts from 'typescript';
import {ChargeStopOptimizer} from '../charge-stop-optimizer';
import {EvPlanningService} from '../ev-planning.service';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {ChargingCurveEngine} from '../../charging/charging-engine';
import {withPlanningMetrics,type PlanningMetricSnapshot} from '../../observability/planning-metrics';
import {RoadProviderError} from '../../roads/road-client';
import {eligibilityCases,eligibilityWorld,type EligibilityCase} from './eligibility-fixtures';
import {normalized,digest,type Objective} from './frontier-performance-harness';
import {STATE_SHADOW_COUNTERS} from '../state-dominance';
import {OPTIMIZER_VERSION} from '../optimizer-policy';
export const stateCases=[...eligibilityCases,'equal_alternatives','transition_budget','frontier_budget','incumbent_state','incumbent_frontier','regen','thermal','temperature_provenance','capacity_observed','seeded_graph_1','seeded_graph_2'] as const;
export type StateCase=typeof stateCases[number];
let previous:typeof ChargeStopOptimizer|undefined;
export function previousStateOptimizer(){
 if(previous)return previous;
 const filename=resolve(__dirname,'../charge-stop-optimizer.ts');let source=readFileSync(filename,'utf8');
 for(const expression of ["import {createStateShadow} from './state-dominance-shadow';\n",'    const observeState=createStateShadow();observeState(initial);\n','observeState(next);']){
  if(source.split(expression).length!==2)throw new Error('State observation seam changed');source=source.replace(expression,'');
 }
 const baseline=JSON.parse(readFileSync(resolve(__dirname,'../../../../../docs/validation/state-dominance-baseline-2026-11-15.json'),'utf8'));
 const hash=createHash('sha256').update(source).digest('hex');
 // The old checkpoint stays immutable. Product v1.1 intentionally changes search; compare its
 // current algorithm with the same algorithm minus shadow, bound to a separate reviewed checkpoint.
 const checkpoint=({'chargeroad-optimizer/1.7.0':'charge-to-need-shadow-source-v2-2026-11-19.json','chargeroad-optimizer/1.6.1':'station-weather-bound-shadow-source-2026-11-19.json','chargeroad-optimizer/1.6.0':'arrival-target-fallback-shadow-source-2026-11-17.json','chargeroad-optimizer/1.5.0':'seed-strategies-shadow-source-2026-11-17.json','chargeroad-optimizer/1.4.0':'charged-state-dedup-shadow-source-2026-11-17.json','chargeroad-optimizer/1.3.0':'seed-fallback-shadow-source-2026-11-17.json','chargeroad-optimizer/1.2.0':'adaptive-weather-shadow-source-2026-11-16.json'} as Record<string,string>)[OPTIMIZER_VERSION]??'charge-target-shadow-source-2026-11-15.json';
 const current=JSON.parse(readFileSync(resolve(__dirname,'../../../../../docs/validation/'+checkpoint),'utf8'));
 if(hash!==baseline.optimizerBeforeRawSha256&&(current.optimizerVersion!==OPTIMIZER_VERSION||hash!==current.optimizerWithoutShadowSha256))throw new Error('Before optimizer source hash mismatch');
 const javascript=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{} as {ChargeStopOptimizer:typeof ChargeStopOptimizer}};
 new Function('exports','require','module','__filename','__dirname',javascript)(module.exports,createRequire(filename),module,filename,dirname(filename));
 previous=module.exports.ChargeStopOptimizer;return previous;
}
function world(kind:StateCase){
 const w=eligibilityWorld(eligibilityCases.includes(kind as EligibilityCase)?kind as EligibilityCase:'normal');
 let roads:(...args:Parameters<typeof w.roads.routes>)=>ReturnType<typeof w.roads.routes>=w.roads.routes;
 if(kind==='equal_alternatives'){w.preparation.road.alternatives=2;const fn=roads;roads=async(...args)=>{const r=await fn(...args);return {...r,data:{...r.data,routes:r.data.routes.flatMap(route=>[route,{...structuredClone(route),id:route.id+'-twin'}])}};};}
 if(kind==='transition_budget')w.options.maxTransitions=1;
 if(kind==='frontier_budget')w.options.maxFrontier=1;
 if(kind==='incumbent_state'||kind==='incumbent_frontier'){
  w.request.startingChargePercent=100;w.request.constraints={minimumReserveChargePercent:0,targetArrivalChargePercent:0};
  if(kind==='incumbent_state')w.options.maxStates=1;else w.options.maxFrontier=1;
 }
 if(kind==='thermal'){w.request.initialBatteryTemperatureC.value=20;w.vehicle.energyModel!.capacityTemperatureCurve=[{temperatureC:0,factor:.8},{temperatureC:30,factor:1}];}
 if(kind==='temperature_provenance')w.request.initialBatteryTemperatureC={origin:'estimated',value:30,estimatedAt:w.now,validAt:w.request.departureAt,modelVersion:'synthetic-estimate/1'};
 if(kind==='capacity_observed')w.request.stateOfHealthPercent={origin:'user_input',value:80,observedAt:w.now};
 if(kind==='regen'){
  const fn=roads;roads=async(...args)=>{const r=await fn(...args);for(const route of r.data.routes)for(const s of route.segments){
   const start=100*(1-s.startDistanceMeters/route.distanceMeters),end=100*(1-s.endDistanceMeters/route.distanceMeters);
   s.elevationProfile=[{distanceFromStartMeters:0,elevationMeters:start},{distanceFromStartMeters:s.distanceMeters,elevationMeters:end}];s.elevationGainMeters=0;s.elevationLossMeters=start-end;
  }return r;};
 }
 let graphHash:string|null=null;
 if(kind.startsWith('seeded_graph')){
  let seed=kind==='seeded_graph_1'?20261115:42;const factors:Record<string,number>={};
  const nodes=Object.keys(w.locations);for(const a of nodes)for(const b of nodes)if(a!==b){seed=(Math.imul(seed,1664525)+1013904223)>>>0;factors[a+'>'+b]=.9+(seed%200)/1000;}
  graphHash=digest(factors);const fn=roads;
  roads=async(...args)=>{const r=await fn(...args),loc=(p:{latitude:number;longitude:number})=>nodes.find(k=>Math.abs(w.locations[k].latitude-p.latitude)<1e-9&&Math.abs(w.locations[k].longitude-p.longitude)<1e-9)!;
   const factor=factors[loc(args[0].origin)+'>'+loc(args[0].destination)];
   for(const route of r.data.routes){route.drivingDurationSeconds*=factor;for(const s of route.segments){s.drivingDurationSeconds*=factor;s.expectedSpeedKph=s.distanceMeters/s.drivingDurationSeconds*3.6;}}
   return r;
  };
 }
 return {...w,roads:{routes:roads},graphHash};
}
async function run(kind:StateCase,objective:Objective,after:boolean,enabled=true){
 const w=world(kind),trace:[string,string][]=[],counts:Record<string,number>={},cancel=new AbortController();
 w.request.policy.objective=objective;
 const wrap=<T extends(...args:any[])=>any>(role:string,operation:T)=>(...args:Parameters<T>):ReturnType<T>=>{counts[role]=(counts[role]??0)+1;trace.push([role,digest(normalized(args))]);return operation(...args);};
 const vehicles={resolveId:wrap('vehicle_id',w.vehicles.resolveId),profile:wrap('vehicle_profile',w.vehicles.profile)};
 let road=w.roads.routes;
 if(kind==='quota')road=async()=>{throw new RoadProviderError('synthetic',429,60,'ROAD_PROVIDER_RATE_LIMITED');};
 if(kind==='timeout')road=async()=>{throw new RoadProviderError('synthetic',503,60,'ROAD_PROVIDER_TIMEOUT');};
 const routing={routes:wrap('road',road)},stations={findAlongRoutes:wrap('stations',w.stations.findAlongRoutes)},weather={forecast:wrap('weather',w.weather.forecast)};
 const energy=new EnergyConsumptionEngine(),charging=new ChargingCurveEngine();energy.evaluate=wrap('energy',energy.evaluate.bind(energy) as (...args:unknown[])=>Promise<unknown>) as typeof energy.evaluate;charging.evaluate=wrap('charging',charging.evaluate.bind(charging));
 const Optimizer=after?ChargeStopOptimizer:previousStateOptimizer();let ticks=0;
 const optimizer=kind==='deadline'?new Optimizer(()=>++ticks>3?1e9:0):new Optimizer();
 const service=new EvPlanningService(vehicles as never,routing as never,stations as never,weather as never,energy,charging,optimizer);
 const inputHash=digest(normalized({kind,graphHash:w.graphHash,request:w.request,options:w.options,preparation:w.preparation,candidates:w.candidates,vehicle:w.vehicle}));
 if(kind==='cancel')cancel.abort(new Error('synthetic_cancel'));let metrics:PlanningMetricSnapshot|undefined;
 const operation=async()=>{try{return await service.plan(w.request,w.preparation,w.options,cancel.signal);}catch(error){if(error!==cancel.signal.reason)throw error;return {cancelled:true};}};
 const outcome=normalized(await withPlanningMetrics(w.request.requestId,operation,{enabled,scope:'benchmark',sink:s=>{metrics=s;}}));
 if(outcome.search&&outcome.search.objective!==objective)throw new Error('STATE_OBJECTIVE_NOT_APPLIED');
 return {outcome,inputHash,trace,counts,metrics,actualObjective:w.request.policy.objective};
}
// Diagnostic pointers contain field names/indices only, never fixture values.
function firstDifference(a:any,b:any,path=''):string|null {
 if(isDeepStrictEqual(a,b))return null;
 if(!a||!b||typeof a!=='object'||typeof b!=='object')return path||'/';
 for(const key of new Set([...Object.keys(a),...Object.keys(b)])){
  const next=path+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1');
  if(!Object.prototype.hasOwnProperty.call(a,key)||!Object.prototype.hasOwnProperty.call(b,key))return next;
  const different=firstDifference(a[key],b[key],next);if(different)return different;
 }
 return path||'/';
}
export async function validateStateCase(kind:StateCase,objective:Objective){
 const phases:Record<string,number>={};
 const timed=async(name:string,after:boolean,enabled=true)=>{const start=performance.now();try{return await run(kind,objective,after,enabled);}finally{phases[name]=performance.now()-start;}};
 const before=await timed('before',false),after=await timed('after',true),off=await timed('off',true,false);
 for(const [phase,value] of [['after',after],['off',off]] as const){
  const pointer=firstDifference({outcome:before.outcome,trace:before.trace,counts:before.counts,inputHash:before.inputHash},{outcome:value.outcome,trace:value.trace,counts:value.counts,inputHash:value.inputHash});
  if(pointer)throw Object.assign(new Error('STATE_SHADOW_BEHAVIOR_CHANGED/'+kind+'/'+objective+'/'+phase+pointer),{validationPhases:phases});
 }
 if(off.metrics!==undefined)throw new Error('DISABLED_STATE_METRICS');
 const original=before.metrics!.counters,current=after.metrics!.counters,newKeys=new Set<string>(STATE_SHADOW_COUNTERS);
 for(const key of Object.keys(original))if(!newKeys.has(key)&&original[key as keyof typeof original]!==current[key as keyof typeof current])throw new Error('ORIGINAL_OR_ELIGIBILITY_COUNTER_CHANGED');
 if(current.actual_pruned_states!==0)throw new Error('ACTIVE_PRUNING_FORBIDDEN');
 if(['incumbent_state','incumbent_frontier','direct','sole_station','normal','many_stations','long_route'].includes(kind)&&before.outcome.result?.status!=='planned')throw new Error('EXPECTED_VALIDATED_PLAN/'+kind);
 return {baselineVersion:'state-objective-real/v2',kind,objective,actualObjectives:[before.actualObjective,after.actualObjective,off.actualObjective],phaseInputHashes:[before.inputHash,after.inputHash,off.inputHash],phases,inputHash:before.inputHash,outcomeHash:digest(before.outcome),traceHash:digest(before.trace),equivalent:true,status:before.outcome.result?.status??'cancelled',
  stoppedReason:before.outcome.search?.stoppedReason??null,reasonCodes:before.outcome.result?.reasons?.map((r:{code:string})=>r.code)??[],calls:before.counts,
  previousEligibilityCounters:Object.fromEntries(Object.entries(current).filter(([key])=>key.startsWith('candidate_'))),
  shadow:Object.fromEntries(STATE_SHADOW_COUNTERS.map(key=>[key,current[key]])),shadowEvaluationMs:after.metrics!.stages.state_shadow?.totalMs??null,
  actualSavedProviderCalls:0,actualSavedEngineCalls:0};
}
