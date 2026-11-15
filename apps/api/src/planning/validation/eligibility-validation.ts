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
import {withPlanningMetrics,type PlanningMetricSnapshot} from '../../observability/planning-metrics';
import {eligibilityWorld,type EligibilityCase} from './eligibility-fixtures';
import {normalized,digest,type Objective} from './frontier-performance-harness';

/** In-memory historical comparator: only new shadow import/call lines removed.
 * Rest of coordinator/session source is identical; no alternative solver copy.
 */
function withoutShadow<T>(file:string,imports:string[],calls:string[],replacements:Record<string,unknown>={}):T {
 const filename=resolve(__dirname,'../'+file);let source=readFileSync(filename,'utf8');
 for(const line of [...imports,...calls]){if(source.split(line).length!==2)throw new Error('Shadow validation seam changed');source=source.replace(line,'');}
 const javascript=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
 const module={exports:{}},original=createRequire(filename),lookup=(id:string)=>Object.hasOwn(replacements,id)?replacements[id]:original(id);
 new Function('exports','require','module','__filename','__dirname',javascript)(module.exports,lookup,module,filename,dirname(filename));return module.exports as T;
}
let historical:typeof EvPlanningService|undefined;
function beforeService(){
 if(!historical){const session=withoutShadow<{PlanningSession:typeof PlanningSession}>('planning-session.ts',
  ["import {observeCandidateCall} from './candidate-eligibility-shadow';"],["    observeCandidateCall(this.context,to.id,'drive');","    observeCandidateCall(this.context,state.nodeId,'charge');"]);
  historical=withoutShadow<{EvPlanningService:typeof EvPlanningService}>('ev-planning.service.ts',
   ["import {observeCandidateEligibility} from './candidate-eligibility-shadow';"],['        observeCandidateEligibility(all,context);'],{'./planning-session':session}).EvPlanningService;
 }return historical;
}
async function run(kind:EligibilityCase,objective:Objective,shadow:boolean,enabled=true){
 const w=eligibilityWorld(kind),trace:[string,string][]=[],counts:Record<string,number>={},abort=new AbortController();
 const wrap=<T extends(...args:any[])=>any>(role:string,operation:T)=>(...args:Parameters<T>):ReturnType<T>=>{
  counts[role]=(counts[role]??0)+1;trace.push([role,digest(normalized(args))]);return operation(...args);
 };
 const vehicles={resolveId:wrap('vehicle_id',w.vehicles.resolveId),profile:wrap('vehicle_profile',w.vehicles.profile)};
 let roads=w.roads.routes;
 if(kind==='quota')roads=(async()=>{throw new RoadProviderError('synthetic_quota',429,60,'ROAD_PROVIDER_RATE_LIMITED');}) as typeof roads;
 if(kind==='timeout')roads=(async()=>{throw new RoadProviderError('synthetic_timeout',503,60,'ROAD_PROVIDER_TIMEOUT');}) as typeof roads;
 const routing={routes:wrap('road',roads)},stations={findAlongRoutes:wrap('stations',w.stations.findAlongRoutes)},weather={forecast:wrap('weather',w.weather.forecast)};
 const energy=new EnergyConsumptionEngine(),charging=new ChargingCurveEngine();energy.evaluate=wrap('energy',energy.evaluate.bind(energy));charging.evaluate=wrap('charging',charging.evaluate.bind(charging));
 let ticks=0;const optimizer=kind==='deadline'?new ChargeStopOptimizer(()=>++ticks>3?1e9:0):new ChargeStopOptimizer();
 const Service=shadow?EvPlanningService:beforeService(),service=new Service(vehicles as never,routing as never,stations as never,weather as never,energy,charging,optimizer);
 const inputHash=digest(normalized({kind,request:w.request,options:w.options,preparation:w.preparation,candidates:w.candidates,vehicle:w.vehicle}));
 let metrics:PlanningMetricSnapshot|undefined;
 if(kind==='cancel')abort.abort(new Error('synthetic_cancel'));
 const operation=async()=>{try{return await service.plan(w.request,w.preparation,w.options,abort.signal);}catch(error){if(error!==abort.signal.reason)throw error;return {cancelled:true};}};
 const outcome=await withPlanningMetrics(w.request.requestId,operation,{enabled,scope:'benchmark',sink:s=>{metrics=s;}});
 return {outcome:normalized(outcome),trace,inputHash,metrics,counts};
}
export async function validateEligibilityCase(kind:EligibilityCase,objective:Objective){
 const before=await run(kind,objective,false),after=await run(kind,objective,true),disabled=await run(kind,objective,true,false);
 if(['normal','direct','sole_station','long_route','many_stations','catalogue_claims'].includes(kind)&&before.outcome.result?.status!=='planned')throw new Error('EXPECTED_PLANNED_FIXTURE/'+kind);
 for(const next of [after,disabled])if(!isDeepStrictEqual(before.outcome,next.outcome)||!isDeepStrictEqual(before.trace,next.trace)||before.inputHash!==next.inputHash||!isDeepStrictEqual(before.counts,next.counts))
  throw new Error('ELIGIBILITY_BEHAVIOR_CHANGED/'+kind+'/'+objective);
 if(disabled.metrics!==undefined)throw new Error('DISABLED_OBSERVATION_EMITTED');
 const beforeMetrics=before.metrics!,afterMetrics=after.metrics!;
 for(const key of Object.keys(beforeMetrics.counters))if(!key.startsWith('candidate_')&&beforeMetrics.counters[key as keyof typeof beforeMetrics.counters]!==afterMetrics.counters[key as keyof typeof afterMetrics.counters])throw new Error('EXISTING_COUNTER_CHANGED');
 const counters=Object.fromEntries(Object.entries(afterMetrics.counters).filter(([key])=>key.startsWith('candidate_')));
 return {kind,objective,inputHash:before.inputHash,outcomeHash:digest(before.outcome),traceHash:digest(before.trace),equivalent:true,
  status:before.outcome.result?.status??'cancelled',reasonCodes:before.outcome.result?.reasons?.map((r:{code:string})=>r.code)??[],stoppedReason:before.outcome.search?.stoppedReason??null,
  calls:before.counts,shadow:counters,classificationMs:afterMetrics.stages.candidate_eligibility?.totalMs??null,
  potentialCallObservationMs:afterMetrics.stages.candidate_call_shadow?.totalMs??null,actualAvoidedProviderCalls:0,actualAvoidedEngineCalls:0};
}
