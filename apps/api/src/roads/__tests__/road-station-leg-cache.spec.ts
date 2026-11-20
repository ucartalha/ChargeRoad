import type { RoadJsonClient,RoadShapeAdapter } from '../provider-ports';
import { RoadAttributeProvider } from '../provider-ports';
import { RoadAdapterRegistry,RoadRoutingService } from '../road-service';
import { ROAD_STATION_LEG_CACHE,stationLegCacheSeconds } from '../road-source-policy';
import { ValhallaRoadAdapter } from '../valhalla-adapter';
import type { DatabaseService } from '../../database/database.service';
import { config,roadRequest,trip } from './fixtures';

// Station leg cache (2026-11-20): a leg between two charging stations is the same road for every user and every hour
// (probe: 40 station pairs x 5 departures, identical Valhalla answers). With a declared cache revision such legs stay in
// the road cache for ROAD_STATION_LEG_CACHE.defaultSeconds instead of one hour; everything else keeps config.cacheSeconds.
class NoTags extends RoadAttributeProvider{async getWays(){return new Map();}}
function service(roadConfig=config){
  const seen:(number|undefined)[]=[];
  const client:RoadJsonClient={post:async(_id,_url,_body,_signal,cacheSeconds)=>{seen.push(cacheSeconds);return {data:{},retrievedAt:'2026-11-11T13:00:00Z'};}};
  const adapter:RoadShapeAdapter={id:roadConfig.providerId,capabilities:{alternatives:true,via:true,traffic:'none',freeMapReuse:true},
    route:async(_request,_locations,c,signal)=>{await c.post(roadConfig.providerId,roadConfig.baseUrl+'/route',{},signal);return [trip()];},
    attributes:async(_leg,c,signal)=>{await c.post(roadConfig.providerId,roadConfig.baseUrl+'/trace_attributes',{},signal);return [];}};
  return {seen,roads:new RoadRoutingService(roadConfig,new RoadAdapterRegistry([adapter]),client,new NoTags(),{} as DatabaseService)};
}
const revised={...config,cacheRevision:'graph-2026-11',stationLegCacheSeconds:ROAD_STATION_LEG_CACHE.defaultSeconds};
describe('Station leg road cache',()=>{
  it('keeps station-to-station legs for the long TTL when a cache revision is declared',async()=>{
    const {seen,roads}=service(revised);
    await roads.routes(roadRequest(),new AbortController().signal,{stationPair:true});
    expect(seen).toEqual([ROAD_STATION_LEG_CACHE.defaultSeconds,ROAD_STATION_LEG_CACHE.defaultSeconds]);
  });
  it('leaves user legs and undeclared revisions on the normal TTL',async()=>{
    const user=service(revised);await user.roads.routes(roadRequest(),new AbortController().signal);
    expect(user.seen).toEqual([undefined,undefined]);
    const unversioned=service({...config,stationLegCacheSeconds:ROAD_STATION_LEG_CACHE.defaultSeconds});
    await unversioned.roads.routes(roadRequest(),new AbortController().signal,{stationPair:true});
    expect(unversioned.seen).toEqual([undefined,undefined]);
  });
  it('needs a declared revision, never longer than the policy maximum',()=>{
    expect(stationLegCacheSeconds(config)).toBeUndefined();
    expect(stationLegCacheSeconds({...config,stationLegCacheSeconds:86400})).toBeUndefined();
    expect(stationLegCacheSeconds(revised)).toBe(ROAD_STATION_LEG_CACHE.defaultSeconds);
    expect(ROAD_STATION_LEG_CACHE.maxSeconds).toBeGreaterThanOrEqual(ROAD_STATION_LEG_CACHE.defaultSeconds);
  });
});
describe('Valhalla departure in the request body',()=>{
  // road-departure-bucket/2.0.0: the body carries one fixed local time, so a road has one cache key at every hour.
  it('sends the same body for any departure',async()=>{
    const bodies:unknown[]=[];const client:RoadJsonClient={post:async(_id,_url,body)=>{bodies.push(body);return {data:{error_code:442},retrievedAt:'2026-11-11T13:00:00Z'};}};
    const adapter=new ValhallaRoadAdapter(config);
    for(const departureAt of ['2026-11-11T13:05:00Z','2026-11-12T02:00:00Z','2026-11-15T19:30:00Z']){
      const request={...roadRequest(),departureAt,originTimeZone:'Europe/Istanbul'};
      await adapter.route(request,[request.origin,request.destination],client,new AbortController().signal);
    }
    expect(new Set(bodies.map(b=>JSON.stringify(b))).size).toBe(1);
    expect((bodies[0] as {date_time:{type:number;value:string}}).date_time.type).toBe(1);
  });
});
