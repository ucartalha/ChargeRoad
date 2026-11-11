import {z} from 'zod';
import type {Coordinate} from '@chargeroad/shared';
import type {WeatherAdapter,WeatherDocument,ForecastSeries,ForecastPoint} from './weather-ports';
import type {WeatherConfig} from './weather-policy';

const details=z.record(z.string(),z.number().finite());
const schema=z.object({type:z.literal('Feature'),geometry:z.object({type:z.literal('Point'),coordinates:z.array(z.number().finite()).min(2).max(3)}),
  properties:z.object({meta:z.object({updated_at:z.iso.datetime(),units:z.record(z.string(),z.string())}),
    timeseries:z.array(z.object({time:z.iso.datetime(),data:z.object({instant:z.object({details}),
      next_1_hours:z.object({details}).passthrough().optional(),next_6_hours:z.object({details}).passthrough().optional(),
      next_12_hours:z.object({details}).passthrough().optional()}).passthrough()})).min(2).max(1000)})}).passthrough();

export class MetNorwayAdapter implements WeatherAdapter {
  readonly id:string;readonly version='met-compact/1.0.0';
  readonly capabilities={global:true,multiLocation:false,variables:['temperature','wind','sea_level_pressure','precipitation']};
  constructor(private readonly config:WeatherConfig){this.id=config.providerId;}
  url(location:Coordinate){const url=new URL(this.config.endpoint);
    // Truncate, including negative coordinates; do not emit >4 decimal places.
    url.searchParams.set('lat',String(Math.trunc(location.latitude*10000)/10000));
    url.searchParams.set('lon',String(Math.trunc(location.longitude*10000)/10000));return url.toString();}
  parse(document:WeatherDocument):ForecastSeries{
    const raw=schema.parse(document.body),units=raw.properties.meta.units;
    for(const [key,unit]of Object.entries({air_temperature:'celsius',wind_speed:'m/s',wind_from_direction:'degrees',air_pressure_at_sea_level:'hPa',precipitation_amount:'mm',probability_of_precipitation:'%'}))
      if(units[key]!==undefined&&units[key]!==unit)throw new Error('Unexpected weather units');
    const read=(d:Record<string,number>,key:string,min=-Infinity,max=Infinity)=>{
      const value=d[key];if(value===undefined)return null;
      if(!units[key]||value<min||value>max)throw new Error('Invalid weather value or missing unit');return value;};
    const points:ForecastPoint[]=raw.properties.timeseries.map((entry,index,all)=>{
      if(index&&Date.parse(entry.time)<=Date.parse(all[index-1].time))throw new Error('Weather times are not strictly increasing');
      const d=entry.data.instant.details,wind=read(d,'wind_speed',0,150),from=read(d,'wind_from_direction',0,360);
      const periods=[1,6,12].flatMap(hours=>{const period=entry.data[('next_'+hours+'_hours') as 'next_1_hours'];
        return period?[{hours,totalMm:read(period.details,'precipitation_amount',0),probability:read(period.details,'probability_of_precipitation',0,100)}]:[];});
      return {time:entry.time,temperature:read(d,'air_temperature',-100,70),windKph:wind===null?null:wind*3.6,
        windFrom:from===null?null:from%360,pressure:read(d,'air_pressure_at_sea_level',100,1200),periods};
    });
    const [longitude,latitude,elevation]=raw.geometry.coordinates;
    if(Math.abs(latitude)>90||Math.abs(longitude)>180)throw new Error('Invalid weather location');
    return {location:{latitude,longitude},elevation:elevation??null,sourceUpdatedAt:raw.properties.meta.updated_at,issuedAt:null,
      points,fetchedAt:document.fetchedAt,validatedAt:document.validatedAt,warnings:document.warnings,
      sourceUrl:'https://api.met.no/doc/locationforecast/datamodel',license:'CC-BY-4.0',attribution:'Weather data: MET Norway (modified by temporal interpolation)',pressureKind:'sea_level'};
  }
}
