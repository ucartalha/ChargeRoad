import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {MetNorwayAdapter} from '../met-norway.adapter';
import {normalizeWeather,usableWeather} from '../weather-normalize';
import {WeatherAdapterRegistry,WeatherService} from '../weather.service';
import {sampleRouteWeather} from '../weather-sampler';
import {weatherTransport} from '../weather-http';
import {weatherConfig} from '../weather-policy';
import {WEATHER_POLICY,weatherProviderLimits} from '../weather-policy';
import {config,document,query,instant} from './fixtures';
import {trip,roadRequest,config as roadConfig} from '../../roads/__tests__/fixtures';
import {normalizeRoadTrip} from '../../roads/normalize-road';
import type {WeatherDocument} from '../weather-ports';
const now=Date.parse(instant);

describe('Weather budgets across route legs',()=>{
  it('deduplicates 5003 segment forecasts and shares the external-call budget across leg signals',async()=>{
    const clock=jest.spyOn(Date,'now').mockReturnValue(now);
    try{
      const cache={get:jest.fn(async()=>document())},service=new WeatherService(config,new WeatherAdapterRegistry([new MetNorwayAdapter(config)]),cache as any,{seriesCacheEntries:0});
      const scope={budgetScope:{}},queries=Array.from({length:5003},(_,i)=>query('dense-'+i));
      const result=await service.forecast(queries,new AbortController().signal,scope);
      expect(result.data).toHaveLength(5003);expect(result.data.every(f=>f.status==='available')).toBe(true);
      expect(cache.get).toHaveBeenCalledTimes(1);
      await service.forecast([query('next-leg')],new AbortController().signal,scope);
      const calls=cache.get.mock.calls as unknown as unknown[][];
      expect(calls[0][4]).toBe(calls[1][4]);expect(calls[0][4]).toMatchObject({limit:WEATHER_POLICY.maxExternalCalls});
      await service.forecast([query('other-trip')],new AbortController().signal,{budgetScope:{}});
      expect(calls[0][4]).not.toBe((cache.get.mock.calls as unknown as unknown[][])[2][4]);
    }finally{clock.mockRestore();}
  });
});

// 2026-11-19: on a cold cache (new ICON run) İstanbul→Kelkit needs more than 128 sample locations; the MET-derived
// per-plan call budget then answered 768 forecasts budget_exhausted and the plan failed with computation_limit.
// The self-hosted provider has no external quota, so its per-plan budget comes from its own limits; MET keeps 128.
describe('Per-provider external call budget',()=>{
  it('gives self-hosted Open-Meteo its own per-plan budget and leaves MET at the ToS-derived 128',async()=>{
    const clock=jest.spyOn(Date,'now').mockReturnValue(now);
    try{
      const budgetOf=async(providerId:string)=>{const c={...config,providerId},cache={get:jest.fn(async()=>document())};
        await new WeatherService(c,new WeatherAdapterRegistry([new MetNorwayAdapter(c)]),cache as any,{seriesCacheEntries:0}).forecast([query('a')],new AbortController().signal,{budgetScope:{}});
        return ((cache.get.mock.calls as unknown as unknown[][])[0][4] as {limit:number}).limit;};
      expect(await budgetOf('met-norway')).toBe(128);
      expect(await budgetOf('open-meteo-local')).toBe(weatherProviderLimits('open-meteo-local').maxExternalCalls);
      expect(weatherProviderLimits('open-meteo-local').maxExternalCalls).toBeGreaterThanOrEqual(1024);
    }finally{clock.mockRestore();}
  });
});

describe('Process series cache (L1)',()=>{
  it('reads PG once while the document is unexpired, returns identical forecasts, and re-reads after expiry',async()=>{
    let clockNow=now;const clock=jest.spyOn(Date,'now').mockImplementation(()=>clockNow);
    try{
      const cache={get:jest.fn(async()=>document())},service=new WeatherService(config,new WeatherAdapterRegistry([new MetNorwayAdapter(config)]),cache as any);
      const uncached=new WeatherService(config,new WeatherAdapterRegistry([new MetNorwayAdapter(config)]),{get:jest.fn(async()=>document())} as any,{seriesCacheEntries:0});
      const first=await service.forecast([query('a')],new AbortController().signal),second=await service.forecast([query('b')],new AbortController().signal);
      expect(cache.get).toHaveBeenCalledTimes(1);
      const reference=await uncached.forecast([query('b')],new AbortController().signal);
      expect(second.data).toEqual(reference.data.map(f=>({...f,fetchedAt:second.data[0].fetchedAt,source:{...f.source,retrievedAt:second.data[0].source.retrievedAt}})));
      expect(first.data[0].temperatureCelsius).toBe(second.data[0].temperatureCelsius);
      clockNow=now+3600001;await service.forecast([query('c','2026-11-11T15:00:00Z')],new AbortController().signal);expect(cache.get).toHaveBeenCalledTimes(2);
    }finally{clock.mockRestore();}
  });
});

