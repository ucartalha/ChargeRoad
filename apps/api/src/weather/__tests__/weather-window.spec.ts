import type {RouteWeatherRequest} from '@chargeroad/shared';
import {normalizeRoadTrip} from '../../roads/normalize-road';
import {trip,roadRequest,config} from '../../roads/__tests__/fixtures';
import {sampleRouteWeather,samplePreviewWeather,sampleNavigationWeather} from '../weather-sampler';
import {weatherSampleLocation} from '../weather-spatial';
import {WEATHER_SAMPLING_POLICY as policy} from '../weather-policy';

export function windowRoute(km:number):RouteWeatherRequest{
  const route=normalizeRoadTrip(trip(),roadRequest(),config,new Map()),base=route.segments[0];
  const count=km,segmentMeters=1000;
  route.id='window-'+km;route.distanceMeters=km*1000;route.drivingDurationSeconds=km*36;
  route.segments=Array.from({length:count},(_,i)=>({...structuredClone(base),id:'segment-'+i,startDistanceMeters:i*segmentMeters,endDistanceMeters:(i+1)*segmentMeters,
    distanceMeters:segmentMeters,drivingDurationSeconds:36,expectedSpeedKph:100,speedLimitKph:null,speedLimitKind:'unknown',
    geometry:[{latitude:39.9+i/111.195,longitude:32.8},{latitude:39.9+(i+1)/111.195,longitude:32.8}],
    elevationProfile:[{distanceFromStartMeters:0,elevationMeters:800},{distanceFromStartMeters:1000,elevationMeters:800}],
    elevationGainMeters:0,elevationLossMeters:0,startsAtChargingAccess:false,endsAtChargingAccess:false}));
  return {route,departureAt:new Date(Date.now()+300000).toISOString(),stops:[]};
}

