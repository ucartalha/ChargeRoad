import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {NestFactory} from '@nestjs/core';
import type {NestExpressApplication} from '@nestjs/platform-express';
import {locationSearchResponseSchema,planningApiResponseSchema,roadPreviewResponseSchema} from '@chargeroad/shared';
import {AppModule} from '../src/app.module';
import {configureHttpApi} from '../src/config/http-api';
import {DatabaseService} from '../src/database/database.service';
import {DbVehicleEnergyProvider} from '../src/vehicles/knowledge/db-vehicle-energy.provider';
async function main(){const app=await NestFactory.create<NestExpressApplication>(AppModule,{logger:false,bodyParser:false});configureHttpApi(app);
  try{await app.listen(0,'127.0.0.1');const database=app.get(DatabaseService),id='a82a3933-a3fe-41f8-b830-b4b1a747a5ba';
    const profile=await new DbVehicleEnergyProvider(database).profile(id,AbortSignal.timeout(5000),'allow_engineering_estimates');
    if(profile.data)throw new Error('Pilot now has a profile; use controlled validation to avoid unexpected live EV optimization');
    const post=async(path:string,body:unknown)=>{const response=await fetch((await app.getUrl())+'/v1/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(100000)});
      const data:unknown=await response.json();if(!response.ok){const message=data&&typeof data==='object'&&'message' in data&&typeof data.message==='string'?data.message.slice(0,200):'';throw new Error('HTTP '+response.status+' at '+path+' '+message);}return data;};
    const origin=locationSearchResponseSchema.parse(await post('locations/search',{query:'İstanbul Türkiye'}));
    await delay(7100);
    const destination=locationSearchResponseSchema.parse(await post('locations/search',{query:'Ankara Türkiye'}));
    if(!origin.results[0]||!destination.results[0])throw new Error('City search returned no selectable result');
    const now=new Date().toISOString(),request={schemaVersion:'1.0.0',requestId:'15151515-1515-4515-8515-151515151515',vehicleVariantId:id,
      origin:origin.results[0].coordinate,destination:destination.results[0].coordinate,departureAt:new Date(Date.now()+60000).toISOString(),
      startingChargePercent:95,startingChargeObservedAt:now,constraints:{minimumReserveChargePercent:10,targetArrivalChargePercent:20}};
    const planning=planningApiResponseSchema.parse(await post('plans',request));if(planning.status!=='insufficient_data')throw new Error('Expected explicit pilot profile insufficiency');
    const preview=roadPreviewResponseSchema.parse(await post('roads/preview',{origin:request.origin,destination:request.destination,departureAt:request.departureAt,avoidTolls:false,avoidFerries:true}));
    if(preview.status!=='available')throw new Error('Live road preview not available');
    const report={generatedAt:new Date().toISOString(),scope:'Real Nest HTTP + local PostgreSQL + Photon city search + Valhalla road-only preview; no device GPS or calibrated EV plan acceptance',
      origin:origin.results[0],destination:destination.results[0],geocoding:{providerId:origin.providerId,attribution:origin.attribution},planning:{status:planning.status,reasons:planning.reasons},preview,
      note:'Smoke-test SOC/reserve/arrival values are explicit example inputs, not API defaults. Road preview does not claim energy reachability.'};
    await writeFile(resolve(__dirname,'../../../docs/validation/task15-mobile-http-validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  }finally{await app.close();}}
void main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:'Mobile flow validation failed');process.exitCode=1;});
