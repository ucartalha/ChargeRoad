import type {WeatherDocument} from '../weather-ports';
import type {WeatherConfig} from '../weather-policy';
export const instant='2026-11-11T13:00:00Z';
export const config:WeatherConfig={enabled:true,providerId:'test-weather',endpoint:'https://example.invalid/forecast',userAgent:'ChargeRoad/test public-contact',termsAccepted:true};
export const query=(id='q',validAt='2026-11-11T13:30:00Z')=>({id,segmentId:'s',location:{latitude:39.9,longitude:32.8},validAt});
export function document():WeatherDocument{return {status:200,expiresAt:new Date(Date.now()+3600000).toISOString(),lastModified:'Wed, 11 Nov 2026 13:00:00 GMT',
  validatedAt:instant,fetchedAt:instant,warnings:[],body:{type:'Feature',geometry:{type:'Point',coordinates:[32.8,39.9,800]},
    properties:{meta:{updated_at:instant,units:{air_temperature:'celsius',wind_speed:'m/s',wind_from_direction:'degrees',air_pressure_at_sea_level:'hPa',
      precipitation_amount:'mm',probability_of_precipitation:'%'}},timeseries:[0,1,7].map((hour,index)=>({time:new Date(Date.parse(instant)+hour*3600000).toISOString(),
        data:{instant:{details:{air_temperature:20+2*index,wind_speed:5,wind_from_direction:index===0?359:1,air_pressure_at_sea_level:1000}},
          ...(index===0?{next_1_hours:{details:{precipitation_amount:2,probability_of_precipitation:30}}}:{}),
          ...(index<2?{next_6_hours:{details:{precipitation_amount:12,probability_of_precipitation:40}}}:{})}}))}}};}
