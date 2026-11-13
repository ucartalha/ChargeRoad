import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {NestFactory} from '@nestjs/core';
import type {NestExpressApplication} from '@nestjs/platform-express';
import {planningApiResponseSchema} from '@chargeroad/shared';
import {AppModule} from '../src/app.module';
import {configureHttpApi} from '../src/config/http-api';
import {DatabaseService} from '../src/database/database.service';
import {DbVehicleEnergyProvider} from '../src/vehicles/knowledge/db-vehicle-energy.provider';
async function main(){
  const app=await NestFactory.create<NestExpressApplication>(AppModule,{logger:false,bodyParser:false});configureHttpApi(app);
  try{
    await app.listen(0,'127.0.0.1');const database=app.get(DatabaseService);
    const pilots=JSON.parse(await readFile(resolve(__dirname,'../../../data/vehicle-knowledge/pilots-v4-istanbul-ankara-observation.json'),'utf8'));
    const record=pilots.records[0],row=(await database.pool.query('SELECT entity_id FROM catalogue_bindings WHERE source_key=$1 AND external_id=$2',[pilots.source.key,record.externalId])).rows[0];
    if(!row)throw new Error('Pilot canonical catalogue binding not found');
    const profile=(await new DbVehicleEnergyProvider(database).profile(row.entity_id,AbortSignal.timeout(5000),'allow_engineering_estimates')).data;
    if(profile)throw new Error('Pilot profile is now present; use controlled provider validation instead of an unexpected live route request');
    const now=new Date().toISOString(),request={schemaVersion:'1.0.0',requestId:'11111111-1111-4111-8111-111111111111',
      origin:{latitude:41.0082,longitude:28.9784},destination:{latitude:39.9334,longitude:32.8597},vehicleVariantId:row.entity_id,
      departureAt:new Date(Date.now()+300000).toISOString(),startingChargePercent:95,startingChargeObservedAt:now,
      constraints:{minimumReserveChargePercent:10,targetArrivalChargePercent:20}};
    const response=await fetch((await app.getUrl())+'/v1/plans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
    const body=planningApiResponseSchema.parse(await response.json());
    if(response.status!==200||body.status!=='insufficient_data'||!body.reasons.some(r=>r.code==='VEHICLE_ENERGY_PROFILE_MISSING'))throw new Error('Unexpected real DB API gate result');
    const report={generatedAt:new Date().toISOString(),scope:'Real Nest HTTP wiring with local PostgreSQL pilot profile gate; no external routing/weather requests, no synthetic production profiles',
      httpStatus:response.status,status:body.status,reasons:body.reasons,metadata:body.metadata,headers:{cacheControl:response.headers.get('cache-control'),requestId:response.headers.get('x-request-id')},
      admission:{configuredGlobalCapacity:(await database.pool.query('SELECT capacity FROM planning_admission_config WHERE singleton')).rows[0].capacity},
      note:'Example reserve/arrival values were explicitly supplied by this smoke test; they are not API defaults.'};
    const directory=resolve(__dirname,'../../../artifacts/task14-http');await mkdir(directory,{recursive:true});
    await writeFile(resolve(directory,'example-request.json'),JSON.stringify(request,null,2)+'\n');
    await writeFile(resolve(__dirname,'../../../docs/validation/task14-planning-http-validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  }finally{await app.close();}
}
void main().catch((e:unknown)=>{console.error(e instanceof Error?e.message:'Planning HTTP validation failed');process.exitCode=1;});