describe('Preview and rolling navigation weather sampling',()=>{
  it.each([40,140,150,151,450,800])('%i km preview uses exactly five real route midpoints with passage times',km=>{
    const input=windowRoute(km),result=samplePreviewWeather(input);
    expect(result.queries).toHaveLength(5);expect(result.coverage.detailedEnergyReady).toBe(false);
    result.queries.forEach((q,i)=>{
      expect(q.location.latitude).toBeCloseTo(39.9+km*(i+.5)/5/111.195,6);
      expect(Date.parse(q.validAt)-Date.parse(input.departureAt)).toBeCloseTo(km*(i+.5)/5*36000,0);
    });
    expect(new Set(result.queries.map(q=>JSON.stringify(weatherSampleLocation(q)))).size).toBeLessThanOrEqual(5);
  });
  it.each([40,140,150])('%i km navigation starts with at most 50 km and 10 km sample spacing',km=>{
    const input=windowRoute(km),result=sampleNavigationWeather(input,{progressMeters:0});
    expect(result.queries).toHaveLength(Math.min(50,km));expect(result.samples).toHaveLength(Math.min(50,km)/10+1);
    expect(result.state.windowEndMeters).toBe(Math.min(50000,km*1000));
  });
  it.each([151,450,800])('%i km uses bounded adaptive long-route sampling',km=>{
    const input=windowRoute(km),result=sampleNavigationWeather(input,{progressMeters:0});
    expect(result.queries).toHaveLength(50);expect(result.samples).toHaveLength(4);
    expect(result.coverage.wholeRouteReady).toBe(false);
    if(km===800)expect(()=>sampleRouteWeather(input)).toThrow('sample budget');
    else expect(sampleRouteWeather(input).samples.length).toBeGreaterThan(result.samples.length);
  });
  it('does no new work on each GPS tick, then extends at 20 km or a material ETA change',()=>{
    const input=windowRoute(450),first=sampleNavigationWeather(input,{progressMeters:0});
    const tick=sampleNavigationWeather(input,{progressMeters:19999,previous:first.state});expect(tick.refresh).toBe(false);expect(tick.queries).toEqual([]);
    const next=sampleNavigationWeather(input,{progressMeters:20000,previous:first.state});expect(next.refresh).toBe(true);expect(next.state.windowEndMeters).toBe(70000);
    const small={...input,departureAt:new Date(Date.parse(input.departureAt)+899000).toISOString()};
    expect(sampleNavigationWeather(small,{progressMeters:1000,previous:first.state,event:'eta_changed'}).refresh).toBe(false);
    const changed={...input,departureAt:new Date(Date.parse(input.departureAt)+900000).toISOString()};
    expect(sampleNavigationWeather(changed,{progressMeters:1000,previous:first.state,event:'eta_changed'}).refresh).toBe(true);
  });
  it('densifies mountain, weather-risk, critical SOC and charging sections without fetching the whole route',()=>{
    const input=windowRoute(450),normal=sampleNavigationWeather(input,{progressMeters:0});
    input.route.segments[5].elevationProfile![1].elevationMeters=1100;
    input.route.segments[25].startsAtChargingAccess=true;
    const dense=sampleNavigationWeather(input,{progressMeters:0,criticalSegmentIds:['segment-30'],riskSegmentIds:['segment-35']});
    expect(dense.samples.length).toBeGreaterThan(normal.samples.length);expect(dense.queries).toHaveLength(50);
    expect(sampleNavigationWeather(input,{progressMeters:1,previous:dense.state,criticalSegmentIds:['segment-30'],riskSegmentIds:['segment-35']}).refresh).toBe(false);
  });
  it('invalidates the window on deviation, charging changes, cache expiry and backwards progress',()=>{
    const input=windowRoute(140),first=sampleNavigationWeather(input,{progressMeters:20000});
    const changed={...input,route:{...input.route,id:'rerouted'}};
    expect(sampleNavigationWeather(changed,{progressMeters:20001,previous:first.state}).refresh).toBe(true);
    expect(sampleNavigationWeather(input,{progressMeters:19000,previous:first.state}).refresh).toBe(true);
    expect(sampleNavigationWeather(input,{progressMeters:20001,previous:first.state,event:'cache_expired'}).refresh).toBe(true);
    const charge={...input,stops:[{segmentId:'segment-30',delaySeconds:1800}]};
    const delayed=sampleNavigationWeather(charge,{progressMeters:20001,previous:first.state,event:'charge_changed'});
    expect(delayed.refresh).toBe(true);
    const baseline=first.queries.find(q=>q.segmentId==='segment-35')!,after=delayed.queries.find(q=>q.segmentId==='segment-35')!;
    expect(Date.parse(after.validAt)-Date.parse(baseline.validAt)).toBe(1800000);
  });
  it('densifies gradual climbs across coarse intervals and bounds unknown-terrain sampling',()=>{
    const input=windowRoute(450);
    input.route.segments.forEach((s,i)=>{s.elevationProfile!.forEach((p,j)=>{p.elevationMeters=800+(i+j)*40;});s.elevationGainMeters=40;});
    const climbing=sampleNavigationWeather(input,{progressMeters:0});expect(climbing.samples).toHaveLength(11);
    input.route.segments.forEach(s=>{s.elevationProfile=null;s.elevationGainMeters=null;s.elevationLossMeters=null;});
    const unknown=sampleNavigationWeather(input,{progressMeters:0});expect(unknown.samples).toHaveLength(11);
    expect(unknown.queries.every(q=>q.sampleElevationMeters===undefined)).toBe(true);
  });
  it('reports unknown downstream timing rather than assigning departure weather after an unknown queue',()=>{
    const input=windowRoute(40);input.stops=[{segmentId:'segment-20',delaySeconds:null}];
    const result=sampleNavigationWeather(input,{progressMeters:0});expect(result.queries).toHaveLength(20);
    expect(result.unknownTimingSegmentIds).toHaveLength(20);
    expect(samplePreviewWeather(input).queries.length).toBeLessThan(5);
  });
  it('rejects invalid progress, unknown risk IDs, duplicate stops and malformed prior windows',()=>{
    const input=windowRoute(40);
    expect(()=>sampleNavigationWeather(input,{progressMeters:-1})).toThrow('progress');
    expect(()=>sampleNavigationWeather(input,{progressMeters:40001})).toThrow('progress');
    expect(()=>sampleNavigationWeather(input,{progressMeters:0,riskSegmentIds:['missing']})).toThrow('risk');
    expect(()=>samplePreviewWeather({...input,stops:[{segmentId:'missing',delaySeconds:10}]})).toThrow('stop');
    const first=sampleNavigationWeather(input,{progressMeters:0});
    expect(sampleNavigationWeather(input,{progressMeters:0,previous:{...first.state,windowEndMeters:Infinity}}).refresh).toBe(true);
  });
  it('uses conservative deterministic cells only for known low-relief terrain, including negative coordinates',()=>{
    const input=samplePreviewWeather(windowRoute(40)).queries[0],a={...input,location:{latitude:39.901,longitude:32.801},sampleLocation:{latitude:39.901,longitude:32.801}};
    const b={...a,location:{latitude:39.902,longitude:32.802},sampleLocation:{latitude:39.902,longitude:32.802}};
    expect(weatherSampleLocation(a)).toEqual(weatherSampleLocation(b));
    expect(weatherSampleLocation({...a,sampleReliefMeters:policy.terrainReliefMeters})).toEqual(a.sampleLocation);
    expect(weatherSampleLocation({...a,sampleElevationMeters:undefined})).toEqual(a.sampleLocation);
    const negative={...a,location:{latitude:-12.121,longitude:-30.121},sampleLocation:{latitude:-12.121,longitude:-30.121}};
    expect(weatherSampleLocation(negative)).toEqual({latitude:-12.1225,longitude:-30.1225});
  });
});
