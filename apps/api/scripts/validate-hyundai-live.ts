import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {NestFactory} from '@nestjs/core';
import type {NestExpressApplication} from '@nestjs/platform-express';
import {planningApiResponseSchema,roadPreviewResponseSchema} from '@chargeroad/shared';
import {AppModule} from '../src/app.module';
import {configureHttpApi} from '../src/config/http-api';
import {DatabaseService} from '../src/database/database.service';
import {DbVehicleEnergyProvider} from '../src/vehicles/knowledge/db-vehicle-energy.provider';
async function main(){const app=await NestFactory.create<NestExpressApplication>(AppModule,{logger:false,bodyParser:false});configureHttpApi(app);
  try{await app.listen(0,'127.0.0.1');const db=app.get(DatabaseService),provider=new DbVehicleEnergyProvider(db);
    const rows=(await db.pool.query("SELECT entity_id,detail->>'model' model FROM catalogue_entries WHERE make_slug='hyundai' AND is_active ORDER BY entity_id")).rows;
    let profiles=0;for(const row of rows){const found=await provider.profile(row.entity_id,AbortSignal.timeout(5000),'allow_engineering_estimates');if(found.data?.energyModel&&found.data?.chargingModel)profiles++;}
    if(profiles!==rows.length)throw new Error('Hyundai profile coverage is incomplete');
    const now=new Date().toISOString(),departureAt=new Date(Date.now()+60000).toISOString();
    const post=async(path:string,body:unknown)=>{const response=await fetch((await app.getUrl())+'/v1/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(95000)});
      return {http:response.status,body:await response.json()};};
    const input={origin:{latitude:39.9208,longitude:32.8541},destination:{latitude:39.9334,longitude:32.8597},departureAt,avoidTolls:false,avoidFerries:true};
    const request={schemaVersion:'1.0.0',requestId:randomUUID(),vehicleVariantId:'a82a3933-a3fe-41f8-b830-b4b1a747a5ba',
      origin:input.origin,destination:input.destination,departureAt,startingChargePercent:95,startingChargeObservedAt:now,
      constraints:{minimumReserveChargePercent:10,targetArrivalChargePercent:20},vehicleDataQuality:'allow_engineering_estimates'};
    const response=await post('plans',request),result=planningApiResponseSchema.parse(response.body);
    const previewResponse=await post('roads/preview',input),preview=roadPreviewResponseSchema.parse(previewResponse.body);
    const report={generatedAt:new Date().toISOString(),scope:'Real PostgreSQL Hyundai profile coverage + real Ankara HTTP plan/road preview. Approximate model; not field accuracy or full charging-route acceptance.',
      catalogueVariants:rows.length,publishedEnergyAndChargingProfiles:profiles,http:response.http,status:result.status,
      result:result.status==='planned'?{distanceMeters:result.plan.roadRoute.distanceMeters,arrivalChargePercent:result.plan.estimatedArrivalChargePercent,
        segments:result.plan.energySegments.length,chargingStops:result.plan.chargingStops.length,algorithm:result.metadata.algorithms,assumptions:result.plan.assumptions}:result.reasons,
      preview:{http:previewResponse.http,status:preview.status,displayGeometryPoints:preview.route?.geometry?.length??0},
      preservedUserObservations:(await db.pool.query("SELECT count(*)::int n FROM vehicle_reference_revisions WHERE payload ? 'reportedJourneyContext'")).rows[0].n};
    await writeFile(resolve(__dirname,'../../../docs/validation/hyundai-live-planning.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
    if(result.status!=='planned')process.exitCode=1;
  }finally{await app.close();}}
void main().catch(e=>{console.error(e instanceof Error?e.message:'Hyundai live validation failed');process.exitCode=1;});
