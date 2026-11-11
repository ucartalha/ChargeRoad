import { roadRoutingRequestSchema,stationRoadAccessSchema,stationRoadAccessRequestSchema } from '@chargeroad/shared';
import type { RoadRoute,RoadRoutingRequest,Coordinate,StationRoadAccessRequest,StationRoadAccess } from '@chargeroad/shared';
import { RoutingProvider } from '../providers/routing-provider';
import { DbStationDataProvider } from '../stations/db-station.provider';
import { DatabaseService } from '../database/database.service';
import type { RoadAttributeProvider,RoadJsonClient,RoadShapeAdapter } from './provider-ports';
import { BoundedRoadClient,RoadProviderError } from './road-client';
import type { RoadConfig } from './road-policy';
import { normalizeRoadTrip } from './normalize-road';
import { interpolate,meters } from './geometry';

export class RoadAdapterRegistry {
  private readonly adapters=new Map<string,RoadShapeAdapter>();
  constructor(adapters:RoadShapeAdapter[]){for(const adapter of adapters){if(this.adapters.has(adapter.id))throw new Error('Duplicate road adapter');this.adapters.set(adapter.id,adapter);}}
  get(id:string){const adapter=this.adapters.get(id);if(!adapter||!adapter.capabilities.freeMapReuse)throw new RoadProviderError('No configured adapter with approved map reuse');return adapter;}
}
export class RoadRoutingService extends RoutingProvider {
  constructor(private readonly config:RoadConfig,readonly registry:RoadAdapterRegistry,private readonly client:RoadJsonClient,
    private readonly attributes:RoadAttributeProvider,private readonly database:DatabaseService){super();}
  async routes(request:RoadRoutingRequest,signal:AbortSignal){
    const parsed=this.validate(request);const client=new BoundedRoadClient(this.client,this.config.maxActions);
    const routes=await this.calculate(parsed,[parsed.origin,parsed.destination],client,signal);
    return {data:routes===null?null:{schemaVersion:'1.0.0' as const,routes},source:{sourceId:this.config.providerId,recordId:null,version:'road-pilot/1.0.0',
      url:this.config.baseUrl,retrievedAt:routes?.[0].source.retrievedAt??new Date().toISOString(),publishedAt:null,license:routes?.[0].source.license??null}};
  }
  private validate(input:RoadRoutingRequest){
    if(!this.config.enabled)throw new RoadProviderError('Road pilot is disabled');
    const request=roadRoutingRequestSchema.parse(input);
    if(request.alternatives>this.config.maxAlternatives||request.segmentationPolicy.maxDistanceMeters<100||
      request.segmentationPolicy.maxDurationSeconds<10||request.segmentationPolicy.maxWeatherTimeStepSeconds<10)
      throw new RoadProviderError('Road request exceeds segmentation/alternative policy',422);
    try{new Intl.DateTimeFormat('en',{timeZone:request.originTimeZone??'Europe/Istanbul'});}catch{throw new RoadProviderError('Invalid origin timezone',422);}
    return request;
  }
  private async calculate(request:RoadRoutingRequest,locations:Coordinate[],client:RoadJsonClient,signal:AbortSignal){
    const adapter=this.registry.get(this.config.providerId);signal.throwIfAborted();
    if(locations.length>2&&!adapter.capabilities.via)throw new RoadProviderError('Configured road adapter does not support via locations',422);
    if(request.alternatives>1&&!adapter.capabilities.alternatives)throw new RoadProviderError('Configured road adapter does not support alternatives',422);
    const trips=await adapter.route(request,locations,client,signal);if(trips===null)return null;
    const eligible=trips.filter(t=>(!request.avoidTolls||t.hasToll===false)&&(!request.avoidFerries||t.hasFerry===false));
    if(!eligible.length)throw new RoadProviderError('No returned road route confirms the requested toll/ferry constraints',422);
    const results:RoadRoute[]=[];
    for(const trip of eligible){
      for(const leg of trip.legs){
        try{leg.edges=await adapter.attributes(leg,client,signal);}catch{signal.throwIfAborted();leg.edges=[];trip.warnings.push('road_attributes_unavailable_or_unmatched');}
      }
      const wayIds=trip.legs.flatMap(l=>l.edges.map(e=>e.osmWayId).filter((id):id is string=>id!==null));
      let tags=new Map();try{tags=await this.attributes.getWays(wayIds,client,signal);}catch{signal.throwIfAborted();trip.warnings.push('osm_speed_tags_unavailable');}
      results.push(normalizeRoadTrip(trip,request,this.config,tags));
    }
    return results;
  }
  async stationAccess(raw:StationRoadAccessRequest,signal:AbortSignal){
    const input=stationRoadAccessRequestSchema.parse(raw),request=this.validate(input.roadRequest);
    const client=new BoundedRoadClient(this.client,this.config.maxActions);
    const routes=await this.calculate(request,[request.origin,request.destination],client,signal);
    if(!routes||!routes[input.routeIndex])return {baseRoute:null,access:[],warnings:['requested_base_route_unavailable']};
    const route=routes[input.routeIndex],set=await new DbStationDataProvider(this.database).findAlongRoutes([route],2000,signal);
    const access:StationRoadAccess[]=[];
    let budgetExhausted=false;
    for(const stationId of input.stationIds){
      const empty={stationId,baseRouteId:route.id,entryDistanceMeters:null,exitDistanceMeters:null,anchorEntry:null,anchorExit:null,
        departureAt:null,replacementRoute:null,replacedDistanceMeters:null,replacedDurationSeconds:null,additionalDistanceMeters:null,
        additionalDurationSeconds:null,stationSnapDistanceMeters:null,physicalAccessVerified:false as const,warnings:[] as string[]};
      const candidate=set.data.candidates.find(c=>c.station.id===stationId);
      if(budgetExhausted){access.push(stationRoadAccessSchema.parse({...empty,status:'budget_exhausted',warnings:['route_acquisition_budget_exhausted']}));continue;}
      if(!candidate){access.push(stationRoadAccessSchema.parse({...empty,status:'not_in_candidate_set',warnings:['station_not_in_bounded_route_candidates']}));continue;}
      const match=[...candidate.routeMatches].sort((a,b)=>a.distanceMeters-b.distanceMeters)[0];
      const segment=route.segments.find(s=>s.id===match.segmentId)!;
      const progress=segment.startDistanceMeters+segment.distanceMeters*match.segmentProgress;
      const entry=Math.max(0,progress-1000),exit=Math.min(route.distanceMeters,progress+1000);
      const start=pointAt(route,entry),end=pointAt(route,exit),startSeconds=timeAt(route,entry),endSeconds=timeAt(route,exit);
      const departureAt=new Date(Date.parse(request.departureAt)+startSeconds*1000).toISOString();
      let via:RoadRoute[]|null;
      try{via=await this.calculate({...request,departureAt,alternatives:1},[start,candidate.station.location,end],client,signal);}
      catch(error){signal.throwIfAborted();budgetExhausted=error instanceof RoadProviderError&&error.status===429;
        access.push(stationRoadAccessSchema.parse({...empty,status:budgetExhausted?'budget_exhausted':'provider_unavailable',warnings:['station_access_query_incomplete']}));continue;}
      if(!via){access.push(stationRoadAccessSchema.parse({...empty,status:'no_route'}));continue;}
      const replacement=via[0];const split=replacement.segments.find(s=>s.endsAtChargingAccess)?.geometry.at(-1);
      const snap=split?meters(split,candidate.station.location):null;
      access.push(stationRoadAccessSchema.parse({...empty,status:snap===null||snap>100?'snap_too_far':'routed_to_catalogue_coordinate',
        entryDistanceMeters:entry,exitDistanceMeters:exit,anchorEntry:start,anchorExit:end,departureAt,replacementRoute:replacement,
        replacedDistanceMeters:exit-entry,replacedDurationSeconds:endSeconds-startSeconds,
        additionalDistanceMeters:replacement.distanceMeters-(exit-entry),additionalDurationSeconds:replacement.drivingDurationSeconds-(endSeconds-startSeconds),
        stationSnapDistanceMeters:snap,warnings:['catalogue_coordinate_is_not_a_verified_vehicle_entrance','approach_direction_and_physical_access_unverified',
          ...(replacement.distanceMeters<exit-entry?['replacement_is_shorter_than_base_subpath']:[])]}));
    }
    return {baseRoute:route,access,candidateCoverage:set.data.metadata};
  }
}
export function pointAt(route:RoadRoute,distance:number):Coordinate{
  const segment=route.segments.find(s=>distance<=s.endDistanceMeters)??route.segments.at(-1)!;
  const f=Math.max(0,Math.min(1,(distance-segment.startDistanceMeters)/segment.distanceMeters));
  return interpolate(segment.geometry[0],segment.geometry.at(-1)!,f);
}
export function timeAt(route:RoadRoute,distance:number){let elapsed=0;for(const s of route.segments){
  if(distance>=s.endDistanceMeters)elapsed+=s.drivingDurationSeconds;else{elapsed+=Math.max(0,distance-s.startDistanceMeters)/s.distanceMeters*s.drivingDurationSeconds;break;}}
  return elapsed;}
