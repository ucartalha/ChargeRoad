import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {EnergyConsumptionEngine} from '../src/energy/energy-engine';
import {analyticalEnergyCases,longEnergyCase} from '../src/energy/validation/energy-cases';
import {latencySummary} from '../src/planning/validation/metrics';
async function main(){
  const engine=new EnergyConsumptionEngine(),signal=new AbortController().signal;
  const reference=longEnergyCase();reference.vehicle.energyModel!.mode='reference_corrected';reference.vehicle.capacity.referenceUsableBatteryKwh=1000;
  const seed=reference.vehicle.consumptionReferences[0];reference.vehicle.consumptionReferences=Array.from({length:64},(_,i)=>({
    ...structuredClone(seed),id:'speed-'+i,comparabilityGroupId:'synthetic-comparable-series',valueKwhPer100Km:12+(20+2*i)**2*.002,
    conditions:{...seed.conditions,meanSpeedKph:20+2*i}}));
  const cases=[{id:'short_1_segment',input:analyticalEnergyCases()[0].input},{id:'long_1000_segments',input:longEnergyCase()},
    {id:'reference_1000_segments_64_speed_points',input:reference}];
  const groups:Record<string,unknown>[]=[];
  for(const item of cases){
    for(let i=0;i<10;i++)await engine.evaluate(item.input,signal);
    const samples:{status:string;durationMs:number}[]=[];let checksum='';
    for(let i=0;i<1000;i++){const start=performance.now(),result=await engine.evaluate(item.input,signal);checksum=result.inputChecksumSha256;
      samples.push({status:result.status,durationMs:performance.now()-start});}
    const all=latencySummary(samples),summary={all:all.all,estimatedOnly:latencySummary(samples.filter(s=>s.status==='estimated')).all,counts:all.counts};
    groups.push({id:item.id,segments:item.input.route.segments.length,distanceMeters:item.input.route.distanceMeters,inputChecksum:checksum,...summary});
    console.log(JSON.stringify({case:item.id,...summary}));
  }
  await writeFile(resolve(__dirname,'../../../docs/validation/task11-energy-benchmark.json'),JSON.stringify({generatedAt:new Date().toISOString(),
    scope:'Synthetic local CPU/async engine only; no external HTTP or production SLA',groups},null,2)+'\n');
}
void main().catch((e:unknown)=>{console.error(e instanceof Error?e.message:'Energy benchmark failed');process.exitCode=1;});
