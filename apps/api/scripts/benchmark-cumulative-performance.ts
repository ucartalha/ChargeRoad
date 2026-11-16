/** Measurement only: native production service/optimizer/engines. Never imports active-cache experiments. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {cpus,platform,release,totalmem} from 'node:os';
import {isDeepStrictEqual} from 'node:util';
import {PerformanceObserver} from 'node:perf_hooks';
import {gunzipSync} from 'node:zlib';
import {setImmediate as yieldLoop} from 'node:timers/promises';
import {optimizerWorld} from '../src/planning/__tests__/optimizer.fixtures';
import {EvPlanningService} from '../src/planning/ev-planning.service';
import {ChargeStopOptimizer} from '../src/planning/charge-stop-optimizer';
import {EnergyConsumptionEngine} from '../src/energy/energy-engine';
import {ChargingCurveEngine,CHARGING_ALGORITHM_VERSION} from '../src/charging/charging-engine';
import {ENERGY_ALGORITHM_VERSION} from '../src/energy/energy-policy';
import {RoadProviderError} from '../src/roads/road-client';
import {withPlanningMetrics,type PlanningMetricSnapshot} from '../src/observability/planning-metrics';
import {encodePlanningResponse} from '../src/planning/http/planning-response';
import {planningApiResponseSchema} from '@chargeroad/shared';
import type {PlanningContext,TransitionPort} from '../src/planning/optimizer-types';

const nativeDate=Date,epoch=Date.parse('2026-11-13T09:00:00.000Z');
class FixtureDate extends nativeDate{constructor(v?:string|number){super(v===undefined?epoch:v);}static now(){return epoch;}}
const root=resolve(__dirname,'../../..'),api=resolve(__dirname,'..');
const tag=process.argv.find(a=>a.startsWith('--tag='))?.slice(6)??'run1';if(!/^[a-z0-9-]+$/.test(tag))throw Error('Invalid tag');
const folder=resolve(root,'docs/validation/cumulative-performance-2026-11-16',tag);mkdirSync(folder,{recursive:true});
const write=(name:string,v:unknown)=>writeFileSync(resolve(folder,name),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const rawHash=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
const sources=['src/planning/ev-planning.service.ts','src/planning/planning-session.ts','src/planning/charge-stop-optimizer.ts','src/planning/plan-compiler.ts',
 'src/planning/optimizer-policy.ts','src/planning/candidate-eligibility-shadow.ts','src/planning/state-dominance-shadow.ts','src/planning/state-dominance.ts',
 'src/observability/planning-metrics.ts','src/energy/energy-engine.ts','src/energy/energy-policy.ts','src/charging/charging-engine.ts',
 'src/weather/weather-sampler.ts','src/weather/planning-weather-policy.ts','src/roads/road-client.ts','src/weather/weather-cache.ts',
 'src/planning/http/planning-response.ts','src/planning/__tests__/optimizer.fixtures.ts','scripts/benchmark-cumulative-performance.ts'];
const sourceHashes=()=>Object.fromEntries(sources.map(p=>[p,rawHash(readFileSync(resolve(api,p)))]));
const hashes=sourceHashes();
const config={processes:3,warmupsPerArm:5,blocks:10,samplesPerArmPerProcess:20,concurrency:1,clock:'2026-11-13T09:00:00Z',shadow:'follows existing metrics flag; no independent toggle'};
const environment={node:process.version,platform:platform(),release:release(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,memoryBytes:totalmem()};
const objectives=['minimum_total_duration','minimum_charging_stops','minimum_energy'] as const;
const kinds=['no_charge','two_partial_charges','missing_profile','provider_quota','abort','timeout'] as const;
type Kind=typeof kinds[number];type Objective=typeof objectives[number];
function clean<T>(v:T):T{const value=structuredClone(v);const visit=(o:any)=>{if(o&&typeof o==='object')for(const k of Object.keys(o)){if(k==='elapsedMilliseconds')delete o[k];else visit(o[k]);}};visit(value);return value;}
async function run(kind:Kind,objective:Objective,enabled:boolean,traceEnabled=false){
 const w=optimizerWorld(false),signal=new AbortController(),trace:unknown[]=[],calls:Record<string,number>={};let snapshot:PlanningMetricSnapshot|null=null;
 w.request.policy.objective=objective;
 if(kind==='no_charge'){w.request.startingChargePercent=100;w.request.constraints={minimumReserveChargePercent:0,targetArrivalChargePercent:0};}
 if(kind==='missing_profile')delete w.vehicle.energyModel;
 if(kind==='abort')signal.abort(new DOMException('synthetic','AbortError'));
 if(kind==='timeout')signal.abort(new DOMException('synthetic','TimeoutError'));
 const record=(role:string,args:unknown[])=>{calls[role]=(calls[role]??0)+1;if(traceEnabled)trace.push([role,clean(args.map(v=>v instanceof AbortSignal?{aborted:v.aborted}:v))]);};
 const wrap=<T extends(...args:any[])=>any>(role:string,fn:T)=>(...args:Parameters<T>):ReturnType<T>=>{record(role,args);return fn(...args);};
 class ObservedOptimizer extends ChargeStopOptimizer{
  override solve(context:PlanningContext,port:TransitionPort,s:AbortSignal){
   if(!traceEnabled)return super.solve(context,port,s);
   return super.solve(context,{issues:port.issues,counters:port.counters,remainingMilliseconds:()=>port.remainingMilliseconds?.()??Infinity,
    drive:wrap('transition_drive',port.drive.bind(port)),charge:wrap('transition_charge',port.charge.bind(port))},s);
  }
 }
 const energy=new EnergyConsumptionEngine(),charging=new ChargingCurveEngine();
 energy.evaluate=wrap('energy_physical',energy.evaluate.bind(energy));charging.evaluate=wrap('charging_physical',charging.evaluate.bind(charging));
 const road=kind==='provider_quota'?async()=>{throw new RoadProviderError('synthetic',429,60,'ROAD_PROVIDER_RATE_LIMITED');}:w.roads.routes;
 const service=new EvPlanningService({resolveId:wrap('vehicle_id',w.vehicles.resolveId),profile:wrap('vehicle_profile',w.vehicles.profile)} as never,
  {routes:wrap('road_port',road)} as never,{findAlongRoutes:wrap('station_port',w.stations.findAlongRoutes)} as never,
  {forecast:wrap('weather_port',w.weather.forecast)} as never,energy,charging,new ObservedOptimizer());
 const fixtureHash=hash({request:w.request,vehicle:w.vehicle,candidates:w.candidates,preparation:w.preparation,options:w.options,
  roads:Object.keys(w.locations).flatMap(a=>Object.keys(w.locations).filter(b=>a!==b).map(b=>w.route(a,b)))});
 let outcome:any,envelope:any,decodedBytes=0,wireBytes=0,planWallMs=0;
 const execute=async()=>{
  const start=performance.now();try{outcome=await service.plan(w.request,w.preparation,w.options,signal.signal);}
  catch(error){if(error!==signal.signal.reason)throw error;outcome={observedError:(error as Error).name,abortIdentityPreserved:true};}
  finally{planWallMs=performance.now()-start;}
  if(outcome.result){
   envelope=planningApiResponseSchema.parse({schemaVersion:'1.0.0',requestId:w.request.requestId,...outcome.result,
    metadata:{apiVersion:'planning-http/1.0.0',policyId:w.request.policy.id,policyVersion:w.request.policy.version,access:'stateless_guest',historyStored:false,
     algorithms:{optimizer:outcome.result.plan?.algorithmVersion??'not_planned',energy:ENERGY_ALGORITHM_VERSION,charging:CHARGING_ALGORITHM_VERSION},models:{energy:null,charging:null}}});
   const encoded=await encodePlanningResponse(envelope,'gzip',signal.signal);wireBytes=encoded.body.length;
   const decoded=encoded.encoding==='gzip'?gunzipSync(encoded.body):encoded.body;decodedBytes=decoded.length;
   if(!isDeepStrictEqual(clean(JSON.parse(decoded.toString('utf8'))),JSON.parse(JSON.stringify(clean(envelope)))))throw Error('REPRESENTATION_MISMATCH');
  }
 };
 const cpu=process.cpuUsage(),heapBefore=process.memoryUsage().heapUsed,start=performance.now();
 await withPlanningMetrics(w.request.requestId,execute,{enabled,scope:'benchmark',sink:s=>{snapshot=s;}});
 const end=performance.now(),used=process.cpuUsage(cpu),heapAfter=process.memoryUsage().heapUsed;
 const canonical=clean({outcome,envelope}),status=outcome.result?.status??outcome.observedError;
 const measured=snapshot as PlanningMetricSnapshot|null;
 if(measured&&(measured.counters.energy_evaluations!==(calls.energy_physical??0)||measured.counters.charge_integrations!==(calls.charging_physical??0)))throw Error('EQUIVALENCE_FAILED');
 const search=outcome.search??outcome.result?.plan?.search;
 const searchSummary=search?{expandedStates:search.expandedStates,evaluatedTransitions:search.evaluatedTransitions,roadQueries:search.roadQueries,weatherQueries:search.weatherQueries,
  stoppedReason:search.stoppedReason,searchComplete:search.searchComplete,skippedData:search.skippedData,optimality:search.optimality}:null;
 return {canonical,fixtureHash,outputHash:hash(canonical),traceHash:traceEnabled?hash(trace):null,calls,metrics:snapshot,status,
  searchSummary,finalIncumbentPresent:status==='planned',reasonCodes:outcome.result?.reasons?.map((r:any)=>r.code)??[],
  wallMs:end-start,planWallMs,cpuUserMs:used.user/1000,cpuSystemMs:used.system/1000,heapBefore,heapAfter,decodedBytes,wireBytes,window:{start,end}};
}
type Run=Awaited<ReturnType<typeof run>>;
function equivalent(a:Run,b:Run){if(!isDeepStrictEqual(a.canonical,b.canonical)||a.fixtureHash!==b.fixtureHash||a.outputHash!==b.outputHash||a.traceHash!==b.traceHash||!isDeepStrictEqual(a.calls,b.calls))throw Error('EQUIVALENCE_FAILED');}
function compact(r:Run){const {canonical,...rest}=r;return rest;}
async function child(index:number,smoke=false){
 if(existsSync(resolve(folder,smoke?'smoke.json':`process-${index}.json`)))throw Error('EVIDENCE_EXISTS');
 globalThis.Date=FixtureDate as DateConstructor;process.env.PLANNING_METRICS_ENABLED='false';globalThis.fetch=async()=>{throw Error('EXTERNAL_HTTP_FORBIDDEN');};
 const events:any[]=[],observer=new PerformanceObserver(list=>{for(const e of list.getEntries())if(events.length<10000)events.push({start:e.startTime,duration:e.duration,kind:(e as any).detail?.kind});});
 observer.observe({entryTypes:['gc']});const cpu=process.cpuUsage(),heapStart=process.memoryUsage().heapUsed,rows:any[]=[],diagnostics:any[]=[];
 for(const kind of kinds)for(const objective of smoke?objectives.slice(0,1):objectives){
  const a=await run(kind,objective,false,true),b=await run(kind,objective,true,true);equivalent(a,b);
  diagnostics.push({kind,objective,equivalence:'PASS',off:compact(a),on:compact(b)});
  let reference:Run|undefined;
  const execute=async(enabled:boolean,phase:string,block:number)=>{const r=await run(kind,objective,enabled);
   if(reference)equivalent(reference,r);else reference=r;if(phase==='timed')rows.push({process:index,kind,objective,enabled,block,...compact(r)});};
  for(let i=0;i<(smoke?1:config.warmupsPerArm);i++){await execute(false,'warmup',i);await execute(true,'warmup',i);}
  for(let block=0;block<(smoke?1:config.blocks);block++){global.gc?.();await yieldLoop();for(const flag of (block+index)%2?[true,false,false,true]:[false,true,true,false])await execute(flag,'timed',block);}
 }
 await yieldLoop();await yieldLoop();observer.disconnect();global.gc?.();
 if(!isDeepStrictEqual(hashes,sourceHashes()))throw Error('SOURCES_CHANGED');const used=process.cpuUsage(cpu);
 write(smoke?'smoke.json':`process-${index}.json`,{generatedAt:new nativeDate().toISOString(),sourceHashes:hashes,environment,config,
  wholeProcessCpu:{userMs:used.user/1000,systemMs:used.system/1000},heap:{start:heapStart,endAfterGc:process.memoryUsage().heapUsed},gcEvents:events,rows,diagnostics,
  physicalHttpRequests:0,pgAccesses:0,traceInHeadline:false,productionPath:'native_sort_shift_no_reuse_no_pruning',
  wallScope:'service.plan + runtime API envelope validation + production encoder + decode/check; not network/socket latency. Fixture/hash/trace outside headline timing.'});
 console.log(JSON.stringify({process:index,rows:rows.length,diagnosticPairs:diagnostics.length,equivalence:'PASS'}));
}
const percentile=(v:number[],p:number)=>{const a=[...v].sort((a,b)=>a-b);return a[Math.max(0,Math.ceil(p*a.length)-1)]??null;};
const distribution=(v:number[])=>({n:v.length,p50:percentile(v,.5),p95:percentile(v,.95),p99:percentile(v,.99),min:Math.min(...v),max:Math.max(...v)});
async function parent(){
 if(existsSync(resolve(folder,'summary.json')))throw Error('EVIDENCE_EXISTS');
 for(let i=1;i<=config.processes;i++){const p=spawnSync(process.execPath,['--expose-gc','-r',require.resolve('ts-node/register'),__filename,'--child='+i,'--tag='+tag],{cwd:api,encoding:'utf8',maxBuffer:1024*1024});if(p.status!==0)throw Error('CHILD_FAILED');console.log(p.stdout.trim());}
 const processes=[1,2,3].map(i=>JSON.parse(readFileSync(resolve(folder,`process-${i}.json`),'utf8')));
 if(processes.some(p=>!isDeepStrictEqual(p.sourceHashes,hashes)))throw Error('SOURCES_CHANGED');const rows=processes.flatMap(p=>p.rows.map((r:any)=>({...r,
  gcOverlapMs:p.gcEvents.reduce((n:number,e:any)=>n+Math.max(0,Math.min(r.window.end,e.start+e.duration)-Math.max(r.window.start,e.start)),0),
  gcOverlapCount:p.gcEvents.filter((e:any)=>e.start<r.window.end&&e.start+e.duration>r.window.start).length}))),groups:any[]=[];
 for(const kind of kinds)for(const objective of objectives){
  const arm=(enabled:boolean)=>{const r=rows.filter(v=>v.kind===kind&&v.objective===objective&&v.enabled===enabled);
   const snapshot=r.filter(v=>v.metrics),stageNames=[...new Set(snapshot.flatMap(v=>Object.keys(v.metrics.stages)))] as string[];
   return {n:r.length,status:[...new Set(r.map(v=>v.status))],wallMs:distribution(r.map(v=>v.wallMs)),planWallMs:distribution(r.map(v=>v.planWallMs)),
    cpuUserMs:r.reduce((n,v)=>n+v.cpuUserMs,0),cpuSystemMs:r.reduce((n,v)=>n+v.cpuSystemMs,0),
    heapDelta:distribution(r.map(v=>v.heapAfter-v.heapBefore)),decodedBytes:distribution(r.map(v=>v.decodedBytes)),wireBytes:distribution(r.map(v=>v.wireBytes)),
    gcOverlapMs:r.reduce((n,v)=>n+v.gcOverlapMs,0),gcOverlapCount:r.reduce((n,v)=>n+v.gcOverlapCount,0),searchSummary:r[0]?.searchSummary,
    reasonCodes:r[0]?.reasonCodes,finalIncumbentPresent:r[0]?.finalIncumbentPresent,
    stages:Object.fromEntries(stageNames.map(k=>[k,{perPlanMs:distribution(snapshot.map(v=>v.metrics.stages[k]?.totalMs??0)),
     count:snapshot.reduce((n,v)=>n+(v.metrics.stages[k]?.count??0),0),totalMs:snapshot.reduce((n,v)=>n+(v.metrics.stages[k]?.totalMs??0),0)}])),
    physicalCalls:Object.fromEntries(Object.keys(r[0]?.calls??{}).map(k=>[k,r.reduce((n,v)=>n+(v.calls[k]??0),0)])),
    counters:snapshot[0]?.metrics.counters??null,perProcess:processes.map((p,i)=>{const v=r.filter(v=>v.process===i+1);return {process:i+1,wallMs:distribution(v.map(v=>v.wallMs)),cpuUserMs:v.reduce((n,v)=>n+v.cpuUserMs,0),cpuSystemMs:v.reduce((n,v)=>n+v.cpuSystemMs,0)};})};};
  const off=arm(false),on=arm(true);groups.push({kind,objective,off,on,metricsOnWallP50OverheadPercent:100*(on.wallMs.p50!-off.wallMs.p50!)/off.wallMs.p50!});
 }
 const historical=JSON.parse(readFileSync(resolve(root,'docs/validation/perf-baseline-2026-11-13-after.json'),'utf8'));
 const sourceComparison=Object.entries(historical.sourceChecksums).map(([p,h])=>({path:p,old:h,current:hash(readFileSync(resolve(api,p),'utf8')),equal:h===hash(readFileSync(resolve(api,p),'utf8'))}));
 write('summary.json',{generatedAt:new nativeDate().toISOString(),sourceHashes:hashes,environment,config,groups,
  status:'CURRENT_PROFILE_PASS_NO_SPEEDUP_ACCEPTANCE',historicalComparison:{status:'NOT_COMPARABLE',sourceComparison,
   fixtureFactoryMatches:historical.fixtureFactoryChecksum===hash(readFileSync(resolve(api,'src/planning/__tests__/optimizer.fixtures.ts'),'utf8')),
   reason:'Different source/dirty HEAD and historical single-process sequential design; no safely reconstructed old-production control. No historical improvement percentage.'},
  savings:{queueAlgorithm:0,candidatePruning:0,statePruning:0,energyReuse:0,providerRequests:0},
  localProviderPilot:{status:'NOT_RUN',reason:'No dedicated verified cache namespace, local provider/runtime/DEM acceptance audit for this task; existing service/cache left untouched. No cold-cache claim from prior records.'},
  externalProviderLoad:'NOT_RUN',httpAndPgSynthetic:'NOT_APPLICABLE: synthetic ports only; zero physical HTTP/PG, not measured zero latency',
  metricCoverageGaps:{frontierPushPop:'NOT_MEASURED: no production hook; no inferred counts from seed-inclusive expandedStates',seedIncumbentUpdates:'NOT_MEASURED: no separate hook; full transition trace equivalence and final incumbent presence only',
   httpBodyAndTraceAttributes:'NOT_RUN: local provider pilot not run',pgLeaseWaitQuota:'NOT_RUN: in-memory ports only'},
  limitations:['p99 with 60 samples per condition/group is sample maximum, not population SLA.','Windows CPU microsecond format is not resolution; aggregate user/system rather than single short sample.',
   'Default telemetry off. On enables existing 003/004 observers too; no independent flag means component stage costs only, not causal isolated toggle.',
   'GC/JIT/shared machine load not fully controlled; snapshots include setup/warmup outside timed windows.','No CR-PERF-006 and no production changes.']});
 console.log(JSON.stringify({status:'CURRENT_PROFILE_PASS',groups:groups.length,historical:'NOT_COMPARABLE'}));
}
async function main(){if(process.argv.includes('--smoke'))return child(0,true);const c=process.argv.find(a=>a.startsWith('--child='))?.slice(8);if(c){if(!/^[1-3]$/.test(c))throw Error('Invalid child');return child(Number(c));}if(process.argv.includes('--benchmark'))return parent();throw Error('Invalid mode');}
void main().catch(error=>{const code=error instanceof Error&&/^(EQUIVALENCE_FAILED|REPRESENTATION_MISMATCH|EVIDENCE_EXISTS|CHILD_FAILED|SOURCES_CHANGED)$/.test(error.message)?error.message:'SETUP_OR_RUNTIME';console.error('CUMULATIVE_MEASUREMENT_FAILED/'+code+'; raw inputs/results/errors suppressed');process.exitCode=1;});
