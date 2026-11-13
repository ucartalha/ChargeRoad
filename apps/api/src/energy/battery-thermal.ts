import type {EnergyModel} from '@chargeroad/shared';
import {EnergyDataMissing} from './energy-policy';

/** Exact first-order RC step with bounded automatic control, no inferred preconditioning completion. */
export function batteryThermalStep(model:EnergyModel,temperature:number|null,ambient:number,hours:number){
  const mass=model.passiveThermal,control=model.automaticBatteryThermal;
  if(!control)return {energyKwh:model.batteryThermalKw*hours,temperatureC:temperature!==null&&mass&&model.batteryThermalKw===0?
    ambient+(temperature-ambient)*Math.exp(-mass.conductanceKwPerC*hours/mass.heatCapacityKwhPerC):null};
  if(temperature===null||!mass)throw new EnergyDataMissing('ACTIVE_THERMAL_INITIAL_BATTERY_TEMPERATURE_MISSING');
  const k=mass.conductanceKwPerC,c=mass.heatCapacityKwhPerC,decay=Math.exp(-k*hours/c),passive=ambient+(temperature-ambient)*decay;
  const target=Math.max(control.controlBandC.min,Math.min(control.controlBandC.max,passive));
  // expm1 keeps the solution stable for tiny conductance/time steps.
  const response=k===0?hours/c:-Math.expm1(-k*hours/c)/k;
  const required=(target-passive)/response;
  const thermalKw=Math.max(-control.maxCoolingElectricalKw*control.coolingCop,Math.min(control.maxHeatingElectricalKw*control.heatingCop,required));
  const electricalKw=thermalKw>=0?thermalKw/control.heatingCop:-thermalKw/control.coolingCop;
  return {energyKwh:electricalKw*hours,temperatureC:passive+thermalKw*response};
}
