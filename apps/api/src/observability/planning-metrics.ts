import {AsyncLocalStorage} from 'node:async_hooks';
import {Logger,HttpException} from '@nestjs/common';
import {OPTIMIZER_VERSION} from '../planning/optimizer-policy';
import {ENERGY_ALGORITHM_VERSION} from '../energy/energy-policy';
import {CHARGING_ALGORITHM_VERSION} from '../charging/charging-engine';
import {STATE_SHADOW_COUNTERS} from '../planning/state-dominance';

export const metricStages=['vehicle_profile','base_road','station_corridor','road_leg_acquisition','road_http','weather_http','weather_cache_acquisition','weather_sampling','weather_acquisition',
 'energy_evaluation','charge_integration','optimizer_search','plan_compile','http_plan','response_preflight_serialize','json_serialize','gzip','job_execute','job_wait','candidate_eligibility','candidate_call_shadow','state_shadow'] as const;
export const metricCounters=['road_leg_acquisitions','road_session_cache_hits','weather_session_cache_hits','weather_sample_queries','weather_forecast_query_items','weather_sample_evaluations',
 'energy_evaluations','charge_integrations','frontier_peak','expanded_states','transitions','road_queries_budgeted','weather_queries_budgeted',
 'road_pg_cache_hits','road_pg_cache_misses','road_cache_coalesced_hits','weather_pg_cache_hits','weather_pg_cache_misses','weather_cache_coalesced','road_memory_cache_hits',
 'road_http_acquisitions','weather_http_acquisitions','response_decoded_bytes','response_wire_bytes','cancelled','timeout',
 'candidate_eligibility_total','candidate_selected_total','candidate_eligibility_eligible','candidate_eligibility_uncertain','candidate_eligibility_provably_ineligible',
 'candidate_reject_public_access','candidate_reject_membership','candidate_reject_lifecycle','candidate_potential_drive_calls','candidate_potential_charge_calls',
 ...STATE_SHADOW_COUNTERS] as const;
type Stage=typeof metricStages[number];type Counter=typeof metricCounters[number];
type StageValue={count:number;totalMs:number;maxMs:number;active:number};
type Scope='planner'|'http_plan'|'job_execute'|'job_result'|'benchmark'|'provider_smoke';
export type PlanningMetricSnapshot={event:'planning_metrics';version:'planning-metrics/1.0.0';requestId:string;scope:Scope;
 algorithms:{optimizer:string;energy:string;charging:string};
 durationMs:number;outcome:string;incomplete:boolean;stages:Partial<Record<Stage,StageValue>>;counters:Record<Counter,number>};
type Context={snapshot:PlanningMetricSnapshot;closed:boolean};
const local=new AsyncLocalStorage<Context>(),logger=new Logger('PlanningMetrics'),noop=()=>{};
export function planningMetricsActive(){const context=local.getStore();return !!context&&!context.closed;}
const stageNames=new Set<string>(metricStages);
const statuses=new Set(['planned','infeasible','insufficient_data','provider_error','computation_limit','cancelled','timeout','error','success']);
function errorName(error:unknown){try{return error&&typeof error==='object'&&'name'in error?error.name:'';}catch{return '';}}
function isTimeout(error:unknown){if(errorName(error)==='TimeoutError')return true;try{const p=error instanceof HttpException?error.getResponse():null;
 return !!p&&typeof p==='object'&&'code'in p&&p.code==='PLANNING_REQUEST_DEADLINE';}catch{return false;}}
export function countMetric(name:Counter,amount=1){const c=local.getStore();if(c&&!c.closed&&Object.hasOwn(c.snapshot.counters,name)&&Number.isFinite(amount)&&amount>=0)c.snapshot.counters[name]+=amount;}
export function maxMetric(name:Counter,value:number){const c=local.getStore();if(c&&!c.closed&&Object.hasOwn(c.snapshot.counters,name)&&Number.isFinite(value)&&value>=0)c.snapshot.counters[name]=Math.max(c.snapshot.counters[name],value);}
export function setMetric(name:Counter,value:number){const c=local.getStore();if(c&&!c.closed&&Object.hasOwn(c.snapshot.counters,name)&&Number.isFinite(value)&&value>=0)c.snapshot.counters[name]=value;}
export function observeStage(name:Stage,milliseconds:number){const c=local.getStore();if(!c||c.closed||!stageNames.has(name)||!Number.isFinite(milliseconds)||milliseconds<0)return;
 const s=c.snapshot.stages[name]??{count:0,totalMs:0,maxMs:0,active:0};s.count++;s.totalMs+=milliseconds;s.maxMs=Math.max(s.maxMs,milliseconds);c.snapshot.stages[name]=s;}
