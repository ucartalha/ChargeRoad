import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {cpus,totalmem,freemem,release} from 'node:os';
import {PerformanceObserver} from 'node:perf_hooks';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {makeRunner,assertEquivalent,profiles,objectives,type Strategy,type Run,digest} from '../src/planning/validation/frontier-performance-harness';
import {latencySummary} from '../src/planning/validation/metrics';
import {loadReferenceSnapshot,replayCase} from '../src/planning/validation/replay';
const arg=(key:string,fallback:string)=>process.argv.find(v=>v.startsWith('--'+key+'='))?.slice(key.length+3)??fallback;
const blocks=Number(arg('blocks','12')),processes=Number(arg('processes','3')),worker=Number(arg('worker','0')),probe=process.argv.includes('--probe');
if(!Number.isSafeInteger(blocks)||blocks<1||blocks>30||!Number.isSafeInteger(processes)||processes<3||processes>10||!Number.isSafeInteger(worker)||worker<0)throw new Error('Invalid gate arguments');
const directory=resolve(__dirname,'../../../docs/validation/frontier-queue-gate-2026-11-13');
const sha=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
const stat=(values:number[])=>latencySummary(values.map(durationMs=>({status:'success',durationMs}))).all;
async function child(){
 const machineCpuStart=cpus().map(c=>({...c.times}));
 const realDate=Date,epoch=Date.parse('2026-11-13T09:00:00Z');
 class FixtureDate extends realDate{constructor(value?:string|number){super(value===undefined?epoch:value);}static now(){return epoch;}}
 globalThis.Date=FixtureDate as DateConstructor;process.env.PLANNING_METRICS_ENABLED='false';
 globalThis.fetch=async()=>{throw new Error('External network forbidden');};
 const runners={sort:makeRunner('sort'),heap:makeRunner('heap'),native:makeRunner('native')};
 const gc:{start:number;duration:number;kind:number}[]=[];
 const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())gc.push({start:e.startTime,duration:e.duration,kind:(e as unknown as {detail:{kind:number}}).detail?.kind??0});});
 observer.observe({entryTypes:['gc']});
 const {snapshot,checksum}=loadReferenceSnapshot(),references=snapshot.cases.map(c=>replayCase(snapshot.base,c));
 if(references.some(r=>r.failures.length))throw new Error('Independent reference failed');
 const cells:object[]=[];
 for(const profile of profiles)for(const objective of objectives){
  const anchor=await runners.native(profile,objective,false),warmup=probe?0:3;let baseline:Run|null=null;
  const measured:Record<Strategy,object[]>={sort:[],heap:[]},validation:object[]=[];
  // Actual unmodified class anchors the memory-compiled class and both metrics modes.
  for(const strategy of ['sort','heap'] as Strategy[])for(const enabled of [false,true]){
   const result=await runners[strategy](profile,objective,enabled);assertEquivalent(anchor,result);
   if(baseline)assertEquivalent(baseline,result);else baseline=result;
   if(result.outcome.result.status!=='planned')throw new Error('Expected validated planned outcome');
   if(enabled&&(!result.metrics||result.metrics.incomplete||result.metrics.counters.frontier_peak!==result.queue.peak))throw new Error('Metrics cross-check failed');
   if(!enabled&&result.metrics!==null)throw new Error('Disabled metrics emitted');
   validation.push({strategy,metricsEnabled:enabled,outputHash:result.outputHash,traceHash:result.traceHash,fixtureHash:result.fixtureHash,traceCalls:result.traceCalls,
    status:result.outcome.result.status,stoppedReason:result.outcome.search?.stoppedReason,queue:result.queue,wallMs:result.wallMs,
    metricCounters:result.metrics?.counters??null});
  }
  const checkPeak=(peak:number)=>profile==='small'?peak<64:profile==='medium'?peak>=64&&peak<=256:peak>256;
  if(!checkPeak((validation[0] as {queue:{peak:number}}).queue.peak))throw new Error('Frontier profile is outside declared bucket');
  for(let i=0;i<warmup;i++)for(const strategy of ['sort','heap'] as Strategy[])assertEquivalent(baseline!,await runners[strategy](profile,objective,false));
  for(let block=0;block<(probe?0:blocks);block++){
   const order:Strategy[]=(block+worker)%2===0?['sort','heap','heap','sort']:['heap','sort','sort','heap'];
   for(let position=0;position<order.length;position++){
    const strategy=order[position],result=await runners[strategy](profile,objective,false);
    await nextTurn();await nextTurn();assertEquivalent(baseline!,result);
    const events=gc.filter(e=>e.start>=result.window.start&&e.start<result.window.end);
    measured[strategy].push({block,position,wallMs:result.wallMs,cpu:result.cpu,heap:result.heap,queue:result.queue,traceCalls:result.traceCalls,
     outputHash:result.outputHash,traceHash:result.traceHash,fixtureHash:result.fixtureHash,gc:{count:events.length,durationMs:events.reduce((n,e)=>n+e.duration,0),kinds:events.map(e=>e.kind)}});
   }
  }
  const summary=Object.fromEntries((['sort','heap'] as Strategy[]).map(strategy=>{
   const runs=measured[strategy] as {wallMs:number;cpu:Run['cpu'];heap:Run['heap'];queue:Run['queue'];gc:{count:number;durationMs:number}}[];
   return [strategy,{wall:stat(runs.map(r=>r.wallMs)),queueTime:stat(runs.map(r=>r.queue.milliseconds)),
    cpuUserMs:runs.reduce((n,r)=>n+r.cpu.userMs,0),cpuSystemMs:runs.reduce((n,r)=>n+r.cpu.systemMs,0),gcCount:runs.reduce((n,r)=>n+r.gc.count,0),gcDurationMs:runs.reduce((n,r)=>n+r.gc.durationMs,0),
    observedHeapUsedRange:runs.length?[Math.min(...runs.map(r=>r.heap.before)),Math.max(...runs.map(r=>r.heap.after))]:null}];
  }));
  cells.push({profile,objective,warmupPerStrategy:warmup,metricsModesValidation:validation,anchor:{outputHash:anchor.outputHash,traceHash:anchor.traceHash,fixtureHash:anchor.fixtureHash,traceCalls:anchor.traceCalls},summary,runs:measured});
  console.log(JSON.stringify({worker,profile,objective,summary}));
 }
 await nextTurn();observer.disconnect();
 const machineCpuEnd=cpus().map(c=>c.times),machineDelta=machineCpuEnd.map((t,i)=>({idle:t.idle-machineCpuStart[i].idle,
  total:Object.values(t).reduce((n,v)=>n+v,0)-Object.values(machineCpuStart[i]).reduce((n,v)=>n+v,0)}));
 const cpuTotal=process.cpuUsage();
 const sourcePaths=['src/planning/charge-stop-optimizer.ts','src/planning/stable-priority-queue.ts','src/planning/__tests__/optimizer.fixtures.ts','src/energy/energy-engine.ts','src/charging/charging-engine.ts',
  'src/planning/validation/frontier-performance-harness.ts','scripts/benchmark-frontier-performance-gate.ts'];
 const report={schema:'frontier-performance-gate/1',generatedAt:new realDate().toISOString(),worker,blocks,concurrency:1,probe,
  head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),
  machine:{node:process.version,platform:process.platform,release:release(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,totalMemory:totalmem(),freeMemory:freemem()},
  observedMachineBusyFraction:1-machineDelta.reduce((n,t)=>n+t.idle,0)/machineDelta.reduce((n,t)=>n+t.total,0),
  processCpuLifetimeMs:{user:cpuTotal.user/1000,system:cpuTotal.system/1000,scope:'whole_child_including_ts_node_startup_and_validation'},
  sourceChecksums:Object.fromEntries(sourcePaths.map(p=>[p,sha(resolve(__dirname,'../'+p))])),
  reference:{count:references.length,snapshotChecksum:checksum,resultsChecksum:digest(references.map(r=>({id:r.id,result:r.result})))},
  scope:'actual production optimizer source memory-compiled with ONLY queue dependency replaced; actual engines, synthetic providers; no API/PG/HTTP; frozen fixture Date, monotonic timers real; queue counters/timers and trace hashing enabled equally; telemetry sink in-memory',
  gc:{observedCount:gc.length,observedDurationMs:gc.reduce((n,e)=>n+e.duration,0),forced:false},cells};
 mkdirSync(directory,{recursive:true});const path=resolve(directory,probe?'probe.json':`process-${worker}.json`);
 if(existsSync(path))throw new Error('Refusing to overwrite gate evidence');writeFileSync(path,JSON.stringify(report,null,2)+'\n');
}
async function main(){
 if(probe||worker){await child();return;}
 for(let i=1;i<=processes;i++){
  const result=spawnSync(process.execPath,['-r',require.resolve('ts-node/register'),__filename,`--worker=${i}`,`--blocks=${blocks}`],{stdio:'inherit',env:{...process.env,PLANNING_METRICS_ENABLED:'false'}});
  if(result.status!==0)throw new Error('Independent worker failed');
 }
 console.log(JSON.stringify({status:'ALL_WORKERS_PASS',processes,blocks}));
}
void main().catch(()=>{console.error('FRONTIER_GATE_FAIL: see last completed aggregate cell; no raw outcome/trace is logged.');process.exitCode=1;});
