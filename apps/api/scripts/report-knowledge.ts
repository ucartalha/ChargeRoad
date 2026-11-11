import { mkdir,writeFile } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { DatabaseService } from '../src/database/database.service';

async function main(){
  const database=new DatabaseService();
  try{
    const counts=(await database.pool.query(`SELECT
      (SELECT count(*)::int FROM vehicle_variants) AS legacy_records,
      (SELECT count(*)::int FROM catalogue_entries) AS canonical_entries,
      (SELECT count(*)::int FROM vehicle_source_candidates) AS staged_source_records,
      (SELECT count(*)::int FROM vehicle_profile_publications) AS published_energy_profiles`)).rows[0];
    const sources=(await database.pool.query('SELECT source_key,version,checksum_sha256,report FROM vehicle_source_snapshots ORDER BY retrieved_at')).rows;
    const pilot=(await database.pool.query(`SELECT DISTINCT b.report FROM vehicle_knowledge_batches b
      JOIN vehicle_knowledge_publications pub ON pub.batch_id=b.id WHERE pub.source_key='chargeroad-pilot-configurations'`)).rows.map(r=>r.report);
    const report={schemaVersion:1,generatedAt:new Date().toISOString(),counts,sources,pilot,
      acceptance:{technicalPlatform:'implemented_and_tested',pilotConditionedSpeedAndChargingCoverage:'incomplete',
        fullCr006Status:'IN_PROGRESS',reason:'Owner-reported ranges and source candidates are preserved; verified/conditioned pilot energy profiles are not yet publishable.'}};
    const output=resolve(process.argv[2]??'../../artifacts/vehicle-knowledge/coverage.json');
    await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({output,counts,acceptance:report.acceptance},null,2));
  }finally{await database.onModuleDestroy();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
