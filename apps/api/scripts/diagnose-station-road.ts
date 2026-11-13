import {NestFactory} from '@nestjs/core';
import {AppModule} from '../src/app.module';
import {DatabaseService} from '../src/database/database.service';
async function main(){const app=await NestFactory.createApplicationContext(AppModule,{logger:false});try{
 const db=app.get(DatabaseService);
 const counts=await db.pool.query(`SELECT source_key,count(*)::int locations,
   sum(jsonb_array_length(payload->'connectorClaims'))::int claims,
   sum(jsonb_array_length(payload->'station'->'evses'))::int evses FROM station_catalogue_heads GROUP BY source_key`);
 const types=await db.pool.query(`SELECT source_key,c->>'rawType' type,c->>'standard' standard,c->>'powerType' power_type,
   count(*)::int n,count(c->>'maxPowerKw')::int with_power FROM station_catalogue_heads,
   LATERAL jsonb_array_elements(payload->'connectorClaims') c GROUP BY 1,2,3,4 ORDER BY n DESC LIMIT 25`);
 const raw=await db.pool.query(`SELECT s.source_key,s.raw_bytes FROM station_source_snapshots s JOIN station_source_publications p ON p.snapshot_id=s.id`);
 const fields=raw.rows.map(r=>{const data=JSON.parse(r.raw_bytes.toString('utf8'));const rows=r.source_key==='open-charge-map'?data.pages.flatMap((p:any)=>p.data):data.data;
   const connectors=rows.flatMap((p:any)=>p.Connections??p.soketler??[]);
   return {source:r.source_key,connectorFields:[...new Set(connectors.flatMap((c:any)=>Object.keys(c)))],
     connectors:connectors.length,amps:connectors.filter((c:any)=>c.Amps>0).length,voltage:connectors.filter((c:any)=>c.Voltage>0).length};});
 console.log(JSON.stringify({catalogue:counts.rows,types:types.rows,sourceFields:fields},null,2));
 }finally{await app.close();}}void main().catch(e=>{console.error(e instanceof Error?e.message:'Diagnostic failed');process.exitCode=1;});
