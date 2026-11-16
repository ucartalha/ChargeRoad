/** CR-PERF-005 B1/B2 only. Never enables production reuse or calls a real provider. */
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {platform,release,cpus,totalmem} from 'node:os';
import {PerformanceObserver} from 'node:perf_hooks';
import {setImmediate as yieldLoop} from 'node:timers/promises';
import {runEnergyProof,assertEnergyProofEquivalent,proofScenarioKinds,PROOF_VARIANTS,PROOF_PROFILES,PROOF_CONFIG} from '../src/planning/validation/energy-reuse-harness';
import type {ProofProfile,ProofStrategy} from '../src/planning/validation/energy-reuse-harness';
import {objectives,digest} from '../src/planning/validation/frontier-performance-harness';
import {ENERGY_ALGORITHM_VERSION} from '../src/energy/energy-policy';
import {OPTIMIZER_VERSION} from '../src/planning/optimizer-policy';
import {CHARGING_ALGORITHM_VERSION} from '../src/charging/charging-engine';

const realDate=Date,clock=Date.parse('2026-11-16T09:00:00Z');
class FixtureDate extends realDate{constructor(v?:string|number){super(v===undefined?clock:v);}static now(){return clock;}}
const sources=['src/energy/energy-engine.ts','src/energy/energy-policy.ts','src/energy/energy-physics.ts','src/energy/battery-thermal.ts','src/energy/reference-selector.ts',
 'src/charging/charging-engine.ts','src/weather/weather-sampler.ts','src/weather/weather-policy.ts','src/weather/planning-weather-policy.ts',
 'src/planning/planning-session.ts','src/planning/ev-planning.service.ts','src/planning/charge-stop-optimizer.ts','src/planning/plan-compiler.ts','src/planning/optimizer-policy.ts',
 'src/observability/planning-metrics.ts','src/planning/validation/eligibility-fixtures.ts','src/planning/validation/energy-reuse-proof.ts','src/planning/validation/energy-reuse-harness.ts','scripts/benchmark-energy-reuse-proof.ts'];
