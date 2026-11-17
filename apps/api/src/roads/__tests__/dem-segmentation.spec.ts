import {roadSegmentSchema} from '@chargeroad/shared';
import {ROAD_SEGMENTATION} from '../road-policy';
import {normalizeRoadTrip} from '../normalize-road';
import {normaliseTestTrip} from './elevation-test-fixture';
import {config,roadRequest,trip} from './fixtures';

// DEM at 30 m with ~1 m vertical resolution: a 1 m step is already a 3.3 % grade change. Splitting on that noise
// multiplied segments ~9x on real routes while the energy engine integrates the in-segment profile anyway.
function noisyDemTrip(km:number){
  const input=trip(),leg=input.legs[0],request=roadRequest(),count=Math.ceil(km*1000/30)+1;
  leg.distanceMeters=km*1000;leg.seconds=km*36;leg.maneuvers=[{begin:0,end:1,seconds:km*36,instruction:'Synthetic road',type:1}];
  leg.geometry=[request.origin,{latitude:request.origin.latitude+km/111.195,longitude:request.origin.longitude}];
  leg.elevation={intervalMeters:30,values:Array.from({length:count},(_,i)=>800+i*0.2+(i%3===0?1:0))};
  return input;
}

describe('DEM-aware road segmentation (road-segments/1.1.0)',()=>{
  it('does not split on DEM grade noise by default',()=>{
    expect(ROAD_SEGMENTATION.version).toBe('1.1.0');
    const route=normalizeRoadTrip(noisyDemTrip(3),roadRequest(),config,new Map());
    expect(route.segments).toHaveLength(3);
    for(const s of route.segments){expect(s.elevationQuality).toBe('modelled');expect(s.elevationProfile!.length).toBeGreaterThan(30);
      expect(roadSegmentSchema.safeParse(s).success).toBe(true);}
    const gain=route.segments.reduce((n,s)=>n+s.elevationGainMeters!,0),loss=route.segments.reduce((n,s)=>n+s.elevationLossMeters!,0);
    expect(gain-loss).toBeCloseTo(route.segments.at(-1)!.elevationProfile!.at(-1)!.elevationMeters-route.segments[0].elevationProfile![0].elevationMeters,6);
  });
  it('still splits on grade when a policy asks for it explicitly',()=>{
    const request=roadRequest();request.segmentationPolicy.splitAtGradeChangePercent=3;
    expect(normalizeRoadTrip(noisyDemTrip(3),request,config,new Map()).segments.length).toBeGreaterThan(30);
  });
  it.each([[2,'one fewer'],[4,'one more']])('keeps Valhalla elevation when the sample count is off by one (%i values, %s)',async count=>{
    const {route}=await normaliseTestTrip(Array.from({length:count},(_,i)=>100+i));
    expect(route.segments.every(s=>s.elevationProfile!==null&&s.elevationQuality==='modelled')).toBe(true);
    expect(route.metadata?.warnings).not.toContain('elevation_missing');
    expect(route.metadata?.warnings).toContain('elevation_sampling_count_mismatch');
  });
  it.each([1,5])('drops Valhalla elevation when the sample count is off by more than one (%i values)',async count=>{
    const {route}=await normaliseTestTrip(Array.from({length:count},(_,i)=>100+i));
    expect(route.segments.every(s=>s.elevationProfile===null)).toBe(true);expect(route.metadata?.warnings).toContain('elevation_missing');
  });
});
