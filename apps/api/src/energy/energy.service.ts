import {Injectable} from '@nestjs/common';
import {routePlanRequestSchema,roadRouteSchema,vehicleEnergyProfileSchema} from '@chargeroad/shared';
import type {RoutePlanRequest,RoadRoute,EnergyEvaluationResult} from '@chargeroad/shared';
import {VehicleEnergyProvider} from '../providers/vehicle-energy-provider';
import {WeatherService} from '../weather/weather.service';
import {EnergyConsumptionEngine} from './energy-engine';

@Injectable()
export class EnergyAssessmentService {
  constructor(private readonly vehicles:VehicleEnergyProvider,private readonly weather:WeatherService,private readonly engine:EnergyConsumptionEngine){}
  async assess(rawRequest:RoutePlanRequest,rawRoute:RoadRoute,signal:AbortSignal){
    signal.throwIfAborted();const request=routePlanRequestSchema.parse(rawRequest),route=roadRouteSchema.parse(rawRoute);
    const id=this.vehicles.resolveId?await this.vehicles.resolveId(request.vehicleVariantId,signal):request.vehicleVariantId;
    const canonicalRequest={...request,vehicleVariantId:id};
    const profile=await this.vehicles.profile(id,signal,request.policy.vehicleDataQuality??'verified_only');
    signal.throwIfAborted();
    const missing=(code:string)=>({status:'insufficient_data' as const,route,energy:null as EnergyEvaluationResult|null,reasons:[code]});
    if(!profile.data)return missing('VEHICLE_ENERGY_PROFILE_MISSING');
    vehicleEnergyProfileSchema.parse(profile.data);
    if(profile.data.vehicleVariantId!==id)throw new Error('Energy profile identity mismatch');
    if(!profile.data.energyModel)return missing('ENERGY_CALIBRATION_MISSING');
    if(request.policy.vehicleDataQuality!=='allow_engineering_estimates'&&
      (profile.data.energyModel.quality==='engineering_estimate'||profile.data.dataQuality?.quality==='engineering_estimate'))
      return missing('ENGINEERING_ESTIMATE_NOT_ALLOWED');
    const climate=await this.weather.forRoute({route,departureAt:request.departureAt,stops:[]},signal);
    if(climate.status!=='weather_ready')return missing(climate.reasons.join('|')||'WEATHER_NOT_READY');
    const energy=await this.engine.evaluate({request:canonicalRequest,vehicle:profile.data,route,weather:climate.forecasts,evaluatedAt:new Date().toISOString()},signal);
    return {status:energy.status,route,energy,reasons:energy.reasons.map(r=>r.code),vehicleSource:profile.source};
  }
}
