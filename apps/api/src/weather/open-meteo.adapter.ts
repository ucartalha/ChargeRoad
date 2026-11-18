import {z} from 'zod';
import type {Coordinate} from '@chargeroad/shared';
import type {ForecastPoint,ForecastSeries,WeatherAdapter,WeatherDocument,WeatherTransport} from './weather-ports';
import {WeatherUnavailable} from './weather-ports';
import type {WeatherConfig} from './weather-policy';
import {WEATHER_POLICY,OPEN_METEO_DEFAULTS} from './weather-policy';
import {meters} from '../roads/geometry';
import {countMetric,startStage} from '../observability/planning-metrics';

/** Self-hosted Open-Meteo serving DWD ICON for the Turkey box (infra/open-meteo). The forecast API does not publish
 *  model run times, so the transport also reads the synced domain's static/meta.json; freshness stays tied to the
 *  real run (`last_run_initialisation_time`), never to the download time. */
export const OPEN_METEO_PROVIDER_ID='open-meteo-local';
const HOURLY=['temperature_2m','wind_speed_10m','wind_direction_10m','precipitation','pressure_msl','snow_depth'] as const;
const UNITS={temperature_2m:'°C',wind_speed_10m:'km/h',wind_direction_10m:'°',precipitation:'mm',pressure_msl:'hPa',snow_depth:'m'} as const;
/** cell_selection=nearest: the nearest ICON cell (native ~13 km, reported on a 0.125° lattice) stays well inside this; the
 *  default 'land' selection may jump ~20 km at lakes/coasts. Temperature is downscaled to the point with the 90 m DEM. */
const MAX_GRID_SNAP_METERS=15000;
const series=z.array(z.number().finite().nullable());
const schema=z.object({
  request:z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180)}).strict(),
  meta:z.object({last_run_initialisation_time:z.number().int().positive(),last_run_availability_time:z.number().int().positive()}).passthrough(),
  forecast:z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),elevation:z.number().finite().nullable().optional(),
    hourly_units:z.record(z.string(),z.string()),
    hourly:z.object({time:z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)).min(2).max(1000),
      ...Object.fromEntries(HOURLY.map(k=>[k,series])) as Record<typeof HOURLY[number],typeof series>}).passthrough()}).passthrough()}).strict();
const iso=(seconds:number)=>new Date(seconds*1000).toISOString();

export class OpenMeteoAdapter implements WeatherAdapter {
  readonly id=OPEN_METEO_PROVIDER_ID;readonly version='open-meteo-icon/1.0.0';
  readonly capabilities={global:false,multiLocation:false,variables:['temperature','wind','sea_level_pressure','precipitation','snow_depth']};
  private readonly om:NonNullable<WeatherConfig['openMeteo']>;
  constructor(config:WeatherConfig){this.om=config.openMeteo??OPEN_METEO_DEFAULTS;}
  url(location:Coordinate){const url=new URL('/v1/forecast',this.om.endpoint);
    url.searchParams.set('latitude',String(Math.trunc(location.latitude*10000)/10000));
    url.searchParams.set('longitude',String(Math.trunc(location.longitude*10000)/10000));
    url.searchParams.set('models',this.om.model);url.searchParams.set('hourly',HOURLY.join(','));
    url.searchParams.set('wind_speed_unit','kmh');url.searchParams.set('cell_selection','nearest');url.searchParams.set('timezone','GMT');url.searchParams.set('forecast_days','5');
    return url.toString();}
  metaUrl(){return new URL(`/${this.om.domain}/static/meta.json`,this.om.metaEndpoint).toString();}
  parse(document:WeatherDocument):ForecastSeries{
    const raw=schema.parse(document.body),f=raw.forecast,h=f.hourly;
    for(const [key,unit] of Object.entries(UNITS))if(f.hourly_units[key]!==unit)throw new Error('Unexpected weather units');
    if(HOURLY.some(k=>h[k].length!==h.time.length))throw new Error('Weather series length mismatch');
    if(h.temperature_2m.every(v=>v===null))throw new Error('Weather location outside the synced model area');
    const requested={latitude:raw.request.latitude,longitude:raw.request.longitude},cell={latitude:f.latitude,longitude:f.longitude};
    if(meters(requested,cell)>MAX_GRID_SNAP_METERS)throw new Error('Weather grid cell too far from the requested location');
    const check=(v:number|null,min:number,max:number)=>{if(v!==null&&(v<min||v>max))throw new Error('Invalid weather value');return v;};
    const points:ForecastPoint[]=h.time.map((time,i)=>{
      if(i&&Date.parse(time+':00Z')<=Date.parse(h.time[i-1]+':00Z'))throw new Error('Weather times are not strictly increasing');
      const wind=check(h.wind_speed_10m[i],0,540),from=check(h.wind_direction_10m[i],0,360);
      // Open-Meteo precipitation at T is the sum of the preceding hour; the hour after T is the next sample.
      const next=i+1<h.time.length?check(h.precipitation[i+1],0,500):null;
      return {time:time+':00Z',temperature:check(h.temperature_2m[i],-100,70),windKph:wind,windFrom:from===null?null:from%360,
        pressure:check(h.pressure_msl[i],100,1200),snowDepthM:check(h.snow_depth[i],0,50),
        periods:i+1<h.time.length&&next!==null?[{hours:1,totalMm:next,probability:null}]:[]};
    });
    return {location:requested,elevation:f.elevation??null,sourceUpdatedAt:iso(raw.meta.last_run_availability_time),
      issuedAt:iso(raw.meta.last_run_initialisation_time),points,fetchedAt:document.fetchedAt,validatedAt:document.validatedAt,
      warnings:[...document.warnings,'weather_model_nearest_grid_cell'],sourceUrl:'https://open-meteo.com/en/docs/dwd-api',license:'CC-BY-4.0',
      attribution:'Weather data: Deutscher Wetterdienst (DWD) ICON via self-hosted Open-Meteo (modified by temporal interpolation)',pressureKind:'sea_level'};
  }
}

/** Loopback-only transport: forecast + model-run metadata in one document. A local outage is provider_unavailable. */
export function openMeteoTransport(adapter:OpenMeteoAdapter,fetcher:typeof fetch=fetch):WeatherTransport{
  const json=async(url:string,signal:AbortSignal)=>{const response=await fetcher(url,{method:'GET',redirect:'error',signal,headers:{Accept:'application/json'}});
    if(response.status!==200)throw new WeatherUnavailable('provider_unavailable','Self-hosted weather HTTP '+response.status);
    const text=await response.text();if(text.length>2*1024*1024)throw new Error('Weather body too large');return JSON.parse(text) as unknown;};
  return async(url,_lastModified,signal)=>{
    const end=startStage('weather_http');
    try{countMetric('weather_http_acquisitions');const request=new URL(url);
      const [forecast,meta]=await Promise.all([json(url,signal),json(adapter.metaUrl(),signal)]);
      const now=Date.now(),validatedAt=new Date(now).toISOString();
      return {status:200,body:{request:{latitude:Number(request.searchParams.get('latitude')),longitude:Number(request.searchParams.get('longitude'))},forecast,meta},
        // A new ICON run lands every 6 h; the next sync check is at most minutes away. Re-read local data hourly at most.
        expiresAt:new Date(now+WEATHER_POLICY.fallbackCacheSeconds*1000).toISOString(),lastModified:null,validatedAt,warnings:[]};
    }catch(error){if(error instanceof WeatherUnavailable)throw error;throw new WeatherUnavailable('provider_unavailable','Self-hosted weather transport failed');}
    finally{end();}
  };
}
