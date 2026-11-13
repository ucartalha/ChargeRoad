import type {Coordinate,WeatherQuery,RouteWeatherRequest,RoadSegment} from '@chargeroad/shared';
import {interpolate,meters} from '../roads/geometry';
import {WEATHER_POLICY,WEATHER_SAMPLING_POLICY as policy} from './weather-policy';
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

export interface NavigationWeatherState {routeId:string;windowStartMeters:number;windowEndMeters:number;departureAt:string;stopsKey:string;riskKey:string;}
export interface NavigationWeatherOptions {progressMeters:number;previous?:NavigationWeatherState;
  event?:'progress'|'start'|'eta_changed'|'charge_changed'|'deviation'|'cache_expired';
  criticalSegmentIds?:string[];riskSegmentIds?:string[];}

function terrain(segment:RoadSegment){
  const elevations=segment.elevationProfile?.map(p=>p.elevationMeters);
  return elevations?.length?{sampleElevationMeters:(Math.min(...elevations)+Math.max(...elevations))/2,
    sampleReliefMeters:Math.max(...elevations)-Math.min(...elevations)}:{};
}
function timedSegments(input:RouteWeatherRequest){
  if(input.route.segments.length>WEATHER_POLICY.maxQueries)throw new WeatherUnavailable('budget_exhausted','Weather segment budget');
  const ids=new Set(input.route.segments.map(s=>s.id)),stops=new Map<string,number|null>();
  for(const s of input.stops){if(!ids.has(s.segmentId)||stops.has(s.segmentId))throw new Error('Invalid or duplicate weather stop');stops.set(s.segmentId,s.delaySeconds);}
  let seconds=0,unknown=false;
  return input.route.segments.map(segment=>{
    const delay=stops.get(segment.id);if(delay===null)unknown=true;else seconds+=delay??0;
    const startSeconds=unknown?null:seconds;seconds+=segment.drivingDurationSeconds;
    return {segment,startSeconds};
  });
}
function pointOnSegment(segment:RoadSegment,fraction:number):Coordinate{
  const lengths=segment.geometry.slice(1).map((p,i)=>meters(segment.geometry[i],p));
  let distance=lengths.reduce((a,b)=>a+b,0)*Math.max(0,Math.min(1,fraction)),i=0;
  while(i<lengths.length-1&&distance>lengths[i])distance-=lengths[i++];
  return interpolate(segment.geometry[i],segment.geometry[i+1],lengths[i]===0?0:distance/lengths[i]);
}

/** Five actual geometry midpoints. These isolated samples cannot authorize an energy/charging plan. */
export function samplePreviewWeather(input:RouteWeatherRequest){
  const timeline=timedSegments(input),queries:WeatherQuery[]=[];
  for(let i=0;i<policy.previewLocations;i++){
    const distance=input.route.distanceMeters*(i+.5)/policy.previewLocations;
    const row=timeline.find(r=>r.segment.endDistanceMeters>=distance)!;
    if(row.startSeconds===null)continue;
    const fraction=(distance-row.segment.startDistanceMeters)/row.segment.distanceMeters,location=pointOnSegment(row.segment,fraction);
    queries.push({id:input.route.id+':preview:'+i,segmentId:row.segment.id,location,sampleLocation:location,...terrain(row.segment),
      validAt:new Date(Date.parse(input.departureAt)+(row.startSeconds+fraction*row.segment.drivingDurationSeconds)*1000).toISOString()});
  }
  return {queries,samples:queries.map(q=>q.location),unknownTimingSegmentIds:timeline.filter(r=>r.startSeconds===null).map(r=>r.segment.id),
    coverage:{kind:'isolated_samples' as const,endpointCoordinates:[input.route.segments[0].geometry[0],input.route.segments.at(-1)!.geometry.at(-1)!],
      detailedEnergyReady:false,requiresCriticalSectionValidation:true}};
}

