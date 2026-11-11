import type {ConsumptionReference,EnergyModel,VehicleEnergyProfile} from '@chargeroad/shared';
import {EnergyDataMissing} from './energy-policy';

interface Selection {rate:number;ids:string[];referencePayload:number;includedCabinKw:number;includedThermalKw:number;}
function rate(reference:ConsumptionReference){
  if(!reference.source.license)return null;
  if(reference.energyBoundary==='battery_dc')return reference.valueKwhPer100Km;
  if(reference.energyBoundary==='ac_grid'&&reference.batteryDcConversion?.source.license)return reference.valueKwhPer100Km*reference.batteryDcConversion.gridToBatteryEfficiency;
  return null;
}
export function selectReference(vehicle:VehicleEnergyProfile,model:EnergyModel,speed:number,temperature:number,batteryTemperature:number|null):Selection{
  const groups=new Map<string,ConsumptionReference[]>();
  for(const r of vehicle.consumptionReferences){
    const c=r.conditions,e=r.includedEffects;
    if(r.testCycle!=='constant_speed'||rate(r)===null||(e.chargingLosses==='included'&&r.energyBoundary!=='ac_grid')||!c.meanSpeedKph||c.windSpeedKph!==0||c.elevationGainMetersPer100Km!==0||c.payloadKg===null||
      !c.ambientTemperatureC||temperature<c.ambientTemperatureC.min||temperature>c.ambientTemperatureC.max||
      (c.batteryTemperatureC&&(batteryTemperature===null||batteryTemperature<c.batteryTemperatureC.min||batteryTemperature>c.batteryTemperatureC.max))||
      e.cabinHvac==='unknown'||e.batteryThermalManagement==='unknown'||e.elevation==='unknown'||e.wind==='unknown'||
      c.tireDescription!==model.referenceTireDescription)continue;
    if(e.cabinHvac==='included'&&model.referenceCabinKw===null||e.batteryThermalManagement==='included'&&model.referenceBatteryThermalKw===null)continue;
    const key=JSON.stringify({conditions:{...c,meanSpeedKph:null},effects:e,boundary:r.energyBoundary,
      conversion:r.batteryDcConversion?.gridToBatteryEfficiency??null});
    const group=groups.get(key)??[];group.push(r);groups.set(key,group);
  }
  // Prefer measured references, then narrower speed support. IDs break ties reproducibly.
  const options:{selection:Selection;score:number;span:number;key:string}[]=[];
  for(const group of groups.values()){
    group.sort((a,b)=>a.conditions.meanSpeedKph!-b.conditions.meanSpeedKph!||(a.id<b.id?-1:a.id>b.id?1:0));
    // Conflicting repeated measurements must be reconciled upstream, not silently averaged.
    if(group.some((r,i)=>i>0&&r.conditions.meanSpeedKph===group[i-1].conditions.meanSpeedKph))continue;
    const upper=group.findIndex(r=>r.conditions.meanSpeedKph!>=speed-1e-6);if(upper<0)continue;
    const exact=Math.abs(group[upper].conditions.meanSpeedKph!-speed)<1e-6;
    if(!exact&&upper===0)continue;
    const a=group[exact?upper:upper-1],b=group[upper];
    const f=exact?0:(speed-a.conditions.meanSpeedKph!)/(b.conditions.meanSpeedKph!-a.conditions.meanSpeedKph!);
    const selection={rate:rate(a)!+(rate(b)!-rate(a)!)*f,ids:exact?[a.id]:[a.id,b.id],referencePayload:a.conditions.payloadKg!,
      includedCabinKw:a.includedEffects.cabinHvac==='included'?model.referenceCabinKw!:0,
      includedThermalKw:a.includedEffects.batteryThermalManagement==='included'?model.referenceBatteryThermalKw!:0};
    options.push({selection,score:[a,b].filter(r=>r.basis==='measured').length,span:b.conditions.meanSpeedKph!-a.conditions.meanSpeedKph!,key:selection.ids.join('|')});
  }
  options.sort((a,b)=>b.score-a.score||a.span-b.span||(a.key<b.key?-1:a.key>b.key?1:0));
  if(!options.length)throw new EnergyDataMissing('CONDITION_MATCHED_SPEED_REFERENCE_MISSING');return options[0].selection;
}
