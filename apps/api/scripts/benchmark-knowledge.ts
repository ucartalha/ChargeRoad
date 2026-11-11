import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import { DatabaseService } from '../src/database/database.service';
import { migrate } from '../src/database/migrate';
import { VehiclesRepository } from '../src/vehicles/vehicles.repository';
import { DbVehicleEnergyProvider } from '../src/vehicles/knowledge/db-vehicle-energy.provider';
import { VehicleKnowledgeRepository } from '../src/vehicles/knowledge/knowledge.repository';
import { knowledgeFixture,knowledgeBytes } from '../src/vehicles/__tests__/knowledge.fixtures';
import { latencySummary } from '../src/planning/validation/metrics';
import { getEnvironment } from '../src/config/environment';

async function main(){
  const db=new DatabaseService();
  const schema='knowledge_bench_'+randomBytes(8).toString('hex');
  let testPool:Pool|undefined,created=false;
  try{
    const info=(await db.pool.query(`SELECT count(*)::int AS entries,
      (SELECT count(*)::int FROM vehicle_variants) AS legacy_rows,
      (SELECT count(*)::int FROM vehicle_profile_revisions) AS real_profile_revisions FROM catalogue_entries`)).rows[0];
    const legacy=(await db.pool.query('SELECT id FROM vehicle_variants ORDER BY id LIMIT 1')).rows[0]?.id;
    if(!legacy)throw new Error('A real imported catalogue is required for the read benchmark');
    const vehicles=new VehiclesRepository(db);
    const canonical=(await vehicles.findById(legacy))!.id;
    await db.pool.query('CREATE SCHEMA '+schema);created=true;
    const connection=getEnvironment().DATABASE_URL;
    testPool=new Pool({connectionString:connection,options:'-c search_path='+schema,max:4,statement_timeout:5000});
    await migrate(testPool);
    const isolated={pool:testPool} as DatabaseService;
    await new VehicleKnowledgeRepository(isolated).publish(knowledgeBytes(knowledgeFixture()));
    const profileId=(await testPool.query('SELECT entity_id FROM catalogue_entries')).rows[0].entity_id;
    const energy=new DbVehicleEnergyProvider(isolated);
    const signal=new AbortController().signal;
    const cases:[string,()=>Promise<unknown>][]=[
      ['legacy_projection_detail_baseline',()=>db.pool.query('SELECT detail FROM open_ev_catalogue_projection WHERE legacy_id=$1',[legacy])],
      ['published_detail_canonical',()=>vehicles.findById(canonical)],
      ['published_detail_legacy_alias',()=>vehicles.findById(legacy)],
      ['published_hyundai_page',()=>vehicles.list({make:'hyundai',limit:25,offset:0})],
      ['published_profile_hit_synthetic_isolated_schema',()=>energy.profile(profileId,signal)],
    ];
    const groups:(ReturnType<typeof latencySummary>['all'] & {name:string;elapsedMs:number;errors:number;maxPoolWaiting:number})[]=[];
    for(const [name,operation] of cases){
      for(let i=0;i<50;i++)await operation();
      let next=0,maxWaiting=0;
      const samples:{status:string;durationMs:number}[]=[];
      const begin=performance.now();
      await Promise.all(Array.from({length:4},async()=>{
        while(next++<2000){
          const start=performance.now();let status='ok';
          try{await operation();}catch{status='error';}
          samples.push({status,durationMs:performance.now()-start});
          maxWaiting=Math.max(maxWaiting,db.pool.waitingCount,testPool!.waitingCount);
        }
      }));
      groups.push({name,elapsedMs:performance.now()-begin,...latencySummary(samples).all,
        errors:samples.filter(s=>s.status==='error').length,maxPoolWaiting:maxWaiting});
    }
    const output=resolve(process.argv[2]??'../../artifacts/vehicle-knowledge/db-benchmark.json');
    const report={schemaVersion:1,generatedAt:new Date().toISOString(),scope:'local_postgresql_microbenchmark_not_production_capacity',
      catalogue:info,concurrency:4,warmupPerCase:50,groups,
      environment:{node:process.version,platform:process.platform,cpu:cpus()[0]?.model},
      limitations:['Short local benchmark; no production SLA selected','No live provider HTTP calls',
        'Baseline is the legacy full-detail SQL projection, not the old list endpoint',
        'Profile hit uses a synthetic record in a temporary schema, not a verified pilot profile',
        'No sustained concurrent-import/telemetry load; pending-write visibility is covered by integration tests']};
    await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({output,groups},null,2));
    if(groups.some(g=>g.errors))process.exitCode=1;
  }finally{
    if(testPool)await testPool.end();
    if(created){if(!/^knowledge_bench_[a-f0-9]{16}$/.test(schema))throw new Error('Unsafe schema');await db.pool.query('DROP SCHEMA '+schema+' CASCADE');}
    await db.onModuleDestroy();
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