export function startStage(name:Stage){const c=local.getStore();if(!c||c.closed||!stageNames.has(name))return noop;
 const began=performance.now(),s=c.snapshot.stages[name]??{count:0,totalMs:0,maxMs:0,active:0};s.active++;c.snapshot.stages[name]=s;let done=false;
 return ()=>{if(done)return;done=true;if(c.closed)return;const ms=Math.max(0,performance.now()-began);s.active--;s.count++;s.totalMs+=ms;s.maxMs=Math.max(s.maxMs,ms);};}
export function measureSync<T>(name:Stage,operation:()=>T):T{const end=startStage(name);try{return operation();}finally{end();}}
export function measureAsync<T>(name:Stage,operation:()=>Promise<T>):Promise<T>{
 if(!local.getStore())return operation();const end=startStage(name);try{return operation().then(value=>{end();return value;},error=>{end();throw error;});}catch(error){end();throw error;}
}
export function markAbort(signal:AbortSignal){if(!signal.aborted)return;const c=local.getStore();if(!c||c.closed)return;
 const timeout=errorName(signal.reason)==='TimeoutError';c.snapshot.outcome=timeout?'timeout':'cancelled';setMetric(timeout?'timeout':'cancelled',1);}
export function markMetricOutcome(status:string){const c=local.getStore();if(c&&!c.closed&&statuses.has(status))c.snapshot.outcome=status;}
function capture(value:unknown){try{const v=value as any,status=v?.result?.status??v?.status;if(statuses.has(status))markMetricOutcome(status);
 const search=v?.search??v?.result?.plan?.search??v?.plan?.search;
 const reasons=v?.result?.reasons??v?.reasons;
 if(search?.stoppedReason==='deadline'||Array.isArray(reasons)&&reasons.some(r=>['PLANNING_PREPARATION_DEADLINE','PLANNING_DEADLINE','PLANNING_REQUEST_DEADLINE'].includes(r?.code)))setMetric('timeout',1);
 if(search)for(const [key,source] of [['expanded_states','expandedStates'],['transitions','evaluatedTransitions'],['road_queries_budgeted','roadQueries'],['weather_queries_budgeted','weatherQueries']] as const)
  if(typeof search[source]==='number')setMetric(key,search[source]);
 }catch{/* Observing a value must not change it, even for an unexpected getter. */}}
export function withPlanningMetrics<T>(requestId:unknown,operation:()=>Promise<T>,options:{enabled?:boolean;scope?:Scope;sink?:(value:PlanningMetricSnapshot)=>void}={}):Promise<T>{
 // Nested service/encoder calls share their owner's record. Disabled mode does not create context/timers.
 if(local.getStore())return operation().then(value=>{capture(value);return value;});
 if(!(options.enabled??process.env.PLANNING_METRICS_ENABLED==='true')||typeof requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId))return operation();
 const counters=Object.fromEntries(metricCounters.map(k=>[k,0])) as Record<Counter,number>,snapshot:PlanningMetricSnapshot={event:'planning_metrics',version:'planning-metrics/1.0.0',
  requestId,scope:options.scope??'planner',algorithms:{optimizer:OPTIMIZER_VERSION,energy:ENERGY_ALGORITHM_VERSION,charging:CHARGING_ALGORITHM_VERSION},durationMs:0,outcome:'success',incomplete:false,stages:{},counters},context={snapshot,closed:false},began=performance.now();
 return local.run(context,async()=>{try{const value=await operation();capture(value);
   return value;
  }catch(error){if(snapshot.outcome==='success')snapshot.outcome=isTimeout(error)?'timeout':errorName(error)==='AbortError'?'cancelled':'error';
   if(snapshot.outcome==='timeout')setMetric('timeout',1);if(snapshot.outcome==='cancelled')setMetric('cancelled',1);throw error;
  }finally{snapshot.durationMs=Math.max(0,performance.now()-began);snapshot.incomplete=Object.values(snapshot.stages).some(s=>s.active>0);context.closed=true;
   // Never serialize errors, raw operation arguments/results, URLs, IDs other than requestId, or payloads.
   try{(options.sink??(s=>logger.log(JSON.stringify(s))))(structuredClone(snapshot));}catch{/* Telemetry must never alter the plan result/error. */}
  }});
}
