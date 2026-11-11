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
export function normalizeWeather(series:ForecastSeries,query:WeatherQuery,provider:string,now=Date.now()):WeatherForecast{
  const target=Date.parse(query.validAt),points=series.points;
  let right=points.findIndex(p=>Date.parse(p.time)>=target);
  if(right<0||target<Date.parse(points[0].time))return unavailableForecast(query,'outside_horizon',provider);
  const exact=Date.parse(points[right].time)===target,left=exact?right:right-1;
  const a=points[left],b=points[right],start=Date.parse(a.time),end=Date.parse(b.time),gap=(end-start)/1000;
  if(gap>WEATHER_POLICY.maxGapSeconds)return unavailableForecast(query,'outside_horizon',provider);
  const f=end===start?0:(target-start)/(end-start),av=vector(a),bv=vector(b);
  let wind:number|null=null,from:number|null=null;
  if(av&&bv){const x=av[0]+(bv[0]-av[0])*f,y=av[1]+(bv[1]-av[1])*f;wind=Math.hypot(x,y);
    if(wind<1e-9)wind=0;else from=(Math.atan2(-x,-y)*180/Math.PI+360)%360;}
  const temperature=blend(a.temperature,b.temperature,f),pressure=blend(a.pressure,b.pressure,f);
  const period=[...a.periods].sort((x,y)=>x.hours-y.hours).find(p=>target<start+p.hours*3600000&&start+p.hours*3600000<=Date.parse(points.at(-1)!.time));
  const age=(now-Date.parse(series.sourceUpdatedAt))/1000;
  const core=temperature!==null&&wind!==null&&(wind===0||from!==null);
  const warnings=[...series.warnings,'wind_is_modelled_at_10m','battery_temperature_is_not_ambient_temperature','snow_depth_unavailable'];
  if(!exact)warnings.push('weather_temporally_interpolated');
  if(!period)warnings.push('precipitation_unavailable');else if(period.hours!==1)warnings.push('precipitation_is_period_average');
  if(period?.probability==null)warnings.push('precipitation_probability_unavailable');
  const status=age<0||age>WEATHER_POLICY.maxAgeSeconds?'stale':core?'available':'partial';
  const source={sourceId:provider,recordId:null,version:series.sourceUpdatedAt,url:series.sourceUrl,retrievedAt:series.fetchedAt,
    publishedAt:series.sourceUpdatedAt,license:series.license};
  return weatherForecastSchema.parse({queryId:query.id,segmentId:query.segmentId,location:query.location,validAt:query.validAt,
    status,forecastIssuedAt:series.issuedAt,sourceUpdatedAt:series.sourceUpdatedAt,fetchedAt:series.fetchedAt,
    temperatureCelsius:temperature,windSpeedKph:wind,windFromDegrees:from,precipitationMmPerHour:period?.totalMm==null?null:period.totalMm/period.hours,
    precipitationProbabilityPercent:period?.probability??null,snowDepthCm:null,airPressureHpa:pressure,source,
    metadata:{sampledLocation:series.location,sampledElevationMeters:series.elevation,sampleDistanceMeters:meters(query.location,series.location),
      coverageStart:points[0].time,coverageEnd:points.at(-1)!.time,lastValidatedAt:series.validatedAt,intervalStart:a.time,intervalEnd:b.time,
      timeStepSeconds:gap,method:exact?'exact':'linear_temperature_vector_wind',pressureKind:series.pressureKind,
      precipitationPeriod:period?{start:a.time,end:new Date(start+period.hours*3600000).toISOString(),totalMm:period.totalMm,probabilityPercent:period.probability}:null,
      warnings,license:series.license,attribution:series.attribution}});
}
export function usableWeather(forecast:WeatherForecast,now=Date.now(),maxAge:number=WEATHER_POLICY.maxAgeSeconds):boolean{
  return weatherForecastIsUsable(forecast,now,maxAge);
}
