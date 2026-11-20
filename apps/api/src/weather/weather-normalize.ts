import {weatherForecastSchema,weatherForecastIsUsable} from '@chargeroad/shared';
import type {WeatherForecast,WeatherQuery} from '@chargeroad/shared';
import {meters} from '../roads/geometry';
import {WEATHER_POLICY} from './weather-policy';
import type {ForecastPoint,ForecastSeries} from './weather-ports';
import {unavailableForecast} from './weather-ports';

const blend=(a:number|null,b:number|null,f:number)=>a===null||b===null?null:a+(b-a)*f;
function vector(point:ForecastPoint):[number,number]|null{
  if(point.windKph===null)return null;if(point.windKph===0)return [0,0];if(point.windFrom===null)return null;
  const r=point.windFrom*Math.PI/180;return [-point.windKph*Math.sin(r),-point.windKph*Math.cos(r)];
}
/** Date.parse of every point time; callers normalizing many queries against one series may pass it once. */
export const seriesTimes=(series:ForecastSeries)=>series.points.map(p=>Date.parse(p.time));
export function normalizeWeather(series:ForecastSeries,query:WeatherQuery,provider:string,now=Date.now(),parsedTimes?:readonly number[]):WeatherForecast{
  const target=Date.parse(query.validAt),points=series.points,times=parsedTimes??seriesTimes(series);
  let right=times.findIndex(t=>t>=target);
  if(right<0||target<times[0])return unavailableForecast(query,'outside_horizon',provider);
  const exact=times[right]===target,left=exact?right:right-1;
  const a=points[left],b=points[right],start=times[left],end=times[right],gap=(end-start)/1000;
  if(gap>WEATHER_POLICY.maxGapSeconds)return unavailableForecast(query,'outside_horizon',provider);
  const f=end===start?0:(target-start)/(end-start),av=vector(a),bv=vector(b);
  let wind:number|null=null,from:number|null=null;
  if(av&&bv){const x=av[0]+(bv[0]-av[0])*f,y=av[1]+(bv[1]-av[1])*f;wind=Math.hypot(x,y);
    if(wind<1e-9)wind=0;else from=(Math.atan2(-x,-y)*180/Math.PI+360)%360;}
  const temperature=blend(a.temperature,b.temperature,f),pressure=blend(a.pressure,b.pressure,f),snowM=blend(a.snowDepthM??null,b.snowDepthM??null,f);
  const period=[...a.periods].sort((x,y)=>x.hours-y.hours).find(p=>target<start+p.hours*3600000&&start+p.hours*3600000<=times[times.length-1]);
  const age=(now-Date.parse(series.sourceUpdatedAt))/1000;
  const core=temperature!==null&&wind!==null&&(wind===0||from!==null);
  const warnings=[...series.warnings,'wind_is_modelled_at_10m','battery_temperature_is_not_ambient_temperature',...(snowM===null?['snow_depth_unavailable']:[])];
  if(!exact)warnings.push('weather_temporally_interpolated');
  if(query.samplingResolution?.phase==='future')warnings.push('coarse_future_weather_scenario');
  if(!period)warnings.push('precipitation_unavailable');else if(period.hours!==1)warnings.push('precipitation_is_period_average');
  if(period?.probability==null)warnings.push('precipitation_probability_unavailable');
  const status=age<0||age>WEATHER_POLICY.maxAgeSeconds?'stale':core?'available':'partial';
  const source={sourceId:provider,recordId:null,version:series.sourceUpdatedAt,url:series.sourceUrl,retrievedAt:series.fetchedAt,
    publishedAt:series.sourceUpdatedAt,license:series.license};
  // Built in schema key order so the copy-free path returns the same JSON as the Zod parse (2026-11-20).
  const forecast={queryId:query.id,segmentId:query.segmentId,location:query.location,validAt:query.validAt,
    forecastIssuedAt:series.issuedAt,sourceUpdatedAt:series.sourceUpdatedAt,status,fetchedAt:series.fetchedAt,
    temperatureCelsius:temperature,windSpeedKph:wind,windFromDegrees:from,precipitationProbabilityPercent:period?.probability??null,
    precipitationMmPerHour:period?.totalMm==null?null:period.totalMm/period.hours,snowDepthCm:snowM===null?null:Math.max(0,snowM*100),airPressureHpa:pressure,
    metadata:{sampledLocation:series.location,sampledElevationMeters:series.elevation,sampleDistanceMeters:meters(query.location,series.location),
      ...(query.samplingResolution?{samplingResolution:query.samplingResolution}:{}),
      coverageStart:points[0].time,coverageEnd:points.at(-1)!.time,lastValidatedAt:series.validatedAt,intervalStart:a.time,intervalEnd:b.time,
      timeStepSeconds:gap,method:exact?'exact':'linear_temperature_vector_wind',pressureKind:series.pressureKind,
      precipitationPeriod:period?{start:a.time,end:new Date(start+period.hours*3600000).toISOString(),totalMm:period.totalMm,probabilityPercent:period.probability}:null,
      warnings,license:series.license,attribution:series.attribution},source};
  return weatherForecastFastCheck(forecast)?forecast as WeatherForecast:weatherForecastSchema.parse(forecast);
}
/**
 * Copy-free forecast check (2026-11-20). A full Zod parse copied every internally built forecast (39 000 per long plan;
 * 1.6 GB of 6.5 GB Zod allocations in 5 long plans). Returns true only for values the schema accepts: numbers, ranges,
 * enums, lengths and strict keys are checked here; timestamps, URLs and the sampling resolution use the schema's own leaf
 * schemas (memoised). Anything else returns false and the caller runs the full parse, which throws the same error
 * (weather-fast-check.spec compares both decisions).
 */