const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const hashes=()=>Object.fromEntries(sources.map(p=>[p,hash(resolve(__dirname,'../'+p))]));
const sourceHashes=hashes(),namespace=digest(sourceHashes);
const tag=process.argv.find(a=>a.startsWith('--tag='))?.slice(6)??'run1';if(!/^[a-z0-9-]+$/.test(tag))throw Error('Invalid tag');
const folder=resolve(__dirname,'../../../docs/validation/session-repeat-active-proof-2026-11-15',tag);mkdirSync(folder,{recursive:true});
const write=(name:string,data:unknown)=>{if(!/^[a-z0-9-]+\.json$/.test(name))throw Error('Invalid output');writeFileSync(resolve(folder,name),JSON.stringify(data,null,2)+'\n',{flag:'wx'});};
const env={node:process.version,platform:platform(),release:release(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,totalMemoryBytes:totalmem()};
function activate(){globalThis.Date=FixtureDate as DateConstructor;globalThis.fetch=async()=>{throw Error('External providers forbidden');};process.env.PLANNING_METRICS_ENABLED='false';}
function unchanged(){if(JSON.stringify(sourceHashes)!==JSON.stringify(hashes()))throw Error('Source changed during proof');}
function compact(run:Awaited<ReturnType<typeof runEnergyProof>>){const {outcome,...data}=run;return data;}
async function matrix(){
 if(existsSync(resolve(folder,'matrix.json')))throw Error('Evidence exists');activate();const rows:any[]=[];
 for(const objective of objectives)for(const kind of proofScenarioKinds)for(const variant of PROOF_VARIANTS){
  const setup={objective,kind,variant,namespace,metrics:true,trace:true};
  const a=await runEnergyProof({...setup,strategy:'bypass'}),b=await runEnergyProof({...setup,strategy:'reuse'});assertEnergyProofEquivalent(a,b);
  let nativeAnchored=false;if(variant==='baseline'){const native=await runEnergyProof({...setup,strategy:'native'});assertEnergyProofEquivalent(native,a);nativeAnchored=true;}
  rows.push({kind,variant,objective,nativeAnchored,equivalent:true,fixtureHash:a.fixtureHash,outputHash:a.outputHash,traceHash:a.traceHash,status:a.status,
   baselinePhysicalCalls:a.physicalEnergyCalls,proofPhysicalCalls:b.physicalEnergyCalls,logicalCalls:a.logicalEnergyCalls,cache:b.cache,
   existingEnergyCounterBefore:a.metrics?.counters.energy_evaluations,existingEnergyCounterProof:b.metrics?.counters.energy_evaluations,
   existingCountersEqual:true,providerOrderEqual:true,retainedAfterDispose:b.retainedAfterDispose});
 }
 unchanged();write('matrix.json',{generatedAt:new realDate().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHashes,environment:env,
  scope:'23 original kinds × 3 explicitly different input variants = 69 scenarios × 3 objectives = 207 comparisons. All 69 original baseline/objective combinations also anchored to native production.',
  config:PROOF_CONFIG,algorithms:{optimizer:OPTIMIZER_VERSION,energy:ENERGY_ALGORITHM_VERSION,charging:CHARGING_ALGORITHM_VERSION},rows,
  physicalHits:rows.reduce((n,r)=>n+r.cache.hits,0),providerHttpCalls:0,productionReuse:false});
 console.log(JSON.stringify({matrix:'PASS',comparisons:rows.length,nativeAnchors:rows.filter(r=>r.nativeAnchored).length,physicalHits:rows.reduce((n,r)=>n+r.cache.hits,0)}));
}
const kindFor=(profile:ProofProfile):typeof proofScenarioKinds[number]=>profile==='large'?'long_route':profile==='repeat_dense'?'equal_alternatives':profile==='repeat_sparse'?'direct':'normal';
async function child(index:number,smoke=false){
 const name=smoke?'smoke.json':'process-'+index+'.json';if(existsSync(resolve(folder,name)))throw Error('Evidence exists');activate();
 const events:{start:number;duration:number;kind:number}[]=[],observer=new PerformanceObserver(list=>{for(const e of list.getEntries())if(events.length<10000)events.push({start:e.startTime,duration:e.duration,kind:(e as any).detail?.kind??0});});
 observer.observe({entryTypes:['gc']});const heapStart=process.memoryUsage().heapUsed,cpuStart=process.cpuUsage(),rows:any[]=[];
 const profiles=smoke?['small','large','repeat_sparse'] as ProofProfile[]:PROOF_PROFILES;
 for(const profile of profiles)for(const objective of smoke?objectives.slice(0,1):objectives){
  const setup={kind:kindFor(profile),variant:'baseline' as const,objective,profile,namespace,trace:false},reference=new Map<boolean,Awaited<ReturnType<typeof runEnergyProof>>>();
  const perform=async(strategy:'bypass'|'reuse',metrics:boolean,phase:'warmup'|'timed'|'metrics',block:number)=>{
   const run=await runEnergyProof({...setup,strategy,metrics});const control=reference.get(metrics);
   if(metrics&&reference.has(false))assertEnergyProofEquivalent(reference.get(false)!,run);
   if(!control&&strategy==='bypass')reference.set(metrics,run);else if(control)assertEnergyProofEquivalent(control,run);
   if(phase!=='warmup')rows.push({process:index,profile,objective,strategy,phase,block,...compact(run)});
  };
  for(let warm=0;warm<(smoke?1:PROOF_CONFIG.warmups);warm++){await perform('bypass',false,'warmup',warm);await perform('reuse',false,'warmup',warm);}
  for(let block=0;block<(smoke?1:PROOF_CONFIG.blocks);block++){
   global.gc?.();await yieldLoop();
   const order=(block+index)%2===0?['bypass','reuse','reuse','bypass'] as const:['reuse','bypass','bypass','reuse'] as const;
   for(const strategy of order)await perform(strategy,false,'timed',block);
  }
  // Timers/stage metrics and cache diagnostics are a SEPARATE workload, not headline wall time.
  await perform('bypass',true,'warmup',0);await perform('reuse',true,'warmup',0);
  for(const strategy of ['bypass','reuse','reuse','bypass'] as const)await perform(strategy,true,'metrics',0);
 }
 await yieldLoop();await yieldLoop();observer.disconnect();global.gc?.();const cpu=process.cpuUsage(cpuStart);unchanged();
 write(name,{generatedAt:new realDate().toISOString(),sourceHashes,environment:env,config:PROOF_CONFIG,
  fixtureClock:'2026-11-16T09:00:00Z',concurrency:1,gcExposed:typeof global.gc==='function',cpuTotalMs:{user:cpu.user/1000,system:cpu.system/1000},
  heapSamples:{start:heapStart,endAfterGc:process.memoryUsage().heapUsed},gcEvents:events,rows,
  caveats:['Full-plan wall/CPU excludes fixture creation, memory-module compilation, output hashing and trace hashing; includes key/lookup/owned clone/write/eviction/dispose.',
   'Source setup/hash/transpile/output serialization ARE included in whole-process CPU and GC observations; do not call these saved engine CPU.',
   'Small/medium/large describe synthetic plan complexity, not a guarantee about frontier bucket sizes. Actual frontier values are recorded when metrics enabled.',
   'repeat_dense is only a candidate fixture; actual hit rate is reported, never forced by extra engine calls.',
   'Cache charge/provider savings are zero. No production safety/rollout acceptance in this proof.']});
 console.log(JSON.stringify({process:index,rows:rows.length,scope:smoke?'smoke':'process',equivalence:'PASS'}));
}
const percentile=(data:number[],p:number)=>{const sorted=[...data].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(p*sorted.length)-1)]??null;};
async function benchmark(){
 if(existsSync(resolve(folder,'summary.json')))throw Error('Evidence exists');
 for(let index=1;index<=PROOF_CONFIG.processes;index++){
  const result=spawnSync(process.execPath,['--expose-gc','-r',require.resolve('ts-node/register'),__filename,'--child='+index,'--tag='+tag],
   {cwd:resolve(__dirname,'..'),encoding:'utf8',env:{...process.env,PLANNING_METRICS_ENABLED:'false'},maxBuffer:1024*1024});
  if(result.status!==0)throw Error('Child process failed '+index);console.log(result.stdout.trim());
 }
 const processes=Array.from({length:PROOF_CONFIG.processes},(_,i)=>JSON.parse(readFileSync(resolve(folder,'process-'+(i+1)+'.json'),'utf8')));
 if(processes.some(p=>JSON.stringify(p.sourceHashes)!==JSON.stringify(sourceHashes)))throw Error('Process source mismatch');
 const all=processes.flatMap(p=>p.rows.map((r:any)=>({...r,gcOverlapCount:p.gcEvents.filter((e:any)=>e.start<r.window.end&&e.start+e.duration>r.window.start).length,
  gcOverlapMs:p.gcEvents.reduce((n:number,e:any)=>n+Math.max(0,Math.min(r.window.end,e.start+e.duration)-Math.max(r.window.start,e.start)),0)}))),groups:any[]=[];
 for(const profile of PROOF_PROFILES)for(const objective of objectives){
  const arm=(strategy:ProofStrategy,phase:string)=>{const rows=all.filter(r=>r.profile===profile&&r.objective===objective&&r.strategy===strategy&&r.phase===phase);
   return {n:rows.length,p50Ms:percentile(rows.map(r=>r.wallMs),.5),p95Ms:percentile(rows.map(r=>r.wallMs),.95),p99Ms:percentile(rows.map(r=>r.wallMs),.99),
    cpuUserMs:rows.reduce((n,r)=>n+r.cpuUserMs,0),cpuSystemMs:rows.reduce((n,r)=>n+r.cpuSystemMs,0),physicalCalls:rows.reduce((n,r)=>n+r.physicalEnergyCalls,0),logicalCalls:rows.reduce((n,r)=>n+r.logicalEnergyCalls,0),
    hits:rows.reduce((n,r)=>n+r.cache.hits,0),entriesPeak:Math.max(...rows.map(r=>r.cache.entriesPeak)),retainedPeak:Math.max(...rows.map(r=>r.cache.retainedPeak)),
    heapDeltaBytes:{min:Math.min(...rows.map(r=>r.heapAfter-r.heapBefore)),max:Math.max(...rows.map(r=>r.heapAfter-r.heapBefore))},
    gcOverlapCount:rows.reduce((n,r)=>n+r.gcOverlapCount,0),gcOverlapMs:rows.reduce((n,r)=>n+r.gcOverlapMs,0),
    componentTotalsMs:Object.fromEntries(['keyMs','lookupMs','cloneReadMs','cloneWriteMs','entryMs','evictionMs','engineMs'].map(k=>[k,rows.reduce((n,r)=>n+r.cache[k],0)])),
    fieldReads:rows.reduce((n,r)=>n+r.cache.fieldReads,0),evictions:rows.reduce((n,r)=>n+r.cache.evictions,0),
    perProcess:processes.map((p,i)=>{const r=rows.filter(row=>row.process===i+1);return {process:i+1,p50Ms:percentile(r.map(v=>v.wallMs),.5),p95Ms:percentile(r.map(v=>v.wallMs),.95),p99Ms:percentile(r.map(v=>v.wallMs),.99),
     cpuMs:r.reduce((n,v)=>n+v.cpuUserMs+v.cpuSystemMs,0)};})};
  };
  const a=arm('bypass','timed'),b=arm('reuse','timed'),regressions=b.perProcess.filter((p,i)=>p.p95Ms!>a.perProcess[i].p95Ms!*(1+PROOF_CONFIG.p95RegressionPercent/100)).length;
  groups.push({profile,objective,before:a,proof:b,p95RegressingProcesses:regressions,repeatedP95Regression:regressions>=2,
   metricsOn:{before:arm('bypass','metrics'),proof:arm('reuse','metrics')}});
 }
 const totals=(strategy:string)=>{const r=all.filter(v=>v.strategy===strategy&&v.phase==='timed');return {wallMs:r.reduce((n,v)=>n+v.wallMs,0),cpuMs:r.reduce((n,v)=>n+v.cpuUserMs+v.cpuSystemMs,0)};};
 const a=totals('bypass'),b=totals('reuse'),wallGain=100*(a.wallMs-b.wallMs)/a.wallMs,cpuGain=100*(a.cpuMs-b.cpuMs)/a.cpuMs;
 const eligible=wallGain>=PROOF_CONFIG.requiredWallGainPercent&&cpuGain>=PROOF_CONFIG.requiredCpuGainPercent&&!groups.some(g=>g.repeatedP95Regression);
 unchanged();write('summary.json',{generatedAt:new realDate().toISOString(),sourceHashes,environment:env,config:PROOF_CONFIG,groups,totals:{before:a,proof:b,wallGainPercent:wallGain,cpuGainPercent:cpuGain},
  performanceGate:eligible?'CANDIDATE_ONLY':'NO_GO',decision:'NO_GO_UNTIL_ALL_B1_B2_AND_PRODUCTION_SAFETY_GATES_CLOSED',productionReuse:false,
  explicitLimitations:['5 ms cache-hit headroom is not a proof of absolute-deadline/microtask scheduling equivalence at every boundary.',
   'Yielding computations are never cached. Some expensive repeat-dense workloads consequently cannot benefit.',
   'p95/p99 nearest rank with 24 samples per arm/group pooled over 3 processes; p99 is a sample maximum, not a population-tail guarantee.',
   'Windows process.cpuUsage reports microseconds but short runs may quantize to zero; CPU acceptance uses accumulated samples.',
   'Logical retained-unit bound counts UTF-16 keys/serialized payload proxy and node counts; heap/GC observations include VM/scaffolding noise.',
   'No cumulative 001–005 speedup claim; no sampler/charging/provider cache experiment.']});
 console.log(JSON.stringify({performanceGate:eligible?'CANDIDATE_ONLY':'NO_GO',wallGainPercent:wallGain,cpuGainPercent:cpuGain,regressingGroups:groups.filter(g=>g.repeatedP95Regression).length}));
}
async function main(){
 if(process.argv.includes('--matrix'))return matrix();
 if(process.argv.includes('--smoke'))return child(0,true);
 const index=process.argv.find(a=>a.startsWith('--child='))?.slice(8);if(index){if(!/^[1-3]$/.test(index))throw Error('Invalid child');return child(Number(index));}
 if(process.argv.includes('--benchmark'))return benchmark();throw Error('Choose --matrix, --smoke or --benchmark');
}
void main().catch(error=>{const message=error instanceof Error?error.message:'';
 const safe=/^(ENERGY_REUSE_[A-Z_]+(?:\/[a-z_,]+)?|Evidence exists|Source changed during proof|Process source mismatch|Child process failed [1-3])$/.test(message)?message:'validation setup/runtime failure';
 console.error('ENERGY_REUSE_PROOF_FAILED: '+safe+'; raw inputs/results are never logged');process.exitCode=1;});
