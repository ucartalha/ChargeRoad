import {Injectable} from '@nestjs/common';
import type {ChargingEvaluationRequest} from '@chargeroad/shared';
import {VehicleEnergyProvider} from '../providers/vehicle-energy-provider';
import {ChargingCurveEngine} from './charging-engine';

export type ChargingAssessmentRequest=Omit<ChargingEvaluationRequest,'vehicle'> & {vehicleVariantId:string};
@Injectable()
export class ChargingAssessmentService {
  constructor(private readonly vehicles:VehicleEnergyProvider,private readonly engine:ChargingCurveEngine){}
  async assess(request:ChargingAssessmentRequest,signal:AbortSignal){
    signal.throwIfAborted();const deadline=AbortSignal.timeout(2000),bounded=AbortSignal.any([signal,deadline]);
    try{
      const id=await this.vehicles.resolveId(request.vehicleVariantId,bounded);
      const profile=await this.vehicles.profile(id,bounded,request.qualityPolicy);bounded.throwIfAborted();
      if(!profile.data)return {status:'insufficient_data' as const,charging:null,reasons:['VEHICLE_CHARGING_PROFILE_MISSING']};
      if(profile.data.vehicleVariantId!==id)throw new Error('Charging profile identity mismatch');
      const {vehicleVariantId:_,...input}=request;
      const charging=await this.engine.evaluate({...input,vehicle:profile.data},bounded);
      return {status:charging.status,charging,reasons:charging.reasons,vehicleSource:profile.source};
    }catch(error){if(signal.aborted)throw signal.reason;
      if(deadline.aborted)return {status:'computation_limit' as const,charging:null,reasons:['CHARGING_ASSESSMENT_DEADLINE']};throw error;}
  }
}
