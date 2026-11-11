import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../src/database/database.service';
import { normalizeOcm } from '../src/stations/sources/ocm-source';

// Re-normalize the latest immutable DB acquisition without contacting OCM or publishing anything.
async function main(){
  const database=new DatabaseService();
  try{
    const result=await database.pool.query<{raw_bytes:Buffer;raw_sha256:string}>(`SELECT raw_bytes,raw_sha256
      FROM station_source_snapshots WHERE source_key='open-charge-map' ORDER BY retrieved_at DESC LIMIT 1`);
    if(!result.rowCount)throw new Error('No OCM acquisition to review');
    const row=result.rows[0];
    if(createHash('sha256').update(row.raw_bytes).digest('hex')!==row.raw_sha256)throw new Error('Acquisition checksum mismatch');
    const bundle=JSON.parse(row.raw_bytes.toString('utf8'));
    const p=normalizeOcm(bundle.pages.flatMap((page:{data:unknown[]})=>page.data),bundle.reference.data,
      bundle.pages.at(-1).retrievedAt,row.raw_bytes);
    const directory=resolve(__dirname,'../../../artifacts/stations/ocm-review');await mkdir(directory,{recursive:true});
    await writeFile(resolve(directory,'acquisition.json'),row.raw_bytes);
    await writeFile(resolve(directory,'normalized.json'),JSON.stringify(p));
    console.log(JSON.stringify({directory,records:p.records.length,quarantine:p.quarantine},null,2));
  }finally{await database.onModuleDestroy();}
}
void main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:'OCM review failed');process.exitCode=1;});
