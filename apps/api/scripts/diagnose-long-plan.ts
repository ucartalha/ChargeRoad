import {randomUUID} from 'node:crypto';
import {NestFactory} from '@nestjs/core';
import {AppModule} from '../src/app.module';
import {DatabaseService} from '../src/database/database.service';
import {EvPlanningService} from '../src/planning/ev-planning.service';
import {planningApiRequestSchema,planningApiResponseSchema,weatherForecastIsUsable} from '@chargeroad/shared';
import {toInternalRequest,planningPreparation} from '../src/planning/http/planning-http-policy';
import {DEFAULT_OPTIMIZER_OPTIONS} from '../src/planning/optimizer-policy';
import {decodePolyline6} from '../src/roads/geometry';
import {sampleRouteWeather} from '../src/weather/weather-sampler';
import {StationDataProvider} from '../src/providers/station-data-provider';
import {RoutingProvider} from '../src/providers/routing-provider';
import {EnergyConsumptionEngine} from '../src/energy/energy-engine';
import {ChargingCurveEngine} from '../src/charging/charging-engine';
async function main(){const app=await NestFactory.createApplicationContext(AppModule,{logger:false});try{
  const db=app.get(DatabaseService);
  const energy=app.get(EnergyConsumptionEngine),originalEnergy=energy.evaluate.bind(energy);
  energy.evaluate=async(...args)=>{const result=await originalEnergy(...args);console.log(JSON.stringify({energyCall:{km:Math.round((args[0] as {route:{distanceMeters:number}}).route.distanceMeters/1000),
    status:result.status,netKwh:result.netBatteryEnergyKwh,finalSoc:result.finalChargePercent,capacity:result.capacityKwh,reasons:result.reasons.map(r=>r.code)}}));return result;};
  const charging=app.get(ChargingCurveEngine),originalCharging=charging.evaluate.bind(charging);let chargeLogged=0;
  charging.evaluate=async(...args)=>{const result=await originalCharging(...args);if(chargeLogged++<15)console.log(JSON.stringify({chargeCall:{status:result.status,reasons:result.reasons,seconds:result.chargingSeconds}}));return result;};
  const roads=app.get(RoutingProvider),originalRoads=roads.routes.bind(roads);
  roads.routes=async(...args)=>{const began=performance.now();try{const result=await originalRoads(...args);
    console.log(JSON.stringify({roadCall:{elapsedMs:Math.round(performance.now()-began),kilometers:result.data?.routes[0]?.distanceMeters?Math.round(result.data.routes[0].distanceMeters/1000):null}}));return result;
  }catch(error){console.log(JSON.stringify({roadCall:{elapsedMs:Math.round(performance.now()-began),failed:true}}));throw error;}};
  const stations=app.get(StationDataProvider),originalStations=stations.findAlongRoutes.bind(stations);
  stations.findAlongRoutes=async(...args)=>{const began=performance.now();try{return await originalStations(...args);}catch(e){
    console.log(JSON.stringify({stationDiagnostic:{message:e instanceof Error?e.message:'failure',routes:args[0].length,
      geometryPoints:args[0].reduce((n,r)=>n+r.segments.reduce((m,s)=>m+s.geometry.length,0),0),elapsedMs:Math.round(performance.now()-began)}}));throw e;}};
  const rows=(await db.pool.query(`SELECT payload FROM road_response_cache WHERE payload->'data'->'trip' IS NOT NULL
    AND (payload->'data'->'trip'->'summary'->>'length')::numeric>250
    AND (payload->>'retrievedAt')::timestamptz BETWEEN $1::timestamptz AND $2::timestamptz
    ORDER BY (payload->>'retrievedAt')::timestamptz DESC LIMIT 1`,[process.argv[2],process.argv[3]])).rows;
  if(!rows.length){console.log('No long-route cache packet in requested window');return;}
  const packet=rows[0].payload,locations=packet.data.trip.locations,start=locations[0],end=locations.at(-1);
  if(!start||!end)throw new Error('Cached route does not contain input locations');
  const roadPoints=process.argv.includes('--road-points'),first=roadPoints?decodePolyline6(packet.data.trip.legs[0].shape)[0]:{latitude:start.lat,longitude:start.lon},
    last=roadPoints?decodePolyline6(packet.data.trip.legs.at(-1).shape).at(-1)!:{latitude:end.lat,longitude:end.lon};
  const now=new Date(),r=planningApiRequestSchema.parse({schemaVersion:'1.0.0',requestId:randomUUID(),origin:first,destination:last,
    vehicleVariantId:'a82a3933-a3fe-41f8-b830-b4b1a747a5ba',departureAt:new Date(now.getTime()+60000).toISOString(),startingChargePercent:95,startingChargeObservedAt:now.toISOString(),
    constraints:{minimumReserveChargePercent:10,targetArrivalChargePercent:20},vehicleDataQuality:'allow_engineering_estimates',
    stationDataQuality:process.argv.includes('--catalogue-scenario')?'catalogue_power_scenario':'verified_hardware'});
  const options=structuredClone(DEFAULT_OPTIMIZER_OPTIONS),preparation=planningPreparation(r);
  options.maxWeatherQueries=preparation.maxWeatherQueries;
  if(process.argv.includes('--larger-weather-budget'))options.maxWeatherQueries=preparation.maxWeatherQueries=10000;
  const began=performance.now();
  if(process.argv.includes('--http')){
    const response=await fetch('http://127.0.0.1:3000/v1/plans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(r),signal:AbortSignal.timeout(35000)});
    const body=planningApiResponseSchema.parse(await response.json());
    console.log(JSON.stringify({scope:'Controlled cached-route endpoints over the running public API; explicit test SOC, not the original phone request',
      httpStatus:response.status,requestId:body.requestId,status:body.status,reasons:body.status==='planned'?[]:body.reasons,
      policyVersion:body.metadata.policyVersion,encoding:response.headers.get('content-encoding'),wireBytes:Number(response.headers.get('content-length')),
      ...(body.status==='planned'?{stops:body.plan.chargingStops.length,planBytes:Buffer.byteLength(JSON.stringify(body.plan))}:{}),elapsedMs:Math.round(performance.now()-began)},null,2));return;
  }
  const outcome=await app.get(EvPlanningService).plan(toInternalRequest(r,29700),preparation,options,AbortSignal.timeout(31000));
  const routes=(outcome.replay as any)?.providers?.roads?.[0]?.response?.data?.routes??[];
  const weather=((outcome.replay as any)?.providers?.weather??[]).flatMap((w:any)=>w.response.data);
  console.log(JSON.stringify({scope:'Controlled reproduction using cached long-route endpoints, explicit test SOC 95/reserve10/arrival20; not proof of the exact phone request',
    usingRoadPoints:roadPoints,cachedAt:packet.retrievedAt,cachedDistanceKm:packet.data.trip.summary.length,elapsedMs:Math.round(performance.now()-began),
    candidates:(outcome.replay as any)?.context?.candidates?.candidates?.length,
    weatherDiagnostics:{statuses:weather.reduce((counts:any,f:any)=>({...counts,[f.status??'unknown']:(counts[f.status??'unknown']??0)+1}),{}),
      firstUnusable:weather.filter((f:any)=>!weatherForecastIsUsable(f,Date.now(),43200)).slice(0,1).map((f:any)=>({status:f.status,temperature:f.temperatureCelsius,wind:f.windSpeedKph,sourceUpdatedAt:f.sourceUpdatedAt,validAt:f.validAt,meta:f.metadata?{coverageStart:f.metadata.coverageStart,coverageEnd:f.metadata.coverageEnd}:null}))},
    roadSampling:routes.map((route:any)=>({segments:route.segments.length,geometryPoints:route.segments.reduce((n:number,s:any)=>n+s.geometry.length,0),elevationPoints:route.segments.reduce((n:number,s:any)=>n+(s.elevationProfile?.length??0),0),samples:sampleRouteWeather({route,departureAt:r.departureAt,stops:[]}).samples.length})),
    status:outcome.result.status,reasons:outcome.result.status==='planned'?[]:outcome.result.reasons,
    ...(outcome.result.status==='planned'?{planBytes:Buffer.byteLength(JSON.stringify(outcome.result.plan)),stops:outcome.result.plan.chargingStops.length}:{}),search:outcome.search},null,2));
}finally{await app.close();}}void main().catch(e=>{console.error(e instanceof Error?e.message:'Diagnostic failed');process.exitCode=1;});
