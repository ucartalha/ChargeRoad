import type {Coordinate,WeatherQuery,RouteWeatherRequest} from '@chargeroad/shared';
import {interpolate,meters} from '../roads/geometry';
import {WEATHER_POLICY} from './weather-policy';
import {WeatherUnavailable} from './weather-ports';

// Stops apply immediately BEFORE the named segment. Null means unknown waiting time.
export function sampleRouteWeather(input:RouteWeatherRequest){
  const segments=input.route.segments;
  if(segments.length>WEATHER_POLICY.maxQueries)throw new WeatherUnavailable('budget_exhausted','Weather segment budget');
  const ids=new Set(segments.map(s=>s.id)),delays=new Map<string,number|null>();
  for(const stop of input.stops){if(!ids.has(stop.segmentId)||delays.has(stop.segmentId))throw new Error('Invalid or duplicate weather stop');delays.set(stop.segmentId,stop.delaySeconds);}
  const samples:Coordinate[]=[segments[0].geometry[0]],queries:WeatherQuery[]=[],unknownTiming:string[]=[];
  let elapsed=0,lastDistance=0,lastTime=0,unknown=false;
  for(const segment of segments){
    const delay=delays.get(segment.id);
    if(delay===null)unknown=true;else elapsed+=delay??0;
    if(unknown){unknownTiming.push(segment.id);continue;}
    if(segment.startDistanceMeters-lastDistance>=WEATHER_POLICY.sampleDistanceMeters||elapsed-lastTime>=WEATHER_POLICY.sampleSeconds||delays.has(segment.id)||segment.startsAtChargingAccess){
      samples.push(segment.geometry[0]);lastDistance=segment.startDistanceMeters;lastTime=elapsed;
    }
    // Distance-weighted geometry midpoint, including non-uniform shape point spacing.
    const lengths=segment.geometry.slice(1).map((p,i)=>meters(segment.geometry[i],p));
    let half=lengths.reduce((a,b)=>a+b,0)/2,index=0;
    while(index<lengths.length-1&&half>lengths[index])half-=lengths[index++];
    const location=interpolate(segment.geometry[index],segment.geometry[index+1],lengths[index]===0?0:half/lengths[index]);
    queries.push({id:input.route.id+':weather:'+segment.id,segmentId:segment.id,location,
      validAt:new Date(Date.parse(input.departureAt)+(elapsed+segment.drivingDurationSeconds/2)*1000).toISOString()});
    elapsed+=segment.drivingDurationSeconds;
  }
  if(!unknown)samples.push(segments.at(-1)!.geometry.at(-1)!);
  const unique=[...new Map(samples.map(p=>[p.latitude+','+p.longitude,p])).values()];
  if(unique.length>WEATHER_POLICY.maxSamples)throw new WeatherUnavailable('budget_exhausted','Weather sample budget');
  for(const query of queries){
    query.sampleLocation=unique.reduce((best,p)=>meters(query.location,p)<meters(query.location,best)?p:best,unique[0]);
    if(meters(query.location,query.sampleLocation)>WEATHER_POLICY.sampleDistanceMeters)throw new WeatherUnavailable('budget_exhausted','Weather spatial coverage gap');
  }
  return {queries,samples:unique,unknownTimingSegmentIds:unknownTiming};
}
