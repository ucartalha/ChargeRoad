import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {arch,cpus,platform,release,totalmem} from 'node:os';
import {optimizerWorld} from '../src/planning/__tests__/optimizer.fixtures';
import {encodePlanningResponse} from '../src/planning/http/planning-response';
import {planningApiResponseSchema} from '@chargeroad/shared';
import {percentile} from '../src/planning/validation/metrics';
const argument=(name:string,fallback:string)=>process.argv.find(v=>v.startsWith('--'+name+'='))?.slice(name.length+3)??fallback;
const phase=argument('phase','before'),samples=Number(argument('samples','100')),warmup=5;
if(!['before','after','instrumented'].includes(phase)||!Number.isInteger(samples)||samples<20||samples>1000)throw new Error('Invalid benchmark arguments');
// Wall time is frozen only in this isolated synthetic process; monotonic timers remain real.
const nativeDate=Date,epoch=Date.parse('2026-11-13T09:00:00.000Z');
class FixtureDate extends nativeDate {constructor(value?:string|number){super(value===undefined?epoch:value);}static now(){return epoch;}}
globalThis.Date=FixtureDate as DateConstructor;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v,(_,value)=>typeof value==='bigint'?String(value):value)).digest('hex');
const clean=(value:unknown)=>JSON.parse(JSON.stringify(value,(key,value)=>key==='elapsedMilliseconds'?undefined:value));
const summary=(values:number[])=>({n:values.length,p50:percentile(values,.5),p95:percentile(values,.95),p99:percentile(values,.99),
 min:Math.min(...values),max:Math.max(...values)});
async function main(){
 const metricPath=resolve(__dirname,'../src/observability/planning-metrics.ts');
 const metrics=phase==='instrumented'&&existsSync(metricPath)?require(metricPath):null;
 if(phase==='instrumented'&&!metrics)throw new Error('Instrumentation does not exist yet');
 process.env.PLANNING_METRICS_ENABLED='false';
 const groups:Record<string,unknown>[]=[];
 for(const scenario of ['no_charge','two_partial_charges']){
  const latencies:number[]=[],cpuStart=process.cpuUsage(),rssStart=process.memoryUsage().rss;let rssPeak=rssStart;
  let fixtureChecksum='',resultChecksum='',representationChecksum='',decodedBytes=0,wireBytes=0;
  const snapshots:any[]=[];
  for(let iteration=0;iteration<samples+warmup;iteration++){
   const world=optimizerWorld(false);if(scenario==='no_charge'){world.request.startingChargePercent=100;world.request.constraints={minimumReserveChargePercent:0,targetArrivalChargePercent:0};}
   const fixture={request:world.request,vehicle:world.vehicle,candidates:world.candidates,preparation:world.preparation,options:world.options,
    roads:Object.keys(world.locations).flatMap(a=>Object.keys(world.locations).filter(b=>a!==b).map(b=>world.route(a,b)))};
   const checksum=hash(fixture);if(fixtureChecksum&&fixtureChecksum!==checksum)throw new Error('Non-deterministic input');fixtureChecksum=checksum;
   const began=performance.now();
   const run=async()=>{
    const outcome=await world.service.plan(world.request,world.preparation,world.options);
    if(outcome.result.status!=='planned')throw new Error('Fixture did not produce a plan');
    const envelope=planningApiResponseSchema.parse({schemaVersion:'1.0.0',requestId:world.request.requestId,...outcome.result,
     metadata:{apiVersion:'planning-http/1.0.0',policyId:world.request.policy.id,policyVersion:world.request.policy.version,access:'stateless_guest',historyStored:false,
      algorithms:{optimizer:outcome.result.plan.algorithmVersion,energy:'fixture-energy',charging:'fixture-charging'},models:{energy:null,charging:null}}});
    const encoded=await encodePlanningResponse(envelope,'gzip',new AbortController().signal);
    return {outcome,envelope,encoded};
   };
   const value=metrics?await metrics.withPlanningMetrics(world.request.requestId,run,{enabled:true,scope:'benchmark',sink:(s:unknown)=>{if(iteration>=warmup)snapshots.push(s);}}):await run();
   const elapsed=performance.now()-began,current=hash(clean(value.outcome.result)),representation=hash(clean(value.envelope));
   if(resultChecksum&&resultChecksum!==current||representationChecksum&&representationChecksum!==representation)throw new Error('Non-deterministic output');
   resultChecksum=current;representationChecksum=representation;decodedBytes=Buffer.byteLength(JSON.stringify(value.envelope));wireBytes=value.encoded.body.length;
   if(iteration>=warmup)latencies.push(elapsed);rssPeak=Math.max(rssPeak,process.memoryUsage().rss);
  }
  const cpu=process.cpuUsage(cpuStart),stages:Record<string,unknown>={};
  for(const stage of Object.keys(snapshots[0]?.stages??{}))stages[stage]=summary(snapshots.map(s=>s.stages[stage]?.totalMs??0));
  const group={scenario,samples,warmup,fixtureChecksum,resultChecksum,representationChecksum,latencyMs:summary(latencies),
   groupCpuMs:{user:cpu.user/1000,system:cpu.system/1000,scope:'whole_group_including_fixture_setup_and_warmup'},rss:{startBytes:rssStart,sampledPeakBytes:rssPeak,endBytes:process.memoryUsage().rss},
   response:{decodedBytes,wireBytes},cacheState:'fresh_per_plan_session_in_memory_fixture_providers_no_PG_no_HTTP',
   metrics:snapshots.length?{samples:snapshots.length,incomplete:snapshots.filter(s=>s.incomplete).length,stagesMs:stages,counters:snapshots[0].counters}:null};
  groups.push(group);console.log(JSON.stringify({phase,scenario,latencyMs:group.latencyMs,fixtureChecksum,resultChecksum}));
 }
 const tracked=['src/planning/ev-planning.service.ts','src/planning/planning-session.ts','src/planning/charge-stop-optimizer.ts','src/planning/plan-compiler.ts',
  'src/planning/http/planning-http.service.ts','src/planning/http/planning-response.ts','src/roads/road-client.ts','src/weather/weather-cache.ts'];
 const report={schemaVersion:'perf-baseline/1',generatedAt:new nativeDate().toISOString(),phase,
  machine:{platform:platform(),release:release(),arch:arch(),cpuModel:cpus()[0]?.model,logicalCpuCount:cpus().length,totalMemoryBytes:totalmem(),node:process.version},
  head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),
  sourceChecksums:Object.fromEntries(tracked.map(p=>[p,hash(readFileSync(resolve(__dirname,'../'+p),'utf8'))])),
  instrumentationSourceChecksum:existsSync(metricPath)?hash(readFileSync(metricPath,'utf8')):null,
  fixtureFactoryChecksum:hash(readFileSync(resolve(__dirname,'../src/planning/__tests__/optimizer.fixtures.ts'),'utf8')),
  clock:'Frozen synthetic wall clock 2026-11-13T09:00Z; real monotonic latency and process CPU. No real-world trip or SLA.',
  providerMode:'synthetic_in_memory_no_external_HTTP_or_database',quantile:'nearest_rank_concurrency_1_JIT_warmup_excluded_from_latency',groups,
  realProviderMeasurement:{status:'NOT_RUN',reason:'Explicit opt-in local smoke is separate; public provider load tests prohibited'}};
 const dir=resolve(__dirname,'../../../docs/validation');mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,`perf-baseline-2026-11-13-${phase}.json`),JSON.stringify(report,null,2)+'\n');
}
void main().catch(()=>{console.error('Performance baseline failed; no raw provider/user payload is logged.');process.exitCode=1;});
