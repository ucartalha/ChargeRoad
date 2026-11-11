import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseOsmSpeed } from '../osm-attributes';
import { normalizeRoadTrip } from '../normalize-road';
import { ValhallaRoadAdapter,localDeparture } from '../valhalla-adapter';
import { RoadAdapterRegistry } from '../road-service';
import { config,roadRequest,tags,trip } from './fixtures';
import { decodePolyline6 } from '../geometry';
import type { RoadJsonClient,RoadTripInput } from '../provider-ports';
import { roadConfig } from '../road-policy';

describe('Free map-reusable road normalization',()=>{
  it('refuses the shared development routing service in production',()=>{
    const original={...process.env};
    try{process.env.NODE_ENV='production';process.env.ROAD_ROUTING_PILOT_ENABLED='true';
      process.env.ROAD_ROUTING_BASE_URL='https://valhalla1.openstreetmap.de';
      expect(()=>roadConfig()).toThrow('production');
    }finally{process.env=original;}
  });
  it('does not mistake an exact map-match error for a confirmed absence of road',async()=>{
    const client:RoadJsonClient={post:async()=>({data:{error_code:443},retrievedAt:'2026-11-11T13:00:00Z'})};
    const request=roadRequest();
    await expect(new ValhallaRoadAdapter(config).route(request,[request.origin,request.destination],client,new AbortController().signal)).rejects.toThrow('routing error');
  });
  it('separates posted limits from model travel speed and unknown values',()=>{
    const route=normalizeRoadTrip(trip(),roadRequest(),config,new Map([['123',tags({maxspeed:'90'})]]));
    expect(route.segments.every(s=>s.speedLimitKph===90)).toBe(true);
    for(const segment of route.segments)expect(segment.expectedSpeedKph).toBeCloseTo(30);
    expect(route.segments[0].speedLimitKind).toBe('posted');expect(route.metadata?.traffic).toBe('none');
  });
  it.each(['signals','walk','TR:urban','50;70','0','999'])('does not invent a numeric limit from %s',raw=>{
    expect(parseOsmSpeed(tags({maxspeed:raw}),true).value).toBeNull();
  });
  it('handles mph, unlimited, directional and conditional limits explicitly',()=>{
    expect(parseOsmSpeed(tags({maxspeed:'50 mph'}),true).value).toBeCloseTo(80.4672);
    expect(parseOsmSpeed(tags({maxspeed:'none'}),true)).toMatchObject({value:null,kind:'unlimited'});
    expect(parseOsmSpeed(tags({'maxspeed:forward':'80','maxspeed:backward':'40'}),false).value).toBe(40);
    expect(parseOsmSpeed(tags({'maxspeed:forward':'80'}),undefined).kind).toBe('unknown');
    expect(parseOsmSpeed(tags({maxspeed:'90','maxspeed:conditional':'50 @ wet'}),true).kind).toBe('conditional_unresolved');
  });
  it('retains interior ascent/descent and never flattens missing elevation',()=>{
    const input=trip();const route=normalizeRoadTrip(input,roadRequest(),config,new Map());
    expect(route.segments.reduce((n,s)=>n+(s.elevationGainMeters??0),0)).toBeCloseTo(20);
    expect(route.segments.reduce((n,s)=>n+(s.elevationLossMeters??0),0)).toBeCloseTo(20);
    input.legs[0].elevation=null;
    expect(normalizeRoadTrip(input,roadRequest(),config,new Map()).segments.every(s=>s.elevationGainMeters===null)).toBe(true);
  });
  it('splits duration and grade boundaries while preserving totals and continuous geometry',()=>{
    const request=roadRequest();request.segmentationPolicy.maxDurationSeconds=1000;
    const route=normalizeRoadTrip(trip(),request,config,new Map());
    expect(route.segments).toHaveLength(2);expect(route.distanceMeters).toBeCloseTo(1000);expect(route.drivingDurationSeconds).toBeCloseTo(120);
    expect(route.segments[0].endDistanceMeters).toBeCloseTo(500);
  });
  it('rejects invalid geometry, uncovered time, huge segmentation and malformed polylines',()=>{
    expect(()=>decodePolyline6('??')).toThrow();
    const input=trip();input.legs[0].maneuvers=[];expect(()=>normalizeRoadTrip(input,roadRequest(),config,new Map())).toThrow('duration');
    const request=roadRequest();request.segmentationPolicy.maxDurationSeconds=0.0001;
    expect(()=>normalizeRoadTrip(trip(),request,config,new Map())).toThrow('budget');
  });
  it('converts UTC departure to origin local time without using host timezone',()=>{
    expect(localDeparture('2026-11-11T13:00:00Z','Europe/Istanbul')).toBe('2026-11-11T16:00');
  });
  it('accepts a second independent adapter without changing the routing core',()=>{
    const adapter={id:'another-road-engine',capabilities:{alternatives:true,via:true,traffic:'none' as const,freeMapReuse:true},route:jest.fn(),attributes:jest.fn()};
    expect(new RoadAdapterRegistry([adapter]).get(adapter.id)).toBe(adapter);
    expect(()=>new RoadAdapterRegistry([{...adapter,capabilities:{...adapter.capabilities,freeMapReuse:false}}]).get(adapter.id)).toThrow('map reuse');
  });
  it('normalizes the real licensed Ankara response and exact edge walk without adding fake speed limits',async()=>{
    const raw=JSON.parse(readFileSync(resolve(__dirname,'fixtures/ankara-route.json'),'utf8'));
    const trace=JSON.parse(readFileSync(resolve(__dirname,'fixtures/ankara-trace.json'),'utf8'));
    const client:RoadJsonClient={post:jest.fn(async(_provider,url)=>({data:url.endsWith('trace_attributes')?trace:raw,retrievedAt:'2026-11-11T13:00:00Z'}))};
    const adapter=new ValhallaRoadAdapter(config),request=roadRequest();
    const routes=await adapter.route(request,[request.origin,request.destination],client,new AbortController().signal);
    const input=routes![0];input.legs[0].edges=await adapter.attributes(input.legs[0],client,new AbortController().signal);
    const route=normalizeRoadTrip(input,request,config,new Map());
    expect(route.distanceMeters).toBeCloseTo(3845);expect(route.drivingDurationSeconds).toBeCloseTo(512.5);
    expect(route.segments.every(s=>s.speedLimitKph===null)).toBe(true);
    expect(route.segments.some(s=>s.elevationProfile!==null)).toBe(true);
    trace.shape='invalid';
    await expect(adapter.attributes(input.legs[0],client,new AbortController().signal)).rejects.toThrow();
  });
});
