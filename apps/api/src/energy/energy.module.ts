import {Module} from '@nestjs/common';
import {VehiclesModule} from '../vehicles/vehicles.module';
import {WeatherModule} from '../weather/weather.module';
import {EnergyConsumptionEngine} from './energy-engine';
import {EnergyAssessmentService} from './energy.service';

@Module({imports:[VehiclesModule,WeatherModule],providers:[{provide:EnergyConsumptionEngine,useFactory:()=>new EnergyConsumptionEngine()},EnergyAssessmentService],
  exports:[EnergyConsumptionEngine,EnergyAssessmentService]})
export class EnergyModule {}
