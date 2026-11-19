import {planningApiRequestSchema} from '@chargeroad/shared';
import {ValhallaRoadAdapter} from '../../roads/valhalla-adapter';
import {config,roadRequest} from '../../roads/__tests__/fixtures';
import type {RoadJsonClient} from '../../roads/provider-ports';
import {planningPreparation} from '../http/planning-http-policy';
import {optimizerWorld} from './optimizer.fixtures';

// Origin heading (2026-11-19, user-approved API addition): a replan during navigation sends the car's travel direction so
// Valhalla starts the route on the carriageway the car is on, instead of suggesting a U-turn from the opposite side.
// Only requests that start at the trip origin carry it; requests without it are byte-identical to before.
async function body(extra:Record<string,unknown>){
  let sent:any;const client:RoadJsonClient={post:async(_id,_url,b)=>{sent=b;return {data:{error_code:442},retrievedAt:'2026-11-11T13:00:00Z'};}};
  const request={...roadRequest(),...extra};await new ValhallaRoadAdapter(config).route(request as never,[request.origin,request.destination],client,new AbortController().signal);
  return sent;
}
const apiRequest=(extra:Record<string,unknown>={})=>({schemaVersion:'1.0.0',requestId:'11111111-1111-4111-8111-111111111111',origin:{latitude:40,longitude:29},
  destination:{latitude:41,longitude:30},vehicleVariantId:'11111111-1111-4111-8111-111111111111',departureAt:'2026-11-19T10:00:00Z',startingChargePercent:60,
  startingChargeObservedAt:'2026-11-19T09:59:00Z',constraints:{minimumReserveChargePercent:10,targetArrivalChargePercent:20},...extra});

describe('Origin heading',()=>{
  it('puts heading and tolerance on the first Valhalla location only, rounded to whole degrees',async()=>{
    const b=await body({originHeadingDegrees:87.6,originHeadingToleranceDegrees:45});
    expect(b.locations[0]).toMatchObject({heading:88,heading_tolerance:45});expect(b.locations[1].heading).toBeUndefined();
    expect((await body({originHeadingDegrees:359.7,originHeadingToleranceDegrees:45})).locations[0].heading).toBe(0);
  });
  it('leaves a request without heading byte-identical',async()=>{
    expect(JSON.stringify(await body({}))).toBe(JSON.stringify(await body({originHeadingDegrees:undefined})));
    expect(JSON.stringify(await body({}))).not.toContain('heading');
  });
  it('API contract: optional, bounded, strict; tolerance defaults to 45',()=>{
    expect(planningApiRequestSchema.parse(apiRequest()).originHeading).toBeUndefined();
    expect(planningApiRequestSchema.parse(apiRequest({originHeading:{degrees:87.6}})).originHeading).toEqual({degrees:87.6,toleranceDegrees:45});
    for(const originHeading of [{degrees:360},{degrees:-1},{degrees:NaN},{degrees:10,toleranceDegrees:5},{degrees:10,toleranceDegrees:120},{degrees:10,extra:1}])
      expect(planningApiRequestSchema.safeParse(apiRequest({originHeading})).success).toBe(false);
  });
  it('preparation carries the heading; the road options shared by every leg do not',()=>{
    const p=planningPreparation(planningApiRequestSchema.parse(apiRequest({originHeading:{degrees:200,toleranceDegrees:30}})));
    expect(p.originHeading).toEqual({degrees:200,toleranceDegrees:30});expect(JSON.stringify(p.road)).not.toContain('eading');
    expect(planningPreparation(planningApiRequestSchema.parse(apiRequest())).originHeading).toBeUndefined();
  });
  it('planning sends the heading only on road requests that start at the trip origin',async()=>{
    const w=optimizerWorld();const r=await w.service.plan(w.request,{...w.preparation,originHeading:{degrees:12,toleranceDegrees:45}},w.options);
    expect(r.result.status).toBe('planned');
    const calls=(w.roads.routes as jest.Mock).mock.calls.map(c=>c[0]),same=(a:any,b:any)=>a.latitude===b.latitude&&a.longitude===b.longitude;
    const fromOrigin=calls.filter(c=>same(c.origin,w.request.origin)),others=calls.filter(c=>!same(c.origin,w.request.origin));
    expect(fromOrigin.length).toBeGreaterThan(0);expect(others.length).toBeGreaterThan(0);
    for(const c of fromOrigin)expect(c).toMatchObject({originHeadingDegrees:12,originHeadingToleranceDegrees:45});
    for(const c of others)expect(c.originHeadingDegrees).toBeUndefined();
    const plain=optimizerWorld();await plain.service.plan(plain.request,plain.preparation,plain.options);
    for(const c of (plain.roads.routes as jest.Mock).mock.calls)expect(c[0].originHeadingDegrees).toBeUndefined();
  });
});
