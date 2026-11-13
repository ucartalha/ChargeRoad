import {Module} from '@nestjs/common';
import {VehiclesModule} from '../vehicles/vehicles.module';
import {StationsModule} from '../stations/stations.module';
import {RoadsModule} from '../roads/roads.module';
import {WeatherModule} from '../weather/weather.module';
import {EnergyModule} from '../energy/energy.module';
import {ChargingModule} from '../charging/charging.module';
import {ChargeStopOptimizer} from './charge-stop-optimizer';
import {EvPlanningService} from './ev-planning.service';
@Module({imports:[VehiclesModule,StationsModule,RoadsModule,WeatherModule,EnergyModule,ChargingModule],providers:[
  {provide:ChargeStopOptimizer,useFactory:()=>new ChargeStopOptimizer()},EvPlanningService],exports:[EvPlanningService,ChargeStopOptimizer]})
export class EvPlanningModule {}
