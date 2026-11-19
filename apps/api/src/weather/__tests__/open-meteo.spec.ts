import {OpenMeteoAdapter,OPEN_METEO_PROVIDER_ID} from '../open-meteo.adapter';
import {weatherConfig,weatherProviderLimits,WEATHER_POLICY} from '../weather-policy';
import {normalizeWeather} from '../weather-normalize';
import type {WeatherDocument} from '../weather-ports';

// Self-hosted Open-Meteo (DWD ICON, Turkey box). Synthetic numbers; public city-centre coordinates only.
const config=()=>({enabled:true,providerId:OPEN_METEO_PROVIDER_ID,endpoint:'https://api.met.no/weatherapi/locationforecast/2.0/compact',userAgent:'',termsAccepted:false,
  openMeteo:{endpoint:'http://127.0.0.1:8090',metaEndpoint:'http://127.0.0.1:8091',model:'dwd_icon',domain:'dwd_icon_global_native'}});
const hours=['2026-11-18T00:00','2026-11-18T01:00','2026-11-18T02:00','2026-11-18T03:00'];
const body=(patch:Record<string,unknown>={})=>({request:{latitude:39.92,longitude:32.85},
  meta:{last_run_initialisation_time:Date.parse('2026-11-17T18:00:00Z')/1000,last_run_availability_time:Date.parse('2026-11-17T22:09:25Z')/1000,
    update_interval_seconds:21600,temporal_resolution_seconds:3600},
  forecast:{latitude:39.875,longitude:32.875,elevation:938,hourly_units:{time:'iso8601',temperature_2m:'°C',wind_speed_10m:'km/h',wind_direction_10m:'°',
    precipitation:'mm',pressure_msl:'hPa',snow_depth:'m'},
    hourly:{time:hours,temperature_2m:[6.5,6,5.5,5],wind_speed_10m:[10,12,0,8],wind_direction_10m:[90,180,0,270],precipitation:[0,0.4,1.2,0],
      pressure_msl:[1015,1015.5,1016,1016.2],snow_depth:[0,0,0.02,0.03]},...patch}});
const doc=(b:unknown):WeatherDocument=>({status:200,body:b,expiresAt:'2026-11-18T01:00:00Z',lastModified:null,validatedAt:'2026-11-18T00:10:00Z',fetchedAt:'2026-11-18T00:10:00Z',warnings:[]});

describe('Self-hosted Open-Meteo adapter',()=>{
  it('builds a local ICON forecast URL with four-decimal coordinates and only the variables we use',()=>{
    const url=new URL(new OpenMeteoAdapter(config()).url({latitude:39.923456,longitude:-32.85678}));
    expect(url.origin+url.pathname).toBe('http://127.0.0.1:8090/v1/forecast');
    expect(url.searchParams.get('latitude')).toBe('39.9234');expect(url.searchParams.get('longitude')).toBe('-32.8567');
    expect(url.searchParams.get('models')).toBe('dwd_icon');expect(url.searchParams.get('wind_speed_unit')).toBe('kmh');expect(url.searchParams.get('timezone')).toBe('GMT');expect(url.searchParams.get('cell_selection')).toBe('nearest');
    expect(url.searchParams.get('hourly')!.split(',').sort()).toEqual(['precipitation','pressure_msl','snow_depth','temperature_2m','wind_direction_10m','wind_speed_10m']);
  });
  it('parses run times, UTC hours, next-hour precipitation and snow depth',()=>{
    const s=new OpenMeteoAdapter(config()).parse(doc(body()));
    expect(s.location).toEqual({latitude:39.92,longitude:32.85});expect(s.elevation).toBe(938);
    expect(s.issuedAt).toBe('2026-11-17T18:00:00.000Z');expect(s.sourceUpdatedAt).toBe('2026-11-17T22:09:25.000Z');
    expect(s.points.map(p=>p.time)).toEqual(hours.map(h=>h+':00Z'));
    expect(s.points[0]).toMatchObject({temperature:6.5,windKph:10,windFrom:90,pressure:1015,snowDepthM:0});
    // Open-Meteo precipitation is the sum of the preceding hour: the hour after 00:00 is the 01:00 value.
    expect(s.points[0].periods).toEqual([{hours:1,totalMm:0.4,probability:null}]);expect(s.points.at(-1)!.periods).toEqual([]);
    expect(s.pressureKind).toBe('sea_level');expect(s.attribution).toMatch(/DWD/);expect(s.license).toBe('CC-BY-4.0');
    expect(s.warnings).toContain('weather_model_nearest_grid_cell');
  });
  it('keeps snow depth in the normalized forecast when the provider has it',()=>{
    const s=new OpenMeteoAdapter(config()).parse(doc(body()));
    const f=normalizeWeather(s,{id:'q',segmentId:'seg',location:{latitude:39.92,longitude:32.85},validAt:'2026-11-18T02:30:00Z'},OPEN_METEO_PROVIDER_ID,
      Date.parse('2026-11-18T00:20:00Z'));
    expect(f.snowDepthCm).toBeCloseTo(2.5,6);expect(f.metadata!.warnings).not.toContain('snow_depth_unavailable');
    expect(f.status).toBe('available');expect(f.forecastIssuedAt).toBe('2026-11-17T18:00:00.000Z');
  });
  it('rejects unexpected units, a missing area (outside the synced box) and a far grid cell',()=>{
    const a=new OpenMeteoAdapter(config());
    expect(()=>a.parse(doc(body({hourly_units:{...body().forecast.hourly_units,wind_speed_10m:'m/s'}})))).toThrow();
    const empty=body();empty.forecast.hourly.temperature_2m=[null,null,null,null] as never;expect(()=>a.parse(doc(empty))).toThrow(/outside/i);
    expect(()=>a.parse(doc(body({latitude:40.5,longitude:32.875})))).toThrow(/grid/i);
  });
  it('keeps MET limits and gives the local server its own capacity limits',()=>{
    expect(weatherProviderLimits('met-norway')).toEqual({dailyLimit:WEATHER_POLICY.dailyLimit,minIntervalMs:WEATHER_POLICY.minIntervalMs,maxConcurrency:WEATHER_POLICY.maxConcurrency,
      maxExternalCalls:WEATHER_POLICY.maxExternalCalls});
    expect(weatherProviderLimits('met-norway').dailyLimit).toBe(1000);
    const local=weatherProviderLimits(OPEN_METEO_PROVIDER_ID);expect(local.dailyLimit).toBeGreaterThan(1000);expect(local.minIntervalMs).toBe(0);
  });
  it('enables the local provider without MET terms but only on a loopback endpoint',()=>{
    const env={...process.env};
    try{
      Object.assign(process.env,{WEATHER_ENABLED:'true',WEATHER_PROVIDER_ID:OPEN_METEO_PROVIDER_ID,WEATHER_MET_TERMS_ACCEPTED:'false',WEATHER_USER_AGENT:''});
      delete process.env.WEATHER_OPEN_METEO_ENDPOINT;
      expect(weatherConfig().openMeteo!.endpoint).toBe('http://127.0.0.1:8090');
      process.env.WEATHER_OPEN_METEO_ENDPOINT='http://10.0.0.5:8090';expect(()=>weatherConfig()).toThrow();
      process.env.WEATHER_PROVIDER_ID='met-norway';delete process.env.WEATHER_OPEN_METEO_ENDPOINT;expect(()=>weatherConfig()).toThrow(/terms/i);
    }finally{process.env=env;}
  });
});
