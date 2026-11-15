import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {latencySummary,percentile} from '../src/planning/validation/metrics';
const directory=resolve(__dirname,'../../../docs/validation/frontier-queue-gate-2026-11-13');
const reports=[1,2,3].map(i=>JSON.parse(readFileSync(resolve(directory,`process-${i}.json`),'utf8')));
const historical=JSON.parse(readFileSync(resolve(directory,'../frontier-queue-before.json'),'utf8'));
const stat=(values:number[])=>latencySummary(values.map(durationMs=>({status:'success',durationMs}))).all;
const spread=(values:number[])=>{const mean=values.reduce((n,v)=>n+v,0)/values.length;return {min:Math.min(...values),max:Math.max(...values),mean,
 sampleSd:Math.sqrt(values.reduce((n,v)=>n+(v-mean)**2,0)/(values.length-1))};};
function main(){
 for(const [index,report] of reports.entries()){
  if(report.worker!==index+1||report.probe||report.concurrency!==1||report.blocks!==reports[0].blocks||report.cells.length!==9)throw new Error('Invalid process evidence');
  if(!isDeepStrictEqual(report.sourceChecksums,reports[0].sourceChecksums)||!isDeepStrictEqual(report.reference,historical.reference))throw new Error('Source/reference drift');
 }
 for(const [path,hash] of Object.entries(reports[0].sourceChecksums))if(createHash('sha256').update(readFileSync(resolve(__dirname,'../'+path))).digest('hex')!==hash)throw new Error('Measured sources changed');
 const groups:Record<string,any>[]=[];
 for(let index=0;index<9;index++){
  const cells=reports.map(r=>r.cells[index]),anchor=cells[0].anchor;
  for(const [i,cell] of cells.entries()){
   if(cell.profile!==cells[0].profile||cell.objective!==cells[0].objective||!isDeepStrictEqual(cell.anchor,anchor))throw new Error('Process input/output/trace drift');
   if(cell.profile==='small'&&anchor.outputHash!==historical.groups.find((g:{objective:string})=>g.objective===cell.objective).resultChecksum)throw new Error('Historical full-plan drift');
   const baseline=cell.metricsModesValidation[0].queue;
   for(const run of [...cell.metricsModesValidation,...cell.runs.sort,...cell.runs.heap]){
    if(run.outputHash!==anchor.outputHash||run.traceHash!==anchor.traceHash||run.fixtureHash!==anchor.fixtureHash||run.traceCalls!==anchor.traceCalls)throw new Error('Run drift');
    for(const key of ['peak','push','pop','popHash'])if(run.queue[key]!==baseline[key])throw new Error('Frontier order drift');
   }
   for(let block=0;block<reports[i].blocks;block++){
    const ordered=['sort','heap'].flatMap(strategy=>cell.runs[strategy].filter((r:{block:number})=>r.block===block).map((r:{position:number})=>({strategy,position:r.position}))).sort((a,b)=>a.position-b.position);
    const expected=(block+reports[i].worker)%2===0?['sort','heap','heap','sort']:['heap','sort','sort','heap'];
    if(!isDeepStrictEqual(ordered.map(r=>r.strategy),expected)||!isDeepStrictEqual(ordered.map(r=>r.position),[0,1,2,3]))throw new Error('Unbalanced block');
   }
  }
  const strategies=Object.fromEntries(['sort','heap'].map(strategy=>{
   const runs=cells.flatMap(c=>c.runs[strategy]);
   return [strategy,{wall:stat(runs.map(r=>r.wallMs)),queueTime:stat(runs.map(r=>r.queue.milliseconds)),
    cpuUserMs:runs.reduce((n,r)=>n+r.cpu.userMs,0),cpuSystemMs:runs.reduce((n,r)=>n+r.cpu.systemMs,0),
    gcCount:runs.reduce((n,r)=>n+r.gc.count,0),gcDurationMs:runs.reduce((n,r)=>n+r.gc.durationMs,0),
    heapUsedRange:[Math.min(...runs.map(r=>Math.min(r.heap.before,r.heap.after))),Math.max(...runs.map(r=>Math.max(r.heap.before,r.heap.after)))],
    queue:{peak:runs[0].queue.peak,push:runs[0].queue.push,pop:runs[0].queue.pop,comparisons:runs[0].queue.comparisons},
    processP95Spread:spread(cells.map(c=>c.summary[strategy].wall.p95Ms))}];
  }));
  const p95ByProcess=cells.map((c,i)=>({process:i+1,sort:c.summary.sort.wall.p95Ms,heap:c.summary.heap.wall.p95Ms,
   changePercent:(c.summary.heap.wall.p95Ms/c.summary.sort.wall.p95Ms-1)*100}));
  const blockChanges:{milliseconds:number;percent:number}[]=[];
  for(const c of cells)for(let block=0;block<reports[0].blocks;block++){
   const means=['sort','heap'].map(s=>c.runs[s].filter((r:{block:number})=>r.block===block).reduce((n:number,r:{wallMs:number})=>n+r.wallMs,0)/2);
   blockChanges.push({milliseconds:means[1]-means[0],percent:(means[1]/means[0]-1)*100});
  }
  groups.push({profile:cells[0].profile,objective:cells[0].objective,anchor,strategies,p95ByProcess,
   regressingProcesses:p95ByProcess.filter(r=>r.changePercent>0).length,
   pairedBlocks:{samples:blockChanges.length,medianDeltaMs:percentile(blockChanges.map(b=>b.milliseconds),.5),medianChangePercent:percentile(blockChanges.map(b=>b.percent),.5)}});
 }
 const decision=groups.some(g=>g.regressingProcesses>=2)?'NO-GO':'CONDITIONAL GO';
 const report={schema:'frontier-performance-gate-summary/1',generatedAt:new Date().toISOString(),executionClientDate:'2026-11-15',decision,equivalence:'PASS',
  policy:'Repeated p95 regression in >=2/3 independent processes forbids permanent speedup acceptance; no production SLA threshold or confidence claim was set.',
  processes:3,blocksPerProcess:reports[0].blocks,measuredRuns:groups.length*3*reports[0].blocks*4,metricsModeChecks:9*3*4,nativeAnchors:9*3,
  sourceChecksums:reports[0].sourceChecksums,reference:reports[0].reference,
  processObservations:reports.map(r=>({worker:r.worker,generatedAt:r.generatedAt,machine:r.machine,observedMachineBusyFraction:r.observedMachineBusyFraction,processCpuLifetimeMs:r.processCpuLifetimeMs,gc:r.gc})),groups};
 const path=resolve(directory,'summary.json');if(existsSync(path))throw new Error('Refusing to overwrite summary evidence');writeFileSync(path,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({decision,equivalence:report.equivalence,measuredRuns:report.measuredRuns,
  groups:groups.map(g=>({profile:g.profile,objective:g.objective,sort:g.strategies.sort.wall,heap:g.strategies.heap.wall,p95ByProcess:g.p95ByProcess,pairedBlocks:g.pairedBlocks}))},null,2));
}
try{main();}catch{console.error('FRONTIER_GATE_SUMMARY_FAIL: source, balance or semantic evidence invalid; no raw outcomes logged.');process.exitCode=1;}
