import { readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { createStationSourceService } from '../src/stations/sources/create-source-service';

async function main(){
  const database=new DatabaseService();
  const before=JSON.parse(await readFile(resolve(__dirname,'../../../docs/validation/task8-before-import.json'),'utf8'));
  let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
  try{
    const epdk=(await database.pool.query(`SELECT count(*)::int AS aliases,
      md5(string_agg(external_id||':'||location_id::text,',' ORDER BY external_id)) AS identity_hash
      FROM station_source_aliases WHERE source_key='epdk-stations'`)).rows[0];
    if(epdk.aliases!==before.epdk.aliases||epdk.identity_hash!==before.epdk.identity_hash)throw new Error('EPDK canonical identities changed');
    const sources=(await database.pool.query(`SELECT s.id,s.source_key,s.scope_key,s.source_row_count,s.quality_exclusions,s.report,pub.last_checked_at
      FROM station_source_publications pub JOIN station_source_snapshots s ON s.id=pub.snapshot_id ORDER BY s.source_key`)).rows;
    const counts=(await database.pool.query(`SELECT source_key,count(*)::int AS locations,
      count(*) FILTER(WHERE public_access)::int AS public_locations,
      sum(jsonb_array_length(payload->'connectorClaims'))::int AS connector_summary_rows,
      sum(jsonb_array_length(payload->'station'->'evses'))::int AS verified_evse_groups
      FROM station_catalogue_heads GROUP BY source_key ORDER BY source_key`)).rows;
    const ocm=(await database.pool.query(`SELECT location_id,payload FROM station_catalogue_heads WHERE source_key='open-charge-map' LIMIT 1`)).rows[0];
    if(!ocm)throw new Error('No published OCM record');
    app=await NestFactory.create(AppModule,{logger:false});app.setGlobalPrefix('v1');await app.listen(0,'127.0.0.1');
    const response=await fetch((await app.getUrl())+'/v1/stations/'+ocm.location_id);
    const body=await response.json();
    if(response.status!==200||body.payload.station.source.sourceId!=='open-charge-map'||!body.payload.licenseEvidence.length)
      throw new Error('OCM HTTP/provenance check failed');
    const output={generatedAt:new Date().toISOString(),epdkIdentitiesPreserved:true,epdk,
      policy:createStationSourceService(database).registry.policy,counts,sources,
      httpCheck:{status:response.status,sourceId:body.payload.station.source.sourceId,license:body.payload.licenseEvidence[0].license},
      scope:'Local catalogue/provider delivery; no live availability verification or automatic cross-source matching'};
    await writeFile(resolve(__dirname,'../../../docs/validation/task8-provider-delivery.json'),JSON.stringify(output,null,2)+'\n');
    console.log(JSON.stringify({epdkIdentitiesPreserved:true,counts,httpCheck:output.httpCheck},null,2));
  }finally{if(app)await app.close();await database.onModuleDestroy();}
}
void main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:'Report failed');process.exitCode=1;});
