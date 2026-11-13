import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {NestFactory} from '@nestjs/core';
import type {NestExpressApplication} from '@nestjs/platform-express';
import {roadRoutingRequestSchema,roadRoutingResultSchema} from '@chargeroad/shared';
import {AppModule} from '../src/app.module';
import {configureHttpApi} from '../src/config/http-api';
import {ROAD_SEGMENTATION} from '../src/roads/road-policy';
import {analyseElevation,routeElevationSamples} from '../src/roads/elevation-qa';
async function json(url:string,body?:unknown){const response=await fetch(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},
 body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Smoke HTTP '+response.status+' '+new URL(url).pathname);return response.json();}
async function main(){const endpoint=process.argv.find(v=>v.startsWith('--endpoint='))?.slice(11)??'http://127.0.0.1:8003',u=new URL(endpoint);
 if(u.protocol!=='http:'||!['localhost','127.0.0.1'].includes(u.hostname)||u.username||u.password||u.search||u.hash)throw new Error('Loopback-only pilot smoke');
 // Process-local overrides only; never changes .env, port 3000/3001 or their workers.
 process.env.ROAD_ROUTING_BASE_URL=endpoint;process.env.ROAD_ROUTING_PROVIDER_ID='valhalla-self-hosted';process.env.ROAD_ROUTING_DEPLOYMENT_MODE='self_hosted';
 process.env.ROAD_ROUTING_PILOT_ENABLED='true';process.env.ROAD_OSM_TAGS_ENABLED='false';process.env.ROAD_ROUTING_CACHE_REVISION='dem-hardening-smoke-v1';
 process.env.ROAD_ROUTING_GRAPH_VERSION='unknown';process.env.ROAD_ROUTING_DEM_VERSION='unknown';
 const status=await json(endpoint+'/status');if(status.version!=='3.9.1')throw new Error('Expected Valhalla 3.9.1, got '+String(status.version));process.env.ROAD_ROUTING_ENGINE_VERSION=status.version;
 const locations=[{lat:39.9,lon:32.8},{lat:39.91,lon:32.8}],height=await json(endpoint+'/height',{shape:locations});
 const raw30=await json(endpoint+'/route',{locations,costing:'auto',units:'kilometers',elevation_interval:30});
 const raw300=await json(endpoint+'/route',{locations,costing:'auto',units:'kilometers',elevation_interval:300});
 const app=await NestFactory.create<NestExpressApplication>(AppModule,{bodyParser:false,logger:false});try{
  configureHttpApi(app);await app.listen(0,'127.0.0.1');const address=await app.getUrl();
  const request=roadRoutingRequestSchema.parse({schemaVersion:'1.0.0',origin:{latitude:39.9,longitude:32.8},destination:{latitude:39.91,longitude:32.8},
   departureAt:new Date(Date.now()+60000).toISOString(),alternatives:1,avoidTolls:false,avoidFerries:false,segmentationPolicy:ROAD_SEGMENTATION});
  const response=await json(address+'/v1/roads/routes',request),routes=roadRoutingResultSchema.parse(response.data),route=routes.routes[0];
  if(response.source.url!==endpoint||route.source.url!==endpoint)throw new Error('API did not use expected DEM endpoint');
  if(route.segments.some(s=>s.elevationQuality!=='modelled'||!s.elevationProfile))throw new Error('Pilot is not fully modelled DEM');
  const qa=analyseElevation(routeElevationSamples(route));if(qa.balanceErrorMeters===null||Math.abs(qa.balanceErrorMeters)>.01)throw new Error('Elevation balance invariant failed');
  const noData=raw30.trip.legs.flatMap((l:any)=>l.elevation).filter((v:unknown)=>v===-500||v===-32768||v===null).length;if(noData)throw new Error('DEM smoke has no-data');
  const report={generatedAt:new Date().toISOString(),evidence:'live_smoke',engine:status.version,graphVersion:'unknown',demVersion:'unknown',demLicense:'unknown',
   endpoint,apiPort:new URL(address).port,existingApi3000And3001:'not_restarted_or_reconfigured',
   request:{origin:request.origin,destination:request.destination},distanceMeters:route.distanceMeters,seconds:route.drivingDurationSeconds,
   segments:route.segments.length,normalizedProfileEntries:route.segments.reduce((n,s)=>n+(s.elevationProfile?.length??0),0),source:route.source,heightsAtOriginalPoints:height.height,
   rawProfiles:[{intervalMeters:30,samples:raw30.trip.legs.reduce((n:number,l:any)=>n+l.elevation.length,0),distanceKm:raw30.trip.summary.length,seconds:raw30.trip.summary.time},
     {intervalMeters:300,samples:raw300.trip.legs.reduce((n:number,l:any)=>n+l.elevation.length,0),distanceKm:raw300.trip.summary.length,seconds:raw300.trip.summary.time}],
   noDataSamples:noData,quality:'modelled',warnings:route.metadata?.warnings,qa,fieldVerified:false,
   note:'Original point /height and snapped road profile endpoints need not coincide. Equal SRTM results are not independent road elevation validation.'};
  const dir=resolve(__dirname,'../../../docs/validation');await mkdir(dir,{recursive:true});await writeFile(resolve(dir,'valhalla-dem-live-smoke.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
 }finally{await app.close();}
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'DEM smoke failed');process.exitCode=1;});
