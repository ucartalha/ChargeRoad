import {Module} from '@nestjs/common';
import {DatabaseModule} from '../database/database.module';
import {DatabaseService} from '../database/database.service';
import {WeatherProvider} from '../providers/weather-provider';
import {weatherConfig} from './weather-policy';
import {weatherTransport} from './weather-http';
import {WeatherCacheStore} from './weather-cache';
import {MetNorwayAdapter} from './met-norway.adapter';
import {OpenMeteoAdapter,openMeteoTransport,OPEN_METEO_PROVIDER_ID} from './open-meteo.adapter';
import {WeatherService,WeatherAdapterRegistry} from './weather.service';
import {WeatherController} from './weather.controller';
import {WeatherMaintenance} from './weather-maintenance';
import {RoadsModule} from '../roads/roads.module';

export function createWeatherService(database:DatabaseService){
  const config=weatherConfig();
  // One active provider per process (WEATHER_PROVIDER_ID); MET stays the default and keeps its own id/transport.
  if(config.providerId===OPEN_METEO_PROVIDER_ID){const openMeteo=new OpenMeteoAdapter(config);
    return new WeatherService(config,new WeatherAdapterRegistry([openMeteo]),
      new WeatherCacheStore(database,openMeteoTransport(openMeteo),process.env.RATE_LIMIT_IP_HASH_SECRET??''));}
  return new WeatherService(config,new WeatherAdapterRegistry([new MetNorwayAdapter(config)]),
    new WeatherCacheStore(database,weatherTransport(config),process.env.RATE_LIMIT_IP_HASH_SECRET??''));
}
@Module({imports:[DatabaseModule,RoadsModule],controllers:[WeatherController],providers:[
  {provide:WeatherService,useFactory:createWeatherService,inject:[DatabaseService]},
  {provide:WeatherProvider,useExisting:WeatherService},WeatherMaintenance],exports:[WeatherService,WeatherProvider]})
export class WeatherModule {}
