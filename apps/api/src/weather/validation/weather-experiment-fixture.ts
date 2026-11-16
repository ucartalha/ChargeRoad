/** Synthetic scaled vehicle/graph only; real service/session/optimizer/engines. Not a road engine copy. */
import {optimizerWorld} from '../../planning/__tests__/optimizer.fixtures';
import {EvPlanningService} from '../../planning/ev-planning.service';
import {ChargeStopOptimizer} from '../../planning/charge-stop-optimizer';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {ChargingCurveEngine} from '../../charging/charging-engine';
import {document} from '../__tests__/fixtures';
import type {WeatherProvider} from '../../providers/weather-provider';
import type {RoadRoute,EnergyEvaluationResult} from '@chargeroad/shared';
export type WeatherExperimentCase='short'|'motorway600'|'long850'|'mountain'|'wind_shift'|'reserve';
export const weatherExperimentCases:WeatherExperimentCase[]=['short','motorway600','long850','mountain','wind_shift','reserve'];
export function experimentDocument(latitude:number,longitude:number,kind:WeatherExperimentCase){
 const doc=document(),body=doc.body as any,base=Date.now(),index=Math.round((latitude-35)*111.195);
 body.geometry.coordinates=[longitude,latitude,kind==='mountain'?800+Math.max(0,1000-Math.abs(index-300)*20):800];
 body.properties.meta.updated_at=new Date(base).toISOString();
 const template=body.properties.timeseries[0];
 body.properties.timeseries=Array.from({length:49},(_,hour)=>{
  const row=structuredClone(template);row.time=new Date(base+hour*3600000).toISOString();
  row.data.instant.details.air_temperature=30;row.data.instant.details.wind_speed=kind==='wind_shift'?10:0;
  row.data.next_1_hours.details.precipitation_amount=0;row.data.next_1_hours.details.probability_of_precipitation=0;
  row.data.instant.details.wind_from_direction=kind==='wind_shift'&&index>300?180:0;return row;
 });
 // Seeded warm rows must represent the same source/revalidation epoch as cold HTTP.
 doc.fetchedAt=doc.validatedAt=new Date(base).toISOString();doc.lastModified=new Date(base).toUTCString();
 return doc;
}
export function weatherExperimentWorld(kind:WeatherExperimentCase,weather:WeatherProvider){
 const km=kind==='short'?120:kind==='long850'?850:600,w=optimizerWorld(false);
 const positions:Record<string,number>={origin:0,a:.25,b:.5,c:.75,destination:1};
 w.locations.c={...w.locations.b};const third=structuredClone(w.candidates.candidates[1]);third.station.id='c';third.station.location=w.locations.c;w.candidates.candidates.push(third);
 for(const [id,p]of Object.entries(w.locations)){p.latitude=35+positions[id]*km/111.195;p.longitude=32.8;}
 w.vehicle.capacity.referenceUsableBatteryKwh=80;w.vehicle.consumptionReferences.forEach(r=>{r.valueKwhPer100Km=20;r.conditions.meanSpeedKph=100;});
 w.request.startingChargePercent=kind==='reserve'?61:90;
 w.options.maxStates=2;w.request.policy.maxComputationMilliseconds=120000;
 const template=w.route('origin','destination');
 const road=(origin:typeof w.request.origin,destination:typeof origin):RoadRoute=>{
  const start=(origin.latitude-35)*111.195*1000,end=(destination.latitude-35)*111.195*1000,total=Math.abs(end-start),count=Math.max(1,Math.ceil(total/1000)),span=total/count;
  const elevation=(distance:number)=>kind==='mountain'?800+Math.max(0,1000-Math.abs(distance/1000-300)*20):800;
  const route={...structuredClone(template),id:'synthetic-'+Math.round(start)+'-'+Math.round(end),distanceMeters:total,drivingDurationSeconds:total/1000*36,
   segments:Array.from({length:count},(_,i)=>{const a=start+(end-start)*i/count,b=start+(end-start)*(i+1)/count,h0=elevation(a),h1=elevation(b);return {...structuredClone(template.segments[0]),id:'s-'+Math.round(start)+'-'+i,
    startDistanceMeters:i*span,endDistanceMeters:(i+1)*span,distanceMeters:span,drivingDurationSeconds:span/1000*36,expectedSpeedKph:100,speedLimitKph:120,
    roadClass:'motorway' as const,bearingDegrees:end>=start?0:180,elevationQuality:'modelled' as const,
    geometry:[{latitude:35+a/111195,longitude:32.8},{latitude:35+b/111195,longitude:32.8}],
    elevationProfile:[{distanceFromStartMeters:0,elevationMeters:h0},{distanceFromStartMeters:span,elevationMeters:h1}],elevationGainMeters:Math.max(0,h1-h0),elevationLossMeters:Math.max(0,h0-h1)};})};
  route.metadata!.speedLimitKnownMeters=total;return route;
 };
 const roads={routes:async(r:{origin:typeof w.request.origin;destination:typeof w.request.origin})=>({data:{schemaVersion:'1.0.0' as const,routes:[road(r.origin,r.destination)]},source:template.source})};
 for(const c of w.candidates.candidates){const p=positions[c.station.id]*km;
  c.routeMatches=[{routeId:road(w.request.origin,w.request.destination).id,segmentId:'s-0-'+Math.min(km-1,Math.floor(p)),segmentProgress:p%1,distanceMeters:0}];
 }
 const evaluations:EnergyEvaluationResult[]=[],energy=new EnergyConsumptionEngine(),evaluate=energy.evaluate.bind(energy);
 energy.evaluate=async(...args)=>{const result=await evaluate(...args);evaluations.push(result);return result;};
 const service=new EvPlanningService(w.vehicles as never,roads as never,w.stations as never,weather,energy,new ChargingCurveEngine(),new ChargeStopOptimizer());
 return {...w,service,evaluations,km};
}
