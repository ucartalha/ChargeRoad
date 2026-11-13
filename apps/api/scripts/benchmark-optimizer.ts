import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {optimizerWorld} from '../src/planning/__tests__/optimizer.fixtures';
import {latencySummary} from '../src/planning/validation/metrics';
import {OPTIMIZER_VERSION} from '../src/planning/optimizer-policy';
async function main(){
  const groups:Record<string,unknown>[]=[];
  for(const id of ['no_charge','two_partial_charges']){
    const samples:{durationMs:number;status:string}[]=[];
    for(let i=0;i<1010;i++){
      const world=optimizerWorld(false);if(id==='no_charge'){world.request.startingChargePercent=100;world.request.constraints={minimumReserveChargePercent:0,targetArrivalChargePercent:0};}
      const at=performance.now(),r=await world.service.plan(world.request,world.preparation,world.options),elapsed=performance.now()-at;
      if(i>=10)samples.push({durationMs:elapsed,status:r.result.status});
    }
    const all=latencySummary(samples),group={id,all:all.all,plannedOnly:latencySummary(samples.filter(s=>s.status==='planned')).all,counts:all.counts};
    groups.push(group);console.log(JSON.stringify(group));
  }
  await writeFile(resolve(__dirname,'../../../docs/validation/task13-optimizer-benchmark.json'),JSON.stringify({generatedAt:new Date().toISOString(),optimizerVersion:OPTIMIZER_VERSION,
    scope:'Local bounded solver + actual energy/charging engines + in-memory synthetic provider snapshots; excludes real HTTP/DB and production concurrency/SLA',groups},null,2)+'\n');
}
void main().catch((e:unknown)=>{console.error(e instanceof Error?e.message:'Optimizer benchmark failed');process.exitCode=1;});
