import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {cpus,totalmem,release} from 'node:os';
import {createHash} from 'node:crypto';
import {optimizerWorld} from '../src/planning/__tests__/optimizer.fixtures';
import {frontierCases,frontierObjectives,frontierScenario,frontierHash} from '../src/planning/validation/frontier-scenarios';
import {latencySummary} from '../src/planning/validation/metrics';
import {loadReferenceSnapshot,replayCase} from '../src/planning/validation/replay';
const phase=process.argv.find(a=>a.startsWith('--phase='))?.slice(8);
if(phase!=='before'&&phase!=='after')throw new Error('Choose --phase=before or --phase=after');
const nativeDate=Date,epoch=Date.parse('2026-11-13T09:00:00Z');
class FixtureDate extends nativeDate{constructor(value?:string|number){super(value===undefined?epoch:value);}static now(){return epoch;}}
globalThis.Date=FixtureDate as DateConstructor;process.env.PLANNING_METRICS_ENABLED='false';
const output=resolve(__dirname,`../../../docs/validation/frontier-queue-${phase}.json`);
async function main(){
 if(phase==='before'&&existsSync(output))throw new Error('Historical before evidence already exists');
 const validation:Awaited<ReturnType<typeof frontierScenario>>[]=[];for(const objective of frontierObjectives)for(const kind of frontierCases)validation.push(await frontierScenario(objective,kind));
 const {snapshot,checksum}=loadReferenceSnapshot(),references=snapshot.cases.map(c=>replayCase(snapshot.base,c));
 if(references.some(r=>r.failures.length))throw new Error('Reference failed');
 const groups:{objective:string;resultChecksum:string;latency:ReturnType<typeof latencySummary>['all'];warmup:number;concurrency:number;cpuMs:object;heap:object}[]=[];
 for(const objective of frontierObjectives){
  const samples:{status:string;durationMs:number}[]=[],cpu=process.cpuUsage(),heapStart=process.memoryUsage().heapUsed;let heapPeak=heapStart,resultChecksum='';
  for(let i=0;i<105;i++){
   const w=optimizerWorld(false);w.request.policy.objective=objective;
   const start=performance.now(),outcome=await w.service.plan(w.request,w.preparation,w.options),durationMs=performance.now()-start;
   if(outcome.result.status!=='planned')throw new Error('Expected planned');const current=frontierHash(outcome);
   if(resultChecksum&&current!==resultChecksum)throw new Error('Non-deterministic outcome');resultChecksum=current;
   if(i>=5)samples.push({status:outcome.result.status,durationMs});heapPeak=Math.max(heapPeak,process.memoryUsage().heapUsed);
  }
  const consumed=process.cpuUsage(cpu);groups.push({objective,resultChecksum,latency:latencySummary(samples).all,warmup:5,concurrency:1,
   cpuMs:{user:consumed.user/1000,system:consumed.system/1000,scope:'group_including_setup_hashing_warmup'},
   heap:{startBytes:heapStart,sampledPeakBytes:heapPeak,endBytes:process.memoryUsage().heapUsed}});
 }
 const report={phase,generatedAt:new nativeDate().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),
  optimizerSourceSha256:createHash('sha256').update(readFileSync(resolve(__dirname,'../src/planning/charge-stop-optimizer.ts'))).digest('hex'),
  queueSourceSha256:existsSync(resolve(__dirname,'../src/planning/stable-priority-queue.ts'))?createHash('sha256').update(readFileSync(resolve(__dirname,'../src/planning/stable-priority-queue.ts'))).digest('hex'):null,
  machine:{platform:process.platform,release:release(),node:process.version,cpu:cpus()[0]?.model,logicalCpus:cpus().length,totalMemoryBytes:totalmem()},
  scope:'offline_synthetic_actual_engines_no_HTTP_no_PG_no_logger_IO; frozen Date; real monotonic timers; sampled process heap not allocation/GC proof',
  reference:{count:references.length,snapshotChecksum:checksum,resultsChecksum:frontierHash(references.map(r=>({id:r.id,result:r.result})))},validation,groups};
 if(phase==='after'){
  const before=JSON.parse(readFileSync(resolve(__dirname,'../../../docs/validation/frontier-queue-before.json'),'utf8'));
  if(JSON.stringify(before.validation)!==JSON.stringify(validation)||JSON.stringify(before.reference)!==JSON.stringify(report.reference))throw new Error('Before/after behavior differs');
  for(let i=0;i<groups.length;i++)if(groups[i].resultChecksum!==before.groups[i].resultChecksum)throw new Error('Performance result differs');
 }
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({phase,reference:report.reference,validation:validation.length,groups},null,2));
}
void main().catch(()=>{console.error('Frontier acceptance failed; raw states/results are not logged.');process.exitCode=1;});
