import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DatabaseService} from '../src/database/database.service';
async function main(){const db=new DatabaseService(),directory=resolve(__dirname,'../../../artifacts/hyundai-research');await mkdir(directory,{recursive:true});
  try{const rows=(await db.pool.query(`SELECT c.entity_id,c.detail,b.legacy_id FROM catalogue_entries c LEFT JOIN LATERAL
    (SELECT legacy_id FROM catalogue_bindings WHERE entity_id=c.entity_id AND legacy_id IS NOT NULL LIMIT 1) b ON true
    WHERE c.make_slug='hyundai' AND c.is_active ORDER BY c.model_slug,c.model_year,c.entity_id`)).rows;
    await writeFile(resolve(directory,'inventory.json'),JSON.stringify(rows,null,2));
    console.log(JSON.stringify(rows.map(r=>({id:r.entity_id,legacy:r.legacy_id,model:r.detail.model,year:r.detail.modelYear,trim:r.detail.trim,variant:r.detail.variant,
      usable:r.detail.usableBatteryKwh,gross:r.detail.grossBatteryKwh,marketed:r.detail.marketedBatteryKwh,power:r.detail.motorPowerKw,dc:r.detail.maxDcChargeKw,drivetrain:r.detail.drivetrain,wheels:r.detail.wheelInches})),null,2));
    const headers={'User-Agent':'ChargeRoad-data-research','Accept':'application/vnd.github+json'};
    const commitResponse=await fetch('https://api.github.com/repos/KilowattApp/open-ev-data/commits/master',{headers,signal:AbortSignal.timeout(15000)});
    if(!commitResponse.ok)throw new Error('Source commit request failed');const commit=await commitResponse.json() as {sha:string};
    for(const file of ['data/ev-data.json','LICENSE']){const response=await fetch('https://raw.githubusercontent.com/KilowattApp/open-ev-data/'+commit.sha+'/'+file,{signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw new Error('Source file request failed');await writeFile(resolve(directory,file==='LICENSE'?'kilowatt-LICENSE.txt':'kilowatt.json'),Buffer.from(await response.arrayBuffer()));}
    await writeFile(resolve(directory,'source.json'),JSON.stringify({commit:commit.sha,retrievedAt:new Date().toISOString()},null,2));
    console.log('Hyundai inventory and pinned licensed source saved.');
  }finally{await db.onModuleDestroy();}}
void main().catch(e=>{console.error(e instanceof Error?e.message:'Research failed');process.exitCode=1;});
