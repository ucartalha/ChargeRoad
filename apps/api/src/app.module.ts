import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { VehiclesModule } from './vehicles/vehicles.module';
import { SecurityModule } from './security/security.module';
import { StationsModule } from './stations/stations.module';
import { RoadsModule } from './roads/roads.module';
import { WeatherModule } from './weather/weather.module';
import { EnergyModule } from './energy/energy.module';

@Module({
  imports: [VehiclesModule,StationsModule,RoadsModule,WeatherModule,EnergyModule, SecurityModule],
  controllers: [AppController],
})
export class AppModule {}
