import {NestFactory} from '@nestjs/core';
import {AppModule} from '../src/app.module';
import {DatabaseService} from '../src/database/database.service';
import {ValhallaRoadAdapter} from '../src/roads/valhalla-adapter';
import {roadConfig,ROAD_SEGMENTATION} from '../src/roads/road-policy';
import {normalizeRoadTrip} from '../src/roads/normalize-road';
import type {RoadJsonClient} from '../src/roads/provider-ports';
import {energyInputUsage} from '../src/energy/energy-input-budget';
async function main(){const app=await NestFactory.createApplicationContext(AppModule,{logger:false});try{
 const db=app.get(DatabaseService),config=roadConfig(),adapter=new ValhallaRoadAdapter(config);
 const packet=(await db.pool.query(`SELECT payload FROM road_response_cache WHERE payload->'data'->'trip' IS NOT NULL
  AND (payload->'data'->'trip'->'summary'->>'length')::numeric>250
  AND (payload->>'retrievedAt')::timestamptz BETWEEN $1::timestamptz AND $2::timestamptz
  ORDER BY (payload->>'retrievedAt')::timestamptz DESC LIMIT 1`,[process.argv[2],process.argv[3]])).rows[0]?.payload;
 if(!packet)throw new Error('No cached route in window');
 const loc=packet.data.trip.locations,origin={latitude:loc[0].lat,longitude:loc[0].lon},last=loc.at(-1),destination={latitude:last.lat,longitude:last.lon};
 const client:RoadJsonClient={post:async(_id,url,body)=>{
  if(url.endsWith('/route'))return packet;
  const shape=(body as {encoded_polyline:string}).encoded_polyline;
  const row=(await db.pool.query(`SELECT payload FROM road_response_cache WHERE payload->'data'->>'shape'=$1
   ORDER BY (payload->>'retrievedAt')::timestamptz DESC LIMIT 1`,[shape])).rows[0];
  if(!row)throw new Error('Exact cached trace missing');return row.payload;
 }};
 const request={schemaVersion:'1.0.0' as const,origin,destination,departureAt:packet.retrievedAt,alternatives:1,avoidTolls:false,avoidFerries:true,segmentationPolicy:{...ROAD_SEGMENTATION}};
 for(const trip of (await adapter.route(request,[origin,destination],client,new AbortController().signal))??[]){
  let cachedTraceAvailable=true;
  for(const leg of trip.legs)try{leg.edges=await adapter.attributes(leg,client,new AbortController().signal);}catch{cachedTraceAvailable=false;leg.edges=[];}
  const route=normalizeRoadTrip(trip,request,config,new Map());
  console.log(JSON.stringify({cachedAt:packet.retrievedAt,cachedTraceAvailable,kilometers:route.distanceMeters/1000,inputUsage:energyInputUsage(route),segments:route.segments.length,
    geometryPoints:route.segments.reduce((n,s)=>n+s.geometry.length,0),elevationPoints:route.segments.reduce((n,s)=>n+(s.elevationProfile?.length??0),0),
    rawElevationPoints:trip.legs.reduce((n,l)=>n+(l.elevation?.values.length??0),0),providerSeconds:trip.legs.reduce((n,l)=>n+l.seconds,0),
    modeledSeconds:route.drivingDurationSeconds,speedConflicts:route.segments.filter(s=>s.speedLimitKph!==null&&s.expectedSpeedKph>s.speedLimitKph+.1).length},null,2));
 }
 }finally{await app.close();}}void main().catch(e=>{console.error(e instanceof Error?e.message:'Inspect failed');process.exitCode=1;});
