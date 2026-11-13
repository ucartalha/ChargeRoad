import {NestFactory} from '@nestjs/core';
import {AppModule} from '../src/app.module';
import {DatabaseService} from '../src/database/database.service';
import {StationImportRepository} from '../src/stations/station-import.repository';
import {normalizeEpdk} from '../src/stations/epdk-normalizer';
import {normalizeOcm} from '../src/stations/sources/ocm-source';
import {loadStationSourcePolicy} from '../src/stations/sources/source-policy';
async function main(){const app=await NestFactory.createApplicationContext(AppModule,{logger:false});try{
 const db=app.get(DatabaseService),repository=new StationImportRepository(db),policy=loadStationSourcePolicy();
 const rows=(await db.pool.query(`SELECT s.source_key,s.raw_bytes,s.retrieved_at FROM station_source_snapshots s
   JOIN station_source_publications p ON p.snapshot_id=s.id WHERE s.source_key=ANY($1)`,[['epdk-stations','open-charge-map']])).rows;
 for(const row of rows){const bytes=row.raw_bytes as Buffer,time=row.retrieved_at.toISOString();let data;
   if(row.source_key==='epdk-stations')data=normalizeEpdk(bytes,time);else{
     const raw=JSON.parse(bytes.toString('utf8'));data=normalizeOcm(raw.pages.flatMap((p:any)=>p.data),raw.reference.data,time,bytes);
   }
   if(!process.argv.includes('--publish')){console.log(JSON.stringify({source:row.source_key,mode:'dry_run',records:data.records.length,
     connectorClaims:data.records.reduce((n,r)=>n+r.connectorClaims.length,0)}));continue;}
   // Replay the original acquisition, never relabel this normalization as a fresh provider download.
   console.log(JSON.stringify(await repository.publish(data,bytes,{policy})));
 }
 }finally{await app.close();}}void main().catch(e=>{console.error(e instanceof Error?e.message:'Reprocess failed');process.exitCode=1;});
