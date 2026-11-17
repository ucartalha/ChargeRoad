import {weatherSampleDistanceLimit} from '@chargeroad/shared';
import {buildPlanningWeather,samplingRange} from '../planning-weather-policy';
import {sampleRouteWeather} from '../weather-sampler';
import {gridCellCenter,chooseGridDegrees,weatherGridEnabled,WEATHER_GRID_POLICY} from '../weather-grid';
import {WeatherService,WeatherAdapterRegistry} from '../weather.service';
import {MetNorwayAdapter} from '../met-norway.adapter';
import {config,document} from './fixtures';
import {windowRoute} from './window-route.fixture';
import {optimizerWorld} from '../../planning/__tests__/optimizer.fixtures';
import {source} from '../../planning/__tests__/fixtures';
import type {RouteWeatherRequest} from '@chargeroad/shared';

const range={rangeKm:400,cycle:'wltp',source:source('synthetic-catalogue')};
const planningFor=(input:RouteWeatherRequest,grid:boolean)=>buildPlanningWeather(input.route,samplingRange(optimizerWorld().vehicle,range),{grid});
function reversed(input:RouteWeatherRequest):RouteWeatherRequest{
  const out=structuredClone(input),total=out.route.distanceMeters;
  out.route.id=out.route.id+'-reverse';
  out.route.segments=out.route.segments.slice().reverse().map((s,i)=>({...s,id:'r-'+i,startDistanceMeters:total-s.endDistanceMeters,endDistanceMeters:total-s.startDistanceMeters,
    geometry:s.geometry.slice().reverse()}));
  return out;
}
function shifted(input:RouteWeatherRequest,startKm:number):RouteWeatherRequest{
  const out=structuredClone(input),segments=out.route.segments.slice(startKm);
  out.route.id=out.route.id+'-from-'+startKm;out.route.distanceMeters=segments.length*1000;out.route.drivingDurationSeconds=segments.length*36;
  out.route.segments=segments.map((s,i)=>({...s,startDistanceMeters:i*1000,endDistanceMeters:(i+1)*1000}));return out;
}
const sampleOf=(input:RouteWeatherRequest,grid=true)=>{const p=planningFor(input,grid);return new Map(sampleRouteWeather(input,p).queries.map(q=>[JSON.stringify(q.location),q]));};

describe('Global weather grid (W4)',()=>{
  it('maps a coordinate to a deterministic cell centre with at most 4 decimals',()=>{
    expect(gridCellCenter({latitude:41.0055,longitude:28.9768},0.1)).toEqual({latitude:41.05,longitude:28.95});
    expect(gridCellCenter({latitude:41.0999,longitude:28.9001},0.1)).toEqual({latitude:41.05,longitude:28.95});
    expect(gridCellCenter({latitude:39.9208,longitude:32.8541},0.2)).toEqual({latitude:39.9,longitude:32.9});
    expect(gridCellCenter({latitude:-0.05,longitude:-0.05},0.1)).toEqual({latitude:-0.05,longitude:-0.05});
  });
  it('is on by default and can be switched off explicitly',()=>{
    expect(weatherGridEnabled(undefined)).toBe(true);expect(weatherGridEnabled('true')).toBe(true);expect(weatherGridEnabled('false')).toBe(false);
    const input=windowRoute(300),p=planningFor(input,false);
    expect(Object.hasOwn(p,'gridDegrees')).toBe(false);
    const legacy=sampleRouteWeather(input,p).queries;
    expect(legacy.every(q=>q.sampleGridDegrees===undefined&&q.sampleElevationMeters===undefined)).toBe(true);
  });
  it('uses 0.1 deg cells for ordinary routes and 0.2 deg only when 0.1 would exceed the base-cell bound',()=>{
    expect(chooseGridDegrees(windowRoute(300).route)).toBe(0.1);
    expect(chooseGridDegrees(windowRoute(1500).route)).toBe(0.2);
    expect(WEATHER_GRID_POLICY.maxBaseCells).toBeLessThan(128);
  });
  it('shares the same cell between different routes, reverse direction and a later start point',()=>{
    const base=windowRoute(300),forward=sampleOf(base),back=sampleOf(reversed(base)),later=sampleOf(shifted(base,120));
    let compared=0;
    for(const [key,q] of later){const f=forward.get(key)!;expect(q.sampleLocation).toEqual(f.sampleLocation);compared++;}
    for(const [key,q] of back){const f=forward.get(key);if(!f)continue;expect(q.sampleLocation).toEqual(f.sampleLocation);compared++;}
    expect(compared).toBeGreaterThan(400);
  });
  it('keeps every grid sample within the existing per-query distance limit and records terrain context',()=>{
    for(const km of [150,450,1200]){
      const input=windowRoute(km),p=planningFor(input,true),{queries,samples}=sampleRouteWeather(input,p);
      expect(samples.length).toBeLessThanOrEqual(128);
      for(const q of queries){
        expect(q.sampleGridDegrees).toBe(p.gridDegrees);expect(q.sampleElevationMeters).toBe(800);expect(q.sampleReliefMeters).toBeUndefined();
        const d=Math.hypot((q.sampleLocation!.latitude-q.location.latitude)*111320,(q.sampleLocation!.longitude-q.location.longitude)*111320*Math.cos(q.location.latitude*Math.PI/180));
        expect(d).toBeLessThanOrEqual(weatherSampleDistanceLimit(q.samplingResolution));
      }
    }
  });
  it('falls back to the existing anchor for segments without elevation data',()=>{
    const input=windowRoute(100);for(const s of input.route.segments.slice(0,10))delete (s as {elevationProfile?:unknown}).elevationProfile;
    const queries=sampleRouteWeather(input,planningFor(input,true)).queries;
    expect(queries.slice(0,10).every(q=>q.sampleGridDegrees===undefined)).toBe(true);
    expect(queries.slice(10).every(q=>q.sampleGridDegrees===0.1)).toBe(true);
  });
  it('treats provider no-data elevations (e.g. Valhalla -499.9) as unknown',()=>{
    const input=windowRoute(50);
    for(const s of input.route.segments.slice(0,5))s.elevationProfile=s.elevationProfile!.map(p=>({...p,elevationMeters:-499.9}));
    const queries=sampleRouteWeather(input,planningFor(input,true)).queries;
    expect(queries.slice(0,5).every(q=>q.sampleGridDegrees===undefined)).toBe(true);
    expect(queries.slice(5).every(q=>q.sampleGridDegrees===0.1)).toBe(true);
  });
  it('keeps the route anchor as the cell fallback so a rejected cell never multiplies requests',()=>{
    const input=windowRoute(300),legacy=sampleRouteWeather(input,planningFor(input,false)).queries,grid=sampleRouteWeather(input,planningFor(input,true)).queries;
    for(let i=0;i<grid.length;i++)expect(grid[i].sampleFallbackLocation).toEqual(legacy[i].sampleLocation);
    const fallbacks=new Set(grid.map(q=>JSON.stringify(q.sampleFallbackLocation)));
    expect(fallbacks.size).toBe(new Set(legacy.map(q=>JSON.stringify(q.sampleLocation))).size);
  });
});

