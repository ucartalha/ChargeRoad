import { createHash } from 'node:crypto';
import { roadRouteSchema } from '@chargeroad/shared';
import type { RoadRoute,RoadRoutingRequest,RoadSegment,Coordinate } from '@chargeroad/shared';
import type { RoadTripInput,WayTags,SpeedLimitValue } from './provider-ports';
import type { RoadConfig } from './road-policy';
import { cumulative,interpolate,bearing } from './geometry';
import { parseOsmSpeed } from './osm-attributes';

export function normalizeRoadTrip(trip:RoadTripInput,request:RoadRoutingRequest,config:RoadConfig,tags:Map<string,WayTags>):RoadRoute{
  const fingerprint=createHash('sha256').update(JSON.stringify({provider:config.providerId,request,trip})).digest('hex').slice(0,20);
  const source={sourceId:config.providerId,recordId:fingerprint,version:null,url:trip.sourceUrl,retrievedAt:trip.retrievedAt,publishedAt:null,license:trip.license};
  const segments:RoadSegment[]=[],maneuvers:{instruction:string;type:number;startDistanceMeters:number;endDistanceMeters:number}[]=[];
  const warnings=new Set([...trip.warnings,...(trip.traffic!=='live'?['live_traffic_unavailable']:[]),'speed_is_travel_time_average','elevation_dataset_not_independently_verified']);
  let offset=0;
  for(const [legIndex,leg]of trip.legs.entries()){
    if(legIndex>0){const prev=trip.legs[legIndex-1].geometry.at(-1)!;const next=leg.geometry[0];
      if(Math.abs(prev.latitude-next.latitude)>1e-6||Math.abs(prev.longitude-next.longitude)>1e-6)throw new Error('Road legs are disconnected');}
    if(leg.distanceMeters<=0||leg.seconds<=0)throw new Error('Road leg has no traversable length/time');
    const geom=cumulative(leg.geometry),geometricLength=geom.at(-1)!;
    if(geometricLength<=0)throw new Error('Zero road geometry');
    const distances=geom.map(n=>n/geometricLength*leg.distanceMeters);
    const edgeAt=new Map<number,(typeof leg.edges)[number]>();
    for(const edge of leg.edges){
      if(edge.begin<0||edge.end>=leg.geometry.length||edge.begin>=edge.end)throw new Error('Invalid road edge indices');
      for(let index=edge.begin;index<edge.end;index++){
        if(edgeAt.has(index))throw new Error('Overlapping road edge attributes');edgeAt.set(index,edge);
      }
    }
    const times=Array(leg.geometry.length-1).fill(0) as number[];
    for(const m of leg.maneuvers){
      if(m.begin>m.end||m.end>=leg.geometry.length)throw new Error('Invalid maneuver indices');
      maneuvers.push({instruction:m.instruction,type:m.type,startDistanceMeters:offset+distances[m.begin],endDistanceMeters:offset+distances[m.end]});
      const length=distances[m.end]-distances[m.begin];
      if(length>0)for(let i=m.begin;i<m.end;i++)times[i]+=m.seconds*(distances[i+1]-distances[i])/length;
    }
    const assigned=times.reduce((a,b)=>a+b,0);
    if(assigned<=0)throw new Error('Road maneuver durations missing');
    // Provider rounded maneuver totals may differ. Preserve the authoritative leg elapsed time.
    if(Math.abs(assigned-leg.seconds)>1)warnings.add('maneuver_duration_reconciled_to_leg_total');
    for(let i=0;i<times.length;i++)times[i]*=leg.seconds/assigned;
    const height=(d:number):number|null=>{
      if(!leg.elevation||leg.elevation.values.length<2)return null;
      const e=leg.elevation;if(Math.ceil(leg.distanceMeters/e.intervalMeters)+1!==e.values.length)return null;
      const index=Math.min(Math.floor(d/e.intervalMeters),e.values.length-2),x=index*e.intervalMeters,
        end=index===e.values.length-2?leg.distanceMeters:(index+1)*e.intervalMeters;
      const a=e.values[index],b=e.values[index+1];if(a===null||b===null||a<=-32000||b<=-32000)return null;
      return a+(b-a)*(d-x)/(end-x);
    };
    for(let i=0;i<leg.geometry.length-1;i++){
      const length=distances[i+1]-distances[i];if(length<1e-6)continue;
      if(times[i]<=0)throw new Error('Road geometry has uncovered duration');
      const edge=edgeAt.get(i);
      let speed:SpeedLimitValue=parseOsmSpeed(edge?.osmWayId?tags.get(edge.osmWayId):undefined,edge?.forward);
      if(speed.kind==='unknown'&&edge?.speedLimit){speed=edge.speedLimit===255?{...speed,kind:'unlimited'}:
        edge.speedLimit>0&&edge.speedLimit<=300?{value:edge.speedLimit,kind:'provider_derived',raw:String(edge.speedLimit),source}:speed;}
      const count=Math.ceil(Math.max(length/request.segmentationPolicy.maxDistanceMeters,times[i]/Math.min(request.segmentationPolicy.maxDurationSeconds,request.segmentationPolicy.maxWeatherTimeStepSeconds)));
      if(segments.length+count>config.maxSegments)throw new Error('Road segment budget exceeded');
      const breaks=Array.from({length:count+1},(_,j)=>distances[i]+length*j/count);
      if(leg.elevation){const step=leg.elevation.intervalMeters;
        for(let d=(Math.floor(distances[i]/step)+1)*step;d<distances[i+1];d+=step){
          const left=Math.max(0,d-step),right=Math.min(leg.distanceMeters,d+step),a=height(left),b=height(d),c=height(right);
          if(a!==null&&b!==null&&c!==null&&right>d&&d>left&&Math.abs((b-a)/(d-left)-(c-b)/(right-d))*100>=request.segmentationPolicy.splitAtGradeChangePercent)breaks.push(d);
        }}
      breaks.sort((a,b)=>a-b);const boundaries=[...new Set(breaks)];
      for(let j=0;j<boundaries.length-1;j++){
        if(segments.length>=config.maxSegments)throw new Error('Road segment budget exceeded');
        const start=boundaries[j],end=boundaries[j+1],span=end-start;
        const geometry=[interpolate(leg.geometry[i],leg.geometry[i+1],(start-distances[i])/length),interpolate(leg.geometry[i],leg.geometry[i+1],(end-distances[i])/length)];
        const knots=[start];if(leg.elevation)for(let d=(Math.floor(start/leg.elevation.intervalMeters)+1)*leg.elevation.intervalMeters;d<end;d+=leg.elevation.intervalMeters)knots.push(d);knots.push(end);
        const values=knots.map(d=>({distanceFromStartMeters:d-start,elevationMeters:height(d)}));
        const elevationProfile=values.every(v=>v.elevationMeters!==null)?values as {distanceFromStartMeters:number;elevationMeters:number}[]:null;
        const gain=elevationProfile?.slice(1).reduce((n,p,k)=>n+Math.max(0,p.elevationMeters-elevationProfile[k].elevationMeters),0)??null;
        const loss=elevationProfile?.slice(1).reduce((n,p,k)=>n+Math.max(0,elevationProfile[k].elevationMeters-p.elevationMeters),0)??null;
        const seconds=times[i]*span/length;
        const segment:RoadSegment={id:fingerprint+':'+segments.length,sourceEdgeIds:[edge?.sourceEdgeId??config.providerId+':shape:'+legIndex+':'+i],
          startDistanceMeters:offset+start,endDistanceMeters:offset+end,distanceMeters:span,drivingDurationSeconds:seconds,geometry,
          roadClass:edge?.roadClass??'unknown',bearingDegrees:bearing(geometry[0],geometry[1]),expectedSpeedKph:span/seconds*3.6,
          expectedSpeedBasis:'travel_time_average',speedLimitKph:speed.value,speedLimitKind:speed.kind,speedLimitRaw:speed.raw,speedLimitSource:speed.source,
          elevationProfile,elevationGainMeters:gain,elevationLossMeters:loss,
          startsAtChargingAccess:legIndex>0&&i===0&&j===0,
          endsAtChargingAccess:legIndex<trip.legs.length-1&&i===leg.geometry.length-2&&j===boundaries.length-2};
        segments.push(segment);
      }
    }
    offset+=leg.distanceMeters;
  }
  if(segments.some(s=>s.elevationProfile===null))warnings.add('elevation_missing');
  if(segments.some(s=>s.speedLimitKind==='unknown'||s.speedLimitKind==='conditional_unresolved'))warnings.add('speed_limits_incomplete');
  if(segments.reduce((n,s)=>n+s.geometry.length,0)>config.maxPoints)throw new Error('Normalized geometry budget exceeded');
  const known=segments.filter(s=>s.speedLimitKph!==null||s.speedLimitKind==='unlimited').reduce((n,s)=>n+s.distanceMeters,0);
  return roadRouteSchema.parse({id:config.providerId+':'+fingerprint,distanceMeters:offset,
    drivingDurationSeconds:segments.reduce((n,s)=>n+s.drivingDurationSeconds,0),segments,segmentationPolicy:request.segmentationPolicy,source,
    metadata:{providerId:config.providerId,traffic:trip.traffic,departureUsedAt:new Date(Math.floor(Date.parse(request.departureAt)/60000)*60000).toISOString(),originTimeZone:request.originTimeZone??'Europe/Istanbul',
      warnings:[...warnings],attributions:trip.attributions,maneuvers,
      speedLimitKnownMeters:known,speedLimitUnknownMeters:Math.max(0,offset-known),durationAllocation:'maneuver_weighted',
      usage:config.usePublicDemo?'development_pilot':'configured_service'}});
}