/** Stateless rolling window. The caller owns its state, never a global user/SOC cache. */
export function sampleNavigationWeather(input:RouteWeatherRequest,options:NavigationWeatherOptions){
  const total=input.route.distanceMeters,progress=options.progressMeters;
  if(!Number.isFinite(progress)||progress<0||progress>total)throw new Error('Invalid navigation progress');
  const timeline=timedSegments(input),prior=options.previous,stopsKey=JSON.stringify(input.stops),departure=Date.parse(input.departureAt);
  const riskIds=new Set([...(options.criticalSegmentIds??[]),...(options.riskSegmentIds??[])]);
  const ids=new Set(input.route.segments.map(s=>s.id));if([...riskIds].some(id=>!ids.has(id)))throw new Error('Unknown weather risk segment');
  const riskKey=JSON.stringify([...riskIds].sort());
  const same=prior?.routeId===input.route.id&&Number.isFinite(prior.windowStartMeters)&&Number.isFinite(prior.windowEndMeters)&&
    prior.windowStartMeters>=0&&prior.windowEndMeters<=total&&prior.windowEndMeters-prior.windowStartMeters<=policy.lookAheadMeters&&
    Number.isFinite(Date.parse(prior.departureAt))&&progress>=prior.windowStartMeters&&progress<=prior.windowEndMeters;
  const etaChange=prior?Math.abs(departure-Date.parse(prior.departureAt))/1000:Infinity;
  const refresh=!same||progress-prior!.windowStartMeters>=policy.advanceMeters||etaChange>=policy.etaChangeSeconds||
    prior!.stopsKey!==stopsKey||prior!.riskKey!==riskKey||options.event==='start'||options.event==='deviation'||options.event==='cache_expired';
  if(!refresh)return {refresh:false as const,state:prior!,queries:[] as WeatherQuery[],samples:[] as Coordinate[],unknownTimingSegmentIds:[] as string[],
    coverage:{startMeters:prior!.windowStartMeters,endMeters:prior!.windowEndMeters,wholeRouteReady:false}};
  const end=Math.min(total,progress+policy.lookAheadMeters),rows=timeline.filter(r=>r.segment.endDistanceMeters>progress&&r.segment.startDistanceMeters<end);
  const distances=new Set<number>([progress,end]),step=total<=policy.shortRouteMeters?policy.shortStepMeters:policy.longStepMeters;
  for(let d=progress+step;d<end;d+=step)distances.add(d);
  // Gradual climbs can have little relief per segment but a large change across a coarse interval.
  for(let a=progress;a<end;a+=step){
    const b=Math.min(end,a+step),interval=rows.filter(r=>r.segment.endDistanceMeters>a&&r.segment.startDistanceMeters<b);
    const heights=interval.flatMap(r=>r.segment.elevationProfile?.map(p=>p.elevationMeters)??[]);
    if(interval.some(r=>!r.segment.elevationProfile)||heights.length&&Math.max(...heights)-Math.min(...heights)>=policy.terrainReliefMeters)
      for(let d=a+policy.riskStepMeters;d<b;d+=policy.riskStepMeters)distances.add(d);
  }
  for(const {segment:s}of rows){
    const relief=terrain(s).sampleReliefMeters;
    if(riskIds.has(s.id)||relief!==undefined&&relief>=policy.terrainReliefMeters||input.stops.some(stop=>stop.segmentId===s.id)||s.startsAtChargingAccess||s.endsAtChargingAccess){
      const a=Math.max(progress,s.startDistanceMeters),b=Math.min(end,s.endDistanceMeters);
      distances.add(a);distances.add(b);for(let d=a+policy.riskStepMeters;d<b;d+=policy.riskStepMeters)distances.add(d);
    }
  }
  const samples=[...distances].sort((a,b)=>a-b).map(d=>{const row=timeline.find(r=>r.segment.endDistanceMeters>=d)!;
    return pointOnSegment(row.segment,(d-row.segment.startDistanceMeters)/row.segment.distanceMeters);});
  const unique=[...new Map(samples.map(p=>[p.latitude+','+p.longitude,p])).values()];
  if(unique.length>WEATHER_POLICY.maxSamples)throw new WeatherUnavailable('budget_exhausted','Weather sample budget');
  const queries=rows.filter(r=>r.startSeconds!==null).map(({segment:s,startSeconds})=>{
    const location=pointOnSegment(s,.5),sampleLocation=unique.reduce((best,p)=>meters(location,p)<meters(location,best)?p:best,unique[0]);
    // Do not attach elevation at the target to a distant sample's terrain context.
    const context=meters(location,sampleLocation)<=policy.spatialMaxOffsetMeters?terrain(s):{};
    if(meters(location,sampleLocation)>WEATHER_POLICY.sampleDistanceMeters)throw new WeatherUnavailable('budget_exhausted','Weather spatial coverage gap');
    return {id:input.route.id+':navigation:'+s.id,segmentId:s.id,location,sampleLocation,...context,
      validAt:new Date(departure+(startSeconds!+s.drivingDurationSeconds/2)*1000).toISOString()};
  });
  const state={routeId:input.route.id,windowStartMeters:progress,windowEndMeters:end,departureAt:input.departureAt,stopsKey,riskKey};
  return {refresh:true as const,state,queries,samples:unique,unknownTimingSegmentIds:rows.filter(r=>r.startSeconds===null).map(r=>r.segment.id),
    coverage:{startMeters:progress,endMeters:end,wholeRouteReady:progress===0&&end===total}};
}
