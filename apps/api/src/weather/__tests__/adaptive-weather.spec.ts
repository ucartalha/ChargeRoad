import {sampleAdaptiveWeather,adaptiveWeatherNeedsRefinement} from '../adaptive-weather-sampler';
import {buildPlanningWeather,samplingRange} from '../planning-weather-policy';
import {windowRoute} from './window-route.fixture';
import {optimizerWorld} from '../../planning/__tests__/optimizer.fixtures';
import {weatherSamplingResolutionSchema,weatherSampleDistanceLimit} from '@chargeroad/shared';
import {source,forecast} from '../../planning/__tests__/fixtures';
describe('Experimental risk-gated v2, v1 unchanged',()=>{
 it('uses 35km only on homogeneous near-term roads and keeps future at 25km',()=>{
  const input=windowRoute(600);input.route.segments.forEach(s=>{s.roadClass='motorway';s.elevationQuality='modelled';});
  const p=buildPlanningWeather(input.route,samplingRange(optimizerWorld().vehicle,{rangeKm:400,cycle:'test',source:source('synthetic')}));
  const result=sampleAdaptiveWeather(input,p,0,90,10);
  expect(result.queries.some(q=>q.samplingResolution?.intervalMeters===35000)).toBe(true);
  expect(result.queries.filter(q=>q.samplingResolution?.phase==='future').every(q=>q.samplingResolution!.intervalMeters<=25000)).toBe(true);
  expect(result.queries).toHaveLength(600);expect(result.queries.every(q=>weatherSampleDistanceLimit(q.samplingResolution)<=17500)).toBe(true);
 });
 it('tightens unknown DEM, charging access, reserve and refinement without changing per-segment ETA',()=>{
  const input=windowRoute(120);input.route.segments.forEach(s=>{s.elevationProfile=null;s.elevationQuality='unknown';});
  const a=sampleAdaptiveWeather(input,undefined,0,80,10),b=sampleAdaptiveWeather(input,undefined,0,20,10),c=sampleAdaptiveWeather(input,undefined,0,80,10,true);
  expect(a.queries.every(q=>q.samplingResolution!.intervalMeters<=15000)).toBe(true);
  expect(b.queries.every(q=>q.samplingResolution!.intervalMeters===5000)).toBe(true);expect(c.queries.map(q=>q.validAt)).toEqual(a.queries.map(q=>q.validAt));
  expect(a.queries.every(q=>q.sampleLocation===q.location)).toBe(true);
 });
 it('rejects unlimited offsets and preserves v1 near=15km',()=>{
  expect(weatherSamplingResolutionSchema.safeParse({policyVersion:'range-adaptive/1.0.0',phase:'near_term',intervalMeters:35000}).success).toBe(false);
  expect(weatherSamplingResolutionSchema.safeParse({policyVersion:'range-adaptive/2.0.0',phase:'near_term',intervalMeters:35000,maxSampleDistanceMeters:35000,risk:'homogeneous'}).success).toBe(false);
 });
 it('refines wind vectors instead of subtracting directions across north',()=>{
  const input=windowRoute(2),queries=sampleAdaptiveWeather(input,undefined,0,80,10).queries;
  const f=queries.map(q=>({...forecast(q),status:'available' as const,temperatureCelsius:20,windSpeedKph:30,windFromDegrees:359}));
  f[1].windFromDegrees=1;expect(adaptiveWeatherNeedsRefinement(f)).toBe(false);f[1].windFromDegrees=180;expect(adaptiveWeatherNeedsRefinement(f)).toBe(true);
 });
 it('does not share a geodesically close point across a distant return leg',()=>{
  const input=windowRoute(120);input.route.segments.forEach((s,i)=>{
   const a=i<=60?i:120-i,b=i+1<=60?i+1:119-i;
   s.geometry=[{latitude:39.9+a/111.195,longitude:32.8},{latitude:39.9+b/111.195,longitude:32.8}];
   s.bearingDegrees=i<60?0:180;s.roadClass='motorway';s.elevationQuality='modelled';
  });
  const result=sampleAdaptiveWeather(input,undefined,0,90,10);
  expect(result.queries[4].sampleLocation).toEqual(result.queries[4].location);
 });
});