describe('Weather provenance, normalization and route sampling',()=>{
  it('interpolates 359° and 1° wind as vectors, preserving actual update and unknown model issue time',()=>{
    const series=new MetNorwayAdapter(config).parse(document()),forecast=normalizeWeather(series,query(),config.providerId,now);
    expect(forecast.temperatureCelsius).toBe(21);expect(Math.min(forecast.windFromDegrees!,360-forecast.windFromDegrees!)).toBeCloseTo(0);
    expect(forecast.windSpeedKph).toBeCloseTo(18*Math.cos(Math.PI/180));
    expect(forecast.forecastIssuedAt).toBeNull();expect(forecast.sourceUpdatedAt).toBe(instant);
    expect(forecast.metadata?.pressureKind).toBe('sea_level');expect(forecast.snowDepthCm).toBeNull();
    expect(forecast.precipitationMmPerHour).toBe(2);expect(forecast.metadata?.precipitationPeriod?.totalMm).toBe(2);
  });
  it('retains six-hour precipitation totals as period averages without pretending hourly precision',()=>{
    const forecast=normalizeWeather(new MetNorwayAdapter(config).parse(document()),query('q','2026-11-11T15:00:00Z'),config.providerId,now);
    expect(forecast.precipitationMmPerHour).toBe(2);expect(forecast.metadata?.precipitationPeriod?.totalMm).toBe(12);
    expect(forecast.metadata?.timeStepSeconds).toBe(21600);expect(forecast.metadata?.warnings).toContain('precipitation_is_period_average');
  });
  it('handles calm wind without direction and explicitly rejects missing core values',()=>{
    const series=new MetNorwayAdapter(config).parse(document());
    for(const point of series.points){point.windKph=0;point.windFrom=null;}
    expect(usableWeather(normalizeWeather(series,query(),config.providerId,now),now)).toBe(true);
    series.points[0].temperature=null;
    const missing=normalizeWeather(series,query(),config.providerId,now);expect(missing.status).toBe('partial');expect(usableWeather(missing,now)).toBe(false);
  });
  it('distinguishes forecast horizon and stale/future source times without using download time',()=>{
    const series=new MetNorwayAdapter(config).parse(document());
    expect(normalizeWeather(series,query('q','2026-11-12T00:00:00Z'),config.providerId,now).status).toBe('outside_horizon');
    expect(normalizeWeather(series,query(),config.providerId,now+43201000).status).toBe('stale');
    expect(normalizeWeather(series,query(),config.providerId,now-1000).status).toBe('stale');
    series.points[1].time='2026-11-11T20:00:00Z';series.points[2].time='2026-11-11T21:00:00Z';
    expect(normalizeWeather(series,query(),config.providerId,now).status).toBe('outside_horizon');
  });
  it('rejects bad units, malformed data, duplicate times and truncated coordinate precision',()=>{
    const adapter=new MetNorwayAdapter(config),raw=document();
    (raw.body as any).properties.meta.units.wind_speed='km/h';expect(()=>adapter.parse(raw)).toThrow('units');
    const other=document();(other.body as any).properties.timeseries[1].time=instant;expect(()=>adapter.parse(other)).toThrow('increasing');
    const url=new URL(adapter.url({latitude:-12.123456,longitude:32.123456}));expect(url.searchParams.get('lat')).toBe('-12.1234');
  });
  it('reuses selected locations while moving valid times after known charging delays',()=>{
    const route=normalizeRoadTrip(trip(),roadRequest(),roadConfig,new Map());
    const normal=sampleRouteWeather({route,departureAt:instant,stops:[]});
    const delayed=sampleRouteWeather({route,departureAt:instant,stops:[{segmentId:route.segments[1].id,delaySeconds:1800}]});
    expect(Date.parse(delayed.queries[0].validAt)).toBe(Date.parse(normal.queries[0].validAt));
    expect(Date.parse(delayed.queries[1].validAt)-Date.parse(normal.queries[1].validAt)).toBe(1800000);
    const unknown=sampleRouteWeather({route,departureAt:instant,stops:[{segmentId:route.segments[1].id,delaySeconds:null}]});
    expect(unknown.queries).toHaveLength(1);expect(unknown.unknownTimingSegmentIds).toEqual([route.segments[1].id]);
    expect(()=>sampleRouteWeather({route,departureAt:instant,stops:[{segmentId:'missing',delaySeconds:1}]})).toThrow('stop');
  });
  it('changes adapters without changing the gateway core and produces a preliminary route outside 72 hours',async()=>{
    const adapter={id:'second-engine',version:'1',capabilities:{global:true,multiLocation:false,variables:['temperature']},url:jest.fn(),parse:jest.fn()};
    expect(new WeatherAdapterRegistry([adapter]).get(adapter.id)).toBe(adapter);
    const cache={get:jest.fn()},service=new WeatherService(config,new WeatherAdapterRegistry([new MetNorwayAdapter(config)]),cache as any);
    const route=normalizeRoadTrip(trip(),roadRequest(),roadConfig,new Map());
    expect((await service.forRoute({route,departureAt:new Date(Date.now()+259201000).toISOString(),stops:[]},new AbortController().signal)).status).toBe('preliminary_route');
    expect((await service.forRoute({route,departureAt:new Date(Date.now()-1000).toISOString(),stops:[]},new AbortController().signal)).status).toBe('preliminary_route');
    expect(cache.get).not.toHaveBeenCalled();
  });
  it('reports a sample budget instead of silently thinning a large route',()=>{
    const large=trip();large.legs[0].distanceMeters=2400000;large.legs[0].seconds=86400;
    large.legs[0].maneuvers[0].seconds=86400;large.legs[0].elevation=null;
    const route=normalizeRoadTrip(large,roadRequest(),roadConfig,new Map());
    expect(()=>sampleRouteWeather({route,departureAt:instant,stops:[]})).toThrow('sample budget');
  });
  it('accepts a legitimate dataset update that arrives after the request started',async()=>{
    let clock=now;const date=jest.spyOn(Date,'now').mockImplementation(()=>clock);
    try{
      const raw=document();(raw.body as any).properties.meta.updated_at=new Date(now+500).toISOString();
      const cache={get:jest.fn(async()=>{clock=now+1000;return raw;})};
      const service=new WeatherService(config,new WeatherAdapterRegistry([new MetNorwayAdapter(config)]),cache as any);
      expect((await service.forecast([query()],new AbortController().signal)).data[0].status).toBe('available');
    }finally{date.mockRestore();}
  });
  it('normalizes the actual licensed Ankara document with absent optional fields left null',()=>{
    const raw=JSON.parse(readFileSync(resolve(__dirname,'fixtures/met-ankara-document.json'),'utf8')) as WeatherDocument;
    const series=new MetNorwayAdapter(config).parse(raw),q=query();q.location=series.location;
    q.validAt=new Date(Date.parse(series.sourceUpdatedAt)+3600000).toISOString();
    const forecast=normalizeWeather(series,q,'met-norway',Date.parse(series.sourceUpdatedAt)+1000);
    expect(forecast.status).toBe('available');expect(forecast.precipitationProbabilityPercent).toBeNull();
    expect(forecast.metadata?.license).toBe('CC-BY-4.0');expect(forecast.forecastIssuedAt).toBeNull();
  });
  it('requires terms and real identifying contact configuration before enabling network access',()=>{
    const original={...process.env};try{process.env.WEATHER_ENABLED='true';process.env.WEATHER_MET_TERMS_ACCEPTED='false';
      expect(()=>weatherConfig()).toThrow('accepted terms');
    }finally{process.env=original;}
  });
});

