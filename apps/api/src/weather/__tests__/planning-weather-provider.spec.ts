import {WeatherAdapterRegistry,WeatherService} from '../weather.service';
import {buildPlanningWeather,samplingRange} from '../planning-weather-policy';
import {sampleRouteWeather} from '../weather-sampler';
import {windowRoute} from './window-route.fixture';
import {optimizerWorld} from '../../planning/__tests__/optimizer.fixtures';
import {source} from '../../planning/__tests__/fixtures';
import type {WeatherAdapter,WeatherDocument,ForecastSeries} from '../weather-ports';
import {energyFixture} from '../../energy/__tests__/fixtures';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {meters} from '../../roads/geometry';

describe('Sparse provider series preserve actual segment ETA and explicit coarse provenance',()=>{
 it('projects 1200 segment forecasts from fewer than 64 synthetic series without HTTP',async()=>{
  const now=Date.now(),input=windowRoute(1200),plan=buildPlanningWeather(input.route,samplingRange(optimizerWorld().vehicle,{rangeKm:400,cycle:'wltp',source:source('fixture')}));
  const sampling=sampleRouteWeather(input,plan),adapter:WeatherAdapter={id:'synthetic',version:'1',capabilities:{global:true,multiLocation:false,variables:[]},
   url:location=>'https://example.invalid/?lat='+location.latitude+'&lon='+location.longitude,
   parse:document=>({location:document.body as ForecastSeries['location'],elevation:800,sourceUpdatedAt:new Date(now).toISOString(),issuedAt:null,
    points:Array.from({length:74},(_,i)=>({time:new Date(now+i*3600000).toISOString(),temperature:15,windKph:5,windFrom:180,pressure:1000,
      periods:[{hours:1,totalMm:0,probability:0}]})),fetchedAt:new Date(now).toISOString(),validatedAt:new Date(now).toISOString(),warnings:[],
    sourceUrl:'https://example.invalid',license:'TEST-ONLY',attribution:'Synthetic test',pressureKind:'surface'})};
  const cache={get:jest.fn(async(_p:string,_v:string,url:string,_signal:AbortSignal,_budget:unknown,validate:(d:WeatherDocument)=>void)=>{
   const u=new URL(url),doc:WeatherDocument={status:200,body:{latitude:Number(u.searchParams.get('lat')),longitude:Number(u.searchParams.get('lon'))},
    expiresAt:new Date(now+3600000).toISOString(),lastModified:null,validatedAt:new Date(now).toISOString(),fetchedAt:new Date(now).toISOString(),warnings:[]};validate(doc);return doc;
  })};
  const service=new WeatherService({enabled:true,providerId:'synthetic',endpoint:'https://example.invalid',userAgent:'ChargeRoad/test synthetic',termsAccepted:true},new WeatherAdapterRegistry([adapter]),cache as never);
  const result=await service.forecast(sampling.queries,new AbortController().signal);
  expect(cache.get.mock.calls.length).toBeLessThan(64);expect(result.data).toHaveLength(1200);expect(result.data.every(f=>f.status==='available')).toBe(true);
  expect(result.data.some(f=>f.metadata!.sampleDistanceMeters>10000)).toBe(true);
  result.data.forEach((f,i)=>{expect(f.validAt).toBe(sampling.queries[i].validAt);expect(f.queryId).toBe(sampling.queries[i].id);expect(f.metadata?.samplingResolution).toEqual(sampling.queries[i].samplingResolution);});
  expect(result.data[1000].metadata?.warnings).toContain('coarse_future_weather_scenario');
 });
 it('admits distant weather only under the named coarse policy and keeps the unlabelled 10 km guard',async()=>{
  const f=energyFixture(),w=f.weather[0],location={latitude:w.location.latitude+.2,longitude:w.location.longitude},at=Date.parse(f.evaluatedAt);
  w.metadata={sampledLocation:location,sampledElevationMeters:0,sampleDistanceMeters:meters(w.location,location),coverageStart:new Date(at-3600000).toISOString(),coverageEnd:new Date(at+3600000).toISOString(),
   lastValidatedAt:f.evaluatedAt,intervalStart:new Date(at-3600000).toISOString(),intervalEnd:new Date(at+3600000).toISOString(),timeStepSeconds:7200,
   method:'linear_temperature_vector_wind',pressureKind:'surface',precipitationPeriod:null,warnings:[],license:'TEST-ONLY',attribution:'Synthetic'};
  const engine=new EnergyConsumptionEngine(),signal=new AbortController().signal,without=await engine.evaluate(f,signal);
  expect(without.reasons.map(r=>r.code)).toContain('WEATHER_SAMPLE_TOO_FAR');
  w.metadata.samplingResolution={policyVersion:'range-adaptive/1.0.0',phase:'future',intervalMeters:25000};
  const result=await engine.evaluate(f,signal);expect(result.status).toBe('estimated');expect(result.warnings).toContain('coarse_future_weather_scenario');
 });
});
