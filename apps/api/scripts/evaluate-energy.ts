import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {EnergyConsumptionEngine} from '../src/energy/energy-engine';
async function main(){
  const path=process.argv[2];if(!path)throw new Error('Usage: energy:evaluate REQUEST.json');
  const bytes=await readFile(resolve(path));if(bytes.length>8*1024*1024)throw new Error('Energy snapshot exceeds size budget');
  const result=await new EnergyConsumptionEngine().evaluate(JSON.parse(bytes.toString('utf8')),AbortSignal.timeout(2000));
  const directory=resolve(__dirname,'../../../artifacts/task11-energy');await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,'last-evaluation.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({status:result.status,netBatteryEnergyKwh:result.netBatteryEnergyKwh,finalChargePercent:result.finalChargePercent,
    completedSegments:result.segments.length,inputChecksum:result.inputChecksumSha256,reasons:result.reasons}));
}
void main().catch((e:unknown)=>{console.error(e instanceof Error?e.message:'Energy evaluation failed');process.exitCode=1;});
