import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {cpus} from 'node:os';
import {createHash} from 'node:crypto';
import {StablePriorityQueue} from '../src/planning/stable-priority-queue';
import {compareStates} from '../src/planning/charge-stop-optimizer';
import type {OptimizerState} from '../src/planning/optimizer-types';
import {frontierObjectives} from '../src/planning/validation/frontier-scenarios';
import {latencySummary} from '../src/planning/validation/metrics';
type State=OptimizerState&{syntheticId:number};
type Operation={push:State}|{pop:true};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function workload(size:number){
 let seed=20261113,id=0;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 const state=()=>({syntheticId:id++,seconds:next()%5,distance:next()%3,netKwh:(next()%7)-3+(next()%5)*1e-9,
  stops:Array(next()%3).fill(null),visited:['origin',String(next()%4)]} as State);
 const operations:Operation[]=Array.from({length:size},()=>({push:state()}));
 for(let i=0;i<size;i++){operations.push({pop:true});if(i%4===0)operations.push({push:state()});}
 for(let i=0;i<Math.ceil(size/4);i++)operations.push({pop:true});return operations;
}
function main(){
 const groups=[] as object[];
 for(const size of [64,2048])for(const objective of frontierObjectives){
  const operations=workload(size),measurements={sort:[] as number[],heap:[] as number[]},cpu={sort:0,heap:0},memory={sort:[] as number[],heap:[] as number[]};
  let expected='',comparisonCounts={sort:0,heap:0};
  for(let i=0;i<33;i++)for(const mode of (i%2===0?['sort','heap']:['heap','sort']) as ('sort'|'heap')[]){
   let comparisons=0;const compare=(a:State,b:State)=>{comparisons++;return compareStates(a,b,objective);};
   const array:State[]=[],heap=new StablePriorityQueue(compare,size),popped:number[]=[];
   const used=process.cpuUsage(),began=performance.now();
   for(const operation of operations){
    if('push'in operation){if(mode==='sort')array.push(operation.push);else heap.push(operation.push);}
    else{if(mode==='sort'){array.sort(compare);popped.push(array.shift()!.syntheticId);}else popped.push(heap.pop()!.syntheticId);}
   }
   const duration=performance.now()-began,consumed=process.cpuUsage(used),checksum=hash(popped);
   if(expected&&expected!==checksum)throw new Error('Frontier order differs');expected=checksum;
   if(i>=3){measurements[mode].push(duration);cpu[mode]+=(consumed.user+consumed.system)/1000;memory[mode].push(process.memoryUsage().heapUsed);}
   comparisonCounts[mode]=comparisons;
  }
  groups.push({size,objective,seed:20261113,samples:30,warmup:3,order:'alternating_sort_heap',workloadChecksum:hash(operations),popOrderChecksum:expected,comparisonCounts,
   sort:{latency:latencySummary(measurements.sort.map(durationMs=>({status:'success',durationMs}))).all,cpuTotalMs:cpu.sort,sampledHeapUsedRangeBytes:[Math.min(...memory.sort),Math.max(...memory.sort)]},
   heap:{latency:latencySummary(measurements.heap.map(durationMs=>({status:'success',durationMs}))).all,cpuTotalMs:cpu.heap,sampledHeapUsedRangeBytes:[Math.min(...memory.heap),Math.max(...memory.heap)]}});
 }
 const report={generatedAt:new Date().toISOString(),scope:'structure_only_seeded_in_memory_mixed_push_pop_no_HTTP_no_PG; no real plan SLA; sampled process heap not isolated allocation',
  queueSourceSha256:createHash('sha256').update(readFileSync(resolve(__dirname,'../src/planning/stable-priority-queue.ts'))).digest('hex'),
  environment:{node:process.version,platform:process.platform,cpu:cpus()[0]?.model},groups};
 writeFileSync(resolve(__dirname,'../../../docs/validation/frontier-queue-structure.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
try{main();}catch{console.error('Frontier structure benchmark failed; no raw states are logged.');process.exitCode=1;}
