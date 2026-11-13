import {roadSegmentSchema} from '@chargeroad/shared';
import {normaliseTestTrip} from './elevation-test-fixture';
import {config,roadRequest,trip} from './fixtures';
import {normalizeRoadTrip} from '../normalize-road';
import {analyseElevation,routeElevationSamples} from '../elevation-qa';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {energyFixture} from '../../energy/__tests__/fixtures';
describe('Valhalla DEM no-data and elevation quality',()=>{
 it.each([-500,-32768])('maps only Valhalla sentinel %s to missing, never flat terrain',async sentinel=>{
  const {route,client}=await normaliseTestTrip([sentinel,sentinel,sentinel]);
  expect(client.post.mock.calls[0][2]).toMatchObject({elevation_interval:30});
  expect(route.segments.every(s=>s.elevationProfile===null&&s.elevationQuality==='unknown'&&s.elevationGainMeters===null&&s.elevationLossMeters===null)).toBe(true);
  expect(route.metadata?.warnings).toContain('valhalla_elevation_no_data');expect(route.metadata?.warnings).not.toContain('elevation_dataset_not_independently_verified');
 });
 it('preserves valid negative heights, even below -499, as modelled data',async()=>{
  const {route}=await normaliseTestTrip([-501,-499,-430]);expect(route.segments.every(s=>s.elevationQuality==='modelled')).toBe(true);
  expect(route.segments[0].elevationProfile![0].elevationMeters).toBe(-501);expect(route.source.version).toContain('graph=unknown');
 });
 it('does not impose Valhalla sentinels on a different provider',()=>{
  const input=trip();input.legs[0].elevation={intervalMeters:500,values:[-500,-510,-500]};
  expect(normalizeRoadTrip(input,roadRequest(),config,new Map()).segments.every(s=>s.elevationQuality==='modelled')).toBe(true);
 });
 it('keeps known intervals next to a gap and never interpolates through a missing sample',async()=>{
  const {route}=await normaliseTestTrip([10,20,null]);expect(route.segments.some(s=>s.elevationQuality==='modelled')).toBe(true);
  expect(route.segments.some(s=>s.elevationQuality==='unknown')).toBe(true);expect(route.metadata?.warnings).toContain('elevation_missing');
 });
 it('keeps legacy optional-quality contracts while rejecting inconsistent explicit quality/gain',()=>{
  const segment=normalizeRoadTrip(trip(),roadRequest(),config,new Map()).segments[0],{elevationQuality,...legacy}=segment;
  expect(roadSegmentSchema.safeParse(legacy).success).toBe(true);
  expect(roadSegmentSchema.safeParse({...segment,elevationQuality:'unknown'}).success).toBe(true);
  expect(roadSegmentSchema.safeParse({...segment,elevationProfile:null}).success).toBe(false);
  expect(roadSegmentSchema.safeParse({...segment,elevationProfile:null,elevationQuality:'unknown',elevationGainMeters:null,elevationLossMeters:null}).success).toBe(true);
 });
 it('enforces verified-only terrain and explicit engineering assumptions in the real energy engine',async()=>{
  const input=energyFixture();input.route.segments[0].elevationQuality='modelled';
  const engine=new EnergyConsumptionEngine(),estimated=await engine.evaluate(input,new AbortController().signal);
  expect(estimated.status).toBe('estimated');expect(estimated.assumptions).toContain('modelled_elevation_not_independently_verified');expect(estimated.warnings).toContain('modelled_elevation_not_independently_verified');
  input.request.policy.vehicleDataQuality='verified_only';input.vehicle.energyModel!.quality='verified';input.vehicle.dataQuality!.quality='verified';
  expect((await engine.evaluate(input,new AbortController().signal)).reasons.map(r=>r.code)).toContain('ELEVATION_NOT_VERIFIED');
  input.route.segments[0]={...input.route.segments[0],elevationProfile:null,elevationQuality:'unknown',elevationGainMeters:null,elevationLossMeters:null};
  expect((await engine.evaluate(input,new AbortController().signal)).reasons.map(r=>r.code)).toContain('ELEVATION_MISSING');
 });
});
describe('Distance-domain diagnostic QA, no smoothing or physical grade cap',()=>{
 const sample=(distanceMeters:number,elevationMeters:number|null)=>({distanceMeters,elevationMeters});
 it('computes exact 30/150/300 m slopes and omits incomplete trailing windows',()=>{
  const points=Array.from({length:12},(_,i)=>sample(i*30,100+i*3)),copy=JSON.stringify(points),qa=analyseElevation(points);
  expect(qa.rolling.map(w=>w.maxAbsoluteGradePercent)).toEqual([10,10,10]);expect(qa.rolling[2].completeWindows).toBe(2);expect(qa.partialWindows).toBe(false);
  expect(JSON.stringify(points)).toBe(copy);expect(qa.balanceErrorMeters).toBeCloseTo(0);
 });
 it('interpolates nonuniform endpoints without rounding distance or clamping a short real slope',()=>{
  const qa=analyseElevation([sample(0,0),sample(30,30),sample(170,10),sample(340,0)]);
  expect(qa.suspectIntervals[0].gradePercent).toBe(100);expect(qa.rolling[2].completeWindows).toBe(2);expect(qa.gainMeters).toBe(30);expect(qa.lossMeters).toBe(30);
 });
 it('does not bridge missing interior samples even if window endpoints are known',()=>{
  const qa=analyseElevation([sample(0,0),sample(150,null),sample(300,0)]);expect(qa.fullCoverage).toBe(false);
  expect(qa.rolling[2]).toMatchObject({completeWindows:0,missingWindows:1,maxAbsoluteGradePercent:null});expect(qa.netHeightMeters).toBeNull();
 });
 it('deduplicates equal segment boundaries and treats contradictory ones as unknown',()=>{
  const points=[sample(0,909),sample(100,1001.3),sample(100,1001.3),sample(300,891.4)],qa=analyseElevation(points);
  expect(qa.duplicateBoundaries).toBe(1);expect(qa.gainMeters).toBeCloseTo(92.3);expect(qa.lossMeters).toBeCloseTo(109.9);expect(qa.netHeightMeters).toBeCloseTo(-17.6);expect(qa.balanceErrorMeters).toBeCloseTo(0);
  const conflict=analyseElevation([...points.slice(0,3),sample(100,1002),sample(300,891.4)]);expect(conflict.conflictingBoundaries).toBe(1);expect(conflict.fullCoverage).toBe(false);
 });
 it('preserves road, maneuver and energy ledgers while producing separate QA',()=>{
  const route=normalizeRoadTrip(trip(),roadRequest(),config,new Map()),before=JSON.stringify(route),qa=analyseElevation(routeElevationSamples(route));
  expect(JSON.stringify(route)).toBe(before);expect(qa.balanceErrorMeters).toBeCloseTo(0);expect(route.distanceMeters).toBe(1000);expect(route.drivingDurationSeconds).toBeCloseTo(120);
 });
 it('rejects unordered, nonfinite and over-budget QA instead of hiding corruption',()=>{
  expect(()=>analyseElevation([sample(30,0),sample(0,0)])).toThrow();expect(()=>analyseElevation([sample(0,NaN)])).toThrow();expect(()=>analyseElevation([],[-1])).toThrow();
 });
});
