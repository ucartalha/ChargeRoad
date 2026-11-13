import {randomBytes,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {NestFactory} from '@nestjs/core';
import type {NestExpressApplication} from '@nestjs/platform-express';
import {planningApiRequestSchema,roadPreviewResponseSchema} from '@chargeroad/shared';
import {AppModule} from '../src/app.module';
import {DatabaseService} from '../src/database/database.service';
import {configureHttpApi} from '../src/config/http-api';
import {PlanningJobsWorker} from '../src/planning/http/planning-jobs.worker';
import {planningApi} from '../../mobile/src/api/planning';
import {compactNavigationRoute} from '../../mobile/src/features/navigation/navigation-core';
async function main(){const app=await NestFactory.create<NestExpressApplication>(AppModule,{bodyParser:false,logger:false});try{
 configureHttpApi(app);await app.listen(0,'127.0.0.1');app.get(PlanningJobsWorker).start();const base=(await app.getUrl())+'/v1';process.env.EXPO_PUBLIC_API_URL=base;
 const db=app.get(DatabaseService),budget=async()=>(await db.pool.query('SELECT provider_id,used FROM road_provider_budget ORDER BY provider_id')).rows;
 const initial=await budget(),previewResponse=await fetch(base+'/roads/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
  origin:{latitude:41.0082,longitude:28.9784},destination:{latitude:39.9334,longitude:32.8597},departureAt:new Date(Date.now()+180000).toISOString(),avoidTolls:false,avoidFerries:true})});
 const preview=roadPreviewResponseSchema.parse(await previewResponse.json());if(!preview.route?.geometry)throw new Error('No preview');
 // Public landmark endpoints confirmed on their road points; SOC values are explicit test inputs.
 const now=new Date(),request=planningApiRequestSchema.parse({schemaVersion:'1.0.0',requestId:randomUUID(),
  origin:preview.route.geometry[0],destination:preview.route.geometry.at(-1),vehicleVariantId:'a82a3933-a3fe-41f8-b830-b4b1a747a5ba',
  departureMode:'now',departureAt:new Date(now.getTime()+60000).toISOString(),startingChargePercent:95,startingChargeObservedAt:now.toISOString(),
  constraints:{minimumReserveChargePercent:10,targetArrivalChargePercent:20},vehicleDataQuality:'allow_engineering_estimates',stationDataQuality:'catalogue_power_scenario'});
 const start=performance.now(),phases:string[]=[];let previewDuringJob=false;
 const result=await planningApi.planAsync(request,AbortSignal.timeout(300000),randomBytes(32).toString('hex'),phase=>{if(phases.at(-1)!==phase)phases.push(phase);},()=>{previewDuringJob=true;});
 const report={generatedAt:new Date().toISOString(),scope:'Real mobile HTTP client, temporary Nest HTTP server, real PostgreSQL catalogue, Geoapify and MET. Public landmark road points, test SOC 95/reserve10/arrival20. Not device or field accuracy acceptance.',
  requestId:request.requestId,status:result.status,elapsedMs:Math.round(performance.now()-start),phases,previewDuringJob,
  ...(result.status==='planned'?{distanceMeters:result.plan.roadRoute.distanceMeters,stops:result.plan.chargingStops.length,arrivalChargePercent:result.plan.estimatedArrivalChargePercent,
   search:result.plan.search,duration:result.plan.duration,navigationSnapshotCharacters:JSON.stringify(compactNavigationRoute(result.plan)).length,
   wireDecodedBytes:Buffer.byteLength(JSON.stringify(result))}:{reasons:result.reasons}),budgetBefore:initial,budgetAfter:await budget()};
 const output=process.argv.includes('--warm')?'async-planning-live-warm.json':'async-planning-live.json';
 await writeFile(resolve(__dirname,'../../../docs/validation/'+output),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 if(result.status!=='planned')process.exitCode=1;
}finally{await app.close();}}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Live planning failed');process.exitCode=1;});
