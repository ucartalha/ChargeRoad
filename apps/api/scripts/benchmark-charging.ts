import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {ChargingCurveEngine} from '../src/charging/charging-engine';
import {analyticalChargingCases,detailedChargingCase} from '../src/charging/validation/charging-cases';
import {latencySummary} from '../src/planning/validation/metrics';
async function main(){
  const engine=new ChargingCurveEngine(),groups:Record<string,unknown>[]=[];
  for(const item of [{id:'linear_taper',input:analyticalChargingCases()[1].input},{id:'101_points_voltage_envelope',input:detailedChargingCase()}]){
    for(let i=0;i<10;i++)await engine.evaluate(item.input);
    const samples:{durationMs:number;status:string}[]=[];let checksum='';
    for(let i=0;i<1000;i++){const at=performance.now(),r=await engine.evaluate(item.input);checksum=r.inputChecksumSha256;
      samples.push({durationMs:performance.now()-at,status:r.status});}
    const all=latencySummary(samples),group={id:item.id,inputChecksum:checksum,all:all.all,estimatedOnly:latencySummary(samples.filter(s=>s.status==='estimated')).all,counts:all.counts};
    groups.push(group);console.log(JSON.stringify(group));
  }
  await writeFile(resolve(__dirname,'../../../docs/validation/task12-charging-benchmark.json'),JSON.stringify({generatedAt:new Date().toISOString(),
    scope:'Synthetic local CPU/async engine only; no DB/HTTP, production SLA or real vehicle accuracy claim',groups},null,2)+'\n');
}
void main().catch((e:unknown)=>{console.error(e instanceof Error?e.message:'Charging benchmark failed');process.exitCode=1;});
