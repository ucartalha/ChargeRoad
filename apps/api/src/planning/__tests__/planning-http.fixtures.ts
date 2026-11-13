import {planningApiRequestSchema} from '@chargeroad/shared';
import type {PlanningApiRequest} from '@chargeroad/shared';
import {optimizerWorld} from './optimizer.fixtures';
export function httpPlanningWorld(){
  const w=optimizerWorld(),id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  w.request.vehicleVariantId=w.vehicle.vehicleVariantId=id;w.vehicle.energyModel!.vehicleVariantId=id;w.vehicle.chargingModel!.vehicleVariantId=id;
  w.vehicle.consumptionReferences.forEach(r=>r.vehicleVariantId=id);w.vehicle.dcChargingCurves.forEach(c=>c.vehicleVariantId=id);
  const body:PlanningApiRequest=planningApiRequestSchema.parse({schemaVersion:'1.0.0',requestId:w.request.requestId,origin:w.request.origin,destination:w.request.destination,
    vehicleVariantId:id,departureAt:w.request.departureAt,startingChargePercent:w.request.startingChargePercent,startingChargeObservedAt:w.request.startingChargeObservedAt,
    constraints:w.request.constraints,objective:w.request.policy.objective,vehicleDataQuality:'allow_engineering_estimates',initialBatteryTemperatureC:w.request.initialBatteryTemperatureC,
    stateOfHealthPercent:w.request.stateOfHealthPercent,operatingConditions:w.request.operatingConditions});
  return {...w,body};
}
