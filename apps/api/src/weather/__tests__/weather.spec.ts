import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {MetNorwayAdapter} from '../met-norway.adapter';
import {normalizeWeather,usableWeather} from '../weather-normalize';
import {WeatherAdapterRegistry,WeatherService} from '../weather.service';
import {sampleRouteWeather} from '../weather-sampler';
import {weatherTransport} from '../weather-http';
import {weatherConfig} from '../weather-policy';
import {config,document,query,instant} from './fixtures';
import {trip,roadRequest,config as roadConfig} from '../../roads/__tests__/fixtures';
import {normalizeRoadTrip} from '../../roads/normalize-road';
import type {WeatherDocument} from '../weather-ports';
const now=Date.parse(instant);

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
    const large=trip();large.legs[0].distanceMeters=700000;large.legs[0].seconds=25200;
    large.legs[0].maneuvers[0].seconds=25200;large.legs[0].elevation=null;
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
