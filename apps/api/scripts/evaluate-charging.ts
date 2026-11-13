import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ChargingCurveEngine} from '../src/charging/charging-engine';
async function main(){
  const path=process.argv[2];if(!path)throw new Error('Usage: charging:evaluate REQUEST.json');
  const bytes=await readFile(resolve(path));if(bytes.length>8*1024*1024)throw new Error('Charging snapshot exceeds size budget');
  const result=await new ChargingCurveEngine().evaluate(JSON.parse(bytes.toString('utf8')),AbortSignal.timeout(2000));
  const directory=resolve(__dirname,'../../../artifacts/task12-charging');await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,'last-evaluation.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({status:result.status,chargingSeconds:result.chargingSeconds,storedKwh:result.energyStoredKwh,
    inletKwh:result.energyDeliveredAtInletKwh,intervals:result.intervals.length,inputChecksum:result.inputChecksumSha256,reasons:result.reasons}));
}
void main().catch((e:unknown)=>{console.error(e instanceof Error?e.message:'Charging evaluation failed');process.exitCode=1;});
