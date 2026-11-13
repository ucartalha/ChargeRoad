import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { VehiclesModule } from './vehicles/vehicles.module';
import { SecurityModule } from './security/security.module';
import { StationsModule } from './stations/stations.module';
import { RoadsModule } from './roads/roads.module';
import { WeatherModule } from './weather/weather.module';
import { EnergyModule } from './energy/energy.module';
import { ChargingModule } from './charging/charging.module';
import { EvPlanningModule } from './planning/ev-planning.module';
import { PlanningHttpModule } from './planning/http/planning-http.module';
import {LocationsModule} from './locations/locations.module';
import {DatabaseModule} from './database/database.module';

@Module({
  imports: [DatabaseModule,VehiclesModule,StationsModule,RoadsModule,WeatherModule,EnergyModule,ChargingModule,EvPlanningModule,PlanningHttpModule,LocationsModule, SecurityModule],
  controllers: [AppController],
})
export class AppModule {}
