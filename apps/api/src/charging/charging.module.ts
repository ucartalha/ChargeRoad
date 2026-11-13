import {Module} from '@nestjs/common';
import {VehiclesModule} from '../vehicles/vehicles.module';
import {ChargingCurveEngine} from './charging-engine';
import {ChargingAssessmentService} from './charging.service';
@Module({imports:[VehiclesModule],providers:[{provide:ChargingCurveEngine,useFactory:()=>new ChargingCurveEngine()},ChargingAssessmentService],
  exports:[ChargingCurveEngine,ChargingAssessmentService]})
export class ChargingModule {}