const S=weatherForecastSchema.shape,M=S.metadata.unwrap().shape,SOURCE=S.source.shape;
const MEMO_LIMIT=20000,timestamps=new Map<string,boolean>(),urls=new Map<string,boolean>(),resolutions=new WeakMap<object,boolean>();
function memo(cache:Map<string,boolean>,schema:{safeParse(v:unknown):{success:boolean}},value:string){let ok=cache.get(value);
  if(ok===undefined){ok=schema.safeParse(value).success;if(cache.size>=MEMO_LIMIT)cache.clear();cache.set(value,ok);}return ok;}
type Rec=Record<string,unknown>;
const record=(v:unknown):v is Rec=>v!==null&&typeof v==='object'&&!Array.isArray(v);
// A key whose value is undefined is left to Zod: its output omits such keys, the fast path would keep them.
const only=(o:Rec,keys:ReadonlySet<string>)=>{for(const k of Object.keys(o))if(!keys.has(k)||o[k]===undefined)return false;return true;};
const fin=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const nonneg=(v:unknown)=>fin(v)&&v>=0,pct=(v:unknown)=>fin(v)&&v>=0&&v<=100;
const id=(v:unknown)=>typeof v==='string'&&v.length>=1&&v.length<=200;
const ts=(v:unknown)=>typeof v==='string'&&memo(timestamps,S.validAt,v);
const orNull=(check:(v:unknown)=>boolean)=>(v:unknown)=>v===null||check(v);
const coordinate=(v:unknown)=>record(v)&&only(v,COORDINATE)&&fin(v.latitude)&&v.latitude>=-90&&v.latitude<=90&&fin(v.longitude)&&v.longitude>=-180&&v.longitude<=180;
const COORDINATE=new Set(['latitude','longitude']);
const TOP=new Set(Object.keys(S)),META=new Set(Object.keys(M)),SRC=new Set(Object.keys(SOURCE)),PERIOD=new Set(['start','end','totalMm','probabilityPercent']);
const STATUS=new Set(['available','partial','stale','outside_horizon','provider_unavailable','budget_exhausted']);
const METHOD=new Set(['exact','linear_temperature_vector_wind']),PRESSURE=new Set(['sea_level','surface','unknown']);
function sourceOk(v:unknown){return record(v)&&only(v,SRC)&&id(v.sourceId)&&orNull(id)(v.recordId)&&orNull(id)(v.version)&&
  (v.url===null||typeof v.url==='string'&&memo(urls,SOURCE.url,v.url))&&ts(v.retrievedAt)&&orNull(ts)(v.publishedAt)&&
  (v.license===null||typeof v.license==='string'&&v.license.length>=1);}
function metadataOk(v:unknown){
  if(v===undefined)return true;if(!record(v)||!only(v,META))return false;
  if(v.samplingResolution!==undefined){const r=v.samplingResolution;if(!record(r))return false;let ok=resolutions.get(r);
    if(ok===undefined){ok=M.samplingResolution.safeParse(r).success;resolutions.set(r,ok);}if(!ok)return false;}
  const p=v.precipitationPeriod;
  return coordinate(v.sampledLocation)&&orNull(fin)(v.sampledElevationMeters)&&nonneg(v.sampleDistanceMeters)&&ts(v.coverageStart)&&ts(v.coverageEnd)&&
    ts(v.lastValidatedAt)&&ts(v.intervalStart)&&ts(v.intervalEnd)&&nonneg(v.timeStepSeconds)&&METHOD.has(v.method as string)&&PRESSURE.has(v.pressureKind as string)&&
    (p===null||record(p)&&only(p,PERIOD)&&ts(p.start)&&ts(p.end)&&orNull(nonneg)(p.totalMm)&&orNull(pct)(p.probabilityPercent))&&
    Array.isArray(v.warnings)&&v.warnings.every(w=>typeof w==='string')&&typeof v.license==='string'&&typeof v.attribution==='string';
}
export function weatherForecastFastCheck(v:unknown):boolean{
  return record(v)&&only(v,TOP)&&id(v.queryId)&&id(v.segmentId)&&coordinate(v.location)&&ts(v.validAt)&&orNull(ts)(v.forecastIssuedAt)&&
    (v.sourceUpdatedAt===undefined||orNull(ts)(v.sourceUpdatedAt))&&(v.status===undefined||STATUS.has(v.status as string))&&ts(v.fetchedAt)&&
    orNull(fin)(v.temperatureCelsius)&&orNull(nonneg)(v.windSpeedKph)&&(v.windFromDegrees===null||nonneg(v.windFromDegrees)&&(v.windFromDegrees as number)<360)&&
    orNull(pct)(v.precipitationProbabilityPercent)&&orNull(nonneg)(v.precipitationMmPerHour)&&orNull(nonneg)(v.snowDepthCm)&&
    (v.airPressureHpa===null||fin(v.airPressureHpa)&&v.airPressureHpa>0)&&metadataOk(v.metadata)&&sourceOk(v.source);
}
export function usableWeather(forecast:WeatherForecast,now=Date.now(),maxAge:number=WEATHER_POLICY.maxAgeSeconds):boolean{
  return weatherForecastIsUsable(forecast,now,maxAge);
}
