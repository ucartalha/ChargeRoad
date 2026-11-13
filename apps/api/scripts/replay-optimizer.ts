import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {replayOptimizer} from '../src/planning/planning-replay';
async function main(){
  if(!process.argv[2])throw new Error('Usage: planning:replay SNAPSHOT.json');
  const bytes=await readFile(resolve(process.argv[2]));if(bytes.length>32*1024*1024)throw new Error('Replay exceeds 32 MiB budget');
  const input=JSON.parse(bytes.toString('utf8')),result=await replayOptimizer(input.packet,input.roadOptions,AbortSignal.timeout(60000));
  const directory=resolve(__dirname,'../../../artifacts/task13-planning');await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,'last-replay-result.json'),JSON.stringify(result.result,null,2)+'\n');
  console.log(JSON.stringify(result.result.status==='planned'?{status:'planned',stops:result.result.plan.chargingStops.length,scenarioSeconds:result.result.plan.scenario?.totalSeconds,
    actualEta:result.result.plan.estimatedArrivalAt,search:result.result.plan.search}:result.result));
}
void main().catch((e:unknown)=>{console.error(e instanceof Error?e.message:'Optimizer replay failed');process.exitCode=1;});