describe('Grid terrain guard in WeatherService',()=>{
  const at=(cellElevation:number)=>{
    const urls:string[]=[];
    const cache={get:jest.fn(async(_p:string,_v:string,url:string)=>{urls.push(url);const doc=document(),u=new URL(url);
      (doc.body as {geometry:{coordinates:number[]}}).geometry.coordinates=[Number(u.searchParams.get('lon')),Number(u.searchParams.get('lat')),
        url.includes('lat=39.95')?cellElevation:800];return doc;})};
    return {urls,service:new WeatherService(config,new WeatherAdapterRegistry([new MetNorwayAdapter(config)]),cache as never)};
  };
  const gridQuery={id:'q',segmentId:'s',location:{latitude:39.93,longitude:32.81},validAt:'2026-11-11T13:30:00Z',
    sampleLocation:{latitude:39.95,longitude:32.85},sampleGridDegrees:0.1,sampleElevationMeters:800,sampleFallbackLocation:{latitude:39.92,longitude:32.8},
    samplingResolution:{policyVersion:'range-adaptive/1.0.0' as const,phase:'near_term' as const,intervalMeters:15000}};
  beforeEach(()=>jest.useFakeTimers({now:Date.parse('2026-11-11T13:10:00Z'),doNotFake:['nextTick','queueMicrotask','setImmediate','setTimeout','setInterval','clearTimeout','clearInterval','clearImmediate','performance','hrtime']}));
  afterEach(()=>jest.useRealTimers());
  it('shares the cell when its model elevation is within 100 m of the road',async()=>{
    const {urls,service}=at(880),result=await service.forecast([gridQuery],new AbortController().signal);
    expect(urls).toHaveLength(1);expect(urls[0]).toContain('lat=39.95');
    expect(result.data[0].metadata?.sampledLocation).toEqual({latitude:39.95,longitude:32.85});
    expect(result.data[0].metadata?.warnings).toContain('weather_grid_cell_shared');
  });
  it('rejects the cell and uses the route anchor (not a new per-segment point) when elevation differs by more than 100 m',async()=>{
    const {urls,service}=at(1100),result=await service.forecast([gridQuery],new AbortController().signal);
    expect(urls).toHaveLength(2);expect(urls[1]).toContain('lat=39.92');
    expect(result.data[0].metadata?.sampledLocation).toEqual({latitude:39.92,longitude:32.8});
    expect(result.data[0].metadata?.warnings).toContain('weather_cell_rejected_elevation_mismatch');
  });
});