describe('Weather GET transport',()=>{
  const original=global.fetch;afterEach(()=>{global.fetch=original;});
  it('sends conditional headers and accepts bodyless 304 without inventing data',async()=>{
    const mock=jest.fn(async(..._args:Parameters<typeof fetch>)=>new Response(null,{status:304,headers:{Expires:new Date(Date.now()+3600000).toUTCString()}}));global.fetch=mock as typeof fetch;
    const result=await weatherTransport(config)('https://example.invalid',document().lastModified,new AbortController().signal);
    expect(result.body).toBeNull();expect((mock.mock.calls[0][1]?.headers as Record<string,string>)['If-Modified-Since']).toBe(document().lastModified);
  });
  it('surfaces deprecation, missing cache headers, malformed JSON and Retry-After',async()=>{
    global.fetch=jest.fn(async()=>new Response('{}',{status:203}));
    expect((await weatherTransport(config)('https://example.invalid',null,new AbortController().signal)).warnings).toContain('weather_product_deprecated');
    global.fetch=jest.fn(async()=>new Response('',{status:429,headers:{'Retry-After':'120'}}));
    await expect(weatherTransport(config)('https://example.invalid',null,new AbortController().signal)).rejects.toMatchObject({kind:'budget_exhausted',retrySeconds:120});
    global.fetch=jest.fn(async()=>new Response('bad JSON',{status:200}));
    await expect(weatherTransport(config)('https://example.invalid',null,new AbortController().signal)).rejects.toThrow('transport');
  });
});
