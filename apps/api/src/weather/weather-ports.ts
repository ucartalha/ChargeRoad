import type {Coordinate,WeatherForecast,WeatherQuery} from '@chargeroad/shared';

export interface WeatherHttpResponse {status:number;body:unknown|null;expiresAt:string;lastModified:string|null;validatedAt:string;warnings:string[];}
export interface WeatherDocument extends WeatherHttpResponse {fetchedAt:string;body:unknown;}
export type WeatherTransport=(url:string,lastModified:string|null,signal:AbortSignal)=>Promise<WeatherHttpResponse>;
export interface ForecastPoint {time:string;temperature:number|null;windKph:number|null;windFrom:number|null;pressure:number|null;
  periods:{hours:number;totalMm:number|null;probability:number|null}[];}
export interface ForecastSeries {location:Coordinate;elevation:number|null;sourceUpdatedAt:string;issuedAt:string|null;
  points:ForecastPoint[];fetchedAt:string;validatedAt:string;warnings:string[];sourceUrl:string;license:string;attribution:string;pressureKind:'sea_level'|'surface'|'unknown';}
export interface WeatherAdapter {readonly id:string;readonly version:string;
  readonly capabilities:{global:boolean;multiLocation:boolean;variables:readonly string[]};
  url(location:Coordinate):string;parse(document:WeatherDocument):ForecastSeries;
}
export interface WeatherSample {location:Coordinate;queries:WeatherQuery[];}
export class WeatherUnavailable extends Error {
  constructor(readonly kind:'provider_unavailable'|'budget_exhausted',message='Weather acquisition unavailable',readonly retrySeconds=60){super(message);}
}
export function unavailableForecast(query:WeatherQuery,status:NonNullable<WeatherForecast['status']>,sourceId:string):WeatherForecast{
  return {queryId:query.id,segmentId:query.segmentId,location:query.location,validAt:query.validAt,status,
    forecastIssuedAt:null,sourceUpdatedAt:null,fetchedAt:new Date().toISOString(),temperatureCelsius:null,windSpeedKph:null,windFromDegrees:null,
    precipitationMmPerHour:null,precipitationProbabilityPercent:null,snowDepthCm:null,airPressureHpa:null,
    source:{sourceId,recordId:null,version:null,url:null,retrievedAt:new Date().toISOString(),publishedAt:null,license:null}};
}
