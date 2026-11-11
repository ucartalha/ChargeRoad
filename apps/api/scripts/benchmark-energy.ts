import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {EnergyConsumptionEngine} from '../src/energy/energy-engine';
import {analyticalEnergyCases,longEnergyCase} from '../src/energy/validation/energy-cases';
import {latencySummary} from '../src/planning/validation/metrics';
async function main(){
  const engine=new EnergyConsumptionEngine(),signal=new AbortController().signal;
  const cases=[{id:'short_1_segment',input:analyticalEnergyCases()[0].input},{id:'long_1000_segments',input:longEnergyCase()}],groups=[];
  for(const item of cases){
    for(let i=0;i<10;i++)await engine.evaluate(item.input,signal);
    const samples:{status:string;durationMs:number}[]=[];let checksum='';
    for(let i=0;i<1000;i++){const start=performance.now(),result=await engine.evaluate(item.input,signal);checksum=result.inputChecksumSha256;
      samples.push({status:result.status==='estimated'?'planned':result.status,durationMs:performance.now()-start});}
    groups.push({id:item.id,segments:item.input.route.segments.length,distanceMeters:item.input.route.distanceMeters,inputChecksum:checksum,...latencySummary(samples)});
    console.log(JSON.stringify({case:item.id,...latencySummary(samples)}));
  }
  await writeFile(resolve(__dirname,'../../../docs/validation/task11-energy-benchmark.json'),JSON.stringify({generatedAt:new Date().toISOString(),
    scope:'Synthetic local CPU/async engine only; no external HTTP or production SLA',groups},null,2)+'\n');
}
void main().catch((e:unknown)=>{console.error(e instanceof Error?e.message:'Energy benchmark failed');process.exitCode=1;});
