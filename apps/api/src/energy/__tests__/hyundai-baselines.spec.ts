import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseKnowledgePackage} from '../../vehicles/knowledge/knowledge-package';
import {EnergyConsumptionEngine} from '../energy-engine';
import {energyFixture} from './fixtures';
import {ChargingCurveEngine} from '../../charging/charging-engine';
import {chargingFixture} from '../../charging/__tests__/fixtures';
const packet=parseKnowledgePackage(readFileSync(resolve(__dirname,'../../../../../data/vehicle-knowledge/hyundai/engineering-v1.json'))).data;
describe('Published Hyundai engineering baselines (not independent field validation)',()=>{
  it('covers each distinct canonical variant with labelled and dimensionally sensible speed/temperature references',()=>{
    expect(packet.records).toHaveLength(26);expect(new Set(packet.records.map(r=>r.matchedEntityId)).size).toBe(26);
    for(const r of packet.records){expect(r.profiles[0].policy).toBe('allow_engineering_estimates');expect(r.profiles[0].evidence.quality).toBe('engineering_estimate');
      for(const temperature of [-25,9.9995,10,19.9995,20,45])expect(r.charging.some(c=>c.curve.conditions.batteryTemperatureC!.min<=temperature&&c.curve.conditions.batteryTemperatureC!.max>=temperature)).toBe(true);
      expect(r.consumption).toHaveLength(21);for(const c of r.consumption){expect(c.reference.basis).toBe('derived');expect(c.reference.valueKwhPer100Km).toBeGreaterThan(4);expect(c.reference.valueKwhPer100Km).toBeLessThan(60);}
      const mild=r.consumption.filter(c=>c.reference.conditions.ambientTemperatureC?.min===20);
      expect(mild.find(c=>c.reference.conditions.meanSpeedKph===130)!.reference.valueKwhPer100Km).toBeGreaterThan(mild.find(c=>c.reference.conditions.meanSpeedKph===90)!.reference.valueKwhPer100Km);
    }
  });
  it.each(packet.records.map(r=>[r.configuration.model+' '+r.configuration.modelYear+' '+r.configuration.trim,r] as const))('computes %s with explicit unknown-observation fallbacks',async(_label,r)=>{
    const input=energyFixture();input.vehicle=structuredClone(r.profiles[0].profile);input.request.vehicleVariantId=input.vehicle.vehicleVariantId;
    input.request.initialBatteryTemperatureC={origin:'unknown',value:null};input.request.stateOfHealthPercent={origin:'unknown',value:null};
    input.request.operatingConditions={payloadKg:{origin:'unknown',value:null},cabinTargetTemperatureC:{origin:'unknown',value:null},hvacMode:'unknown',batteryPreconditioning:'unknown',tireSetupId:null};
    const result=await new EnergyConsumptionEngine().evaluate(input,new AbortController().signal);expect(result.reasons).toEqual([]);expect(result.status).toBe('estimated');
    expect(result.assumptions).toContain('initial_battery_temperature_modelled_at_ambient_equilibrium');
    expect(result.segments[0].batteryTemperatureAtEndC.origin).toBe('estimated');
    expect(result.netBatteryEnergyKwh).toBeGreaterThan(.03);expect(result.netBatteryEnergyKwh).toBeLessThan(.8);
  });
  it('keeps thermal fallbacks opt-in and preserves verified-only rejection',async()=>{
    const input=energyFixture();input.vehicle=structuredClone(packet.records[0].profiles[0].profile);input.request.vehicleVariantId=input.vehicle.vehicleVariantId;
    input.request.policy.vehicleDataQuality='verified_only';const result=await new EnergyConsumptionEngine().evaluate(input,new AbortController().signal);expect(result.status).toBe('insufficient_data');
    expect(result.reasons.some(r=>r.code==='ENGINEERING_ESTIMATE_NOT_ALLOWED')).toBe(true);
  });
  it.each(packet.records.map(r=>[r.configuration.model+' '+r.configuration.modelYear+' '+r.configuration.trim,r] as const))('integrates %s charging with cold/mild behaviour and physical hardware limits',async(_label,r)=>{
    const input=chargingFixture(),vehicle=structuredClone(r.profiles[0].profile);input.vehicle=vehicle;
    const capacity=vehicle.capacity.referenceUsableBatteryKwh;input.capacity={...input.capacity,vehicleProfileId:vehicle.id,vehicleProfileVersion:vehicle.version,vehicleVariantId:vehicle.vehicleVariantId,
      referenceUsableKwh:capacity,referenceSohPercent:100,sohPercent:95,effectiveKwh:capacity*.95};
    input.curveId=vehicle.dcChargingCurves.find(c=>c.id.endsWith('mild'))!.id;
    const warm=await new ChargingCurveEngine().evaluate(input);expect(warm.reasons).toEqual([]);expect(warm.status).toBe('estimated');
    input.batteryTemperatureAtStartC={origin:'user_input',value:0,observedAt:input.evaluatedAt};input.curveId=vehicle.dcChargingCurves.find(c=>c.id.endsWith('cold'))!.id;
    const cold=await new ChargingCurveEngine().evaluate(input);expect(cold.status).toBe('estimated');expect(cold.chargingSeconds!).toBeGreaterThan(warm.chargingSeconds!);
    expect(warm.energyDeliveredAtInletKwh!).toBeGreaterThan(warm.energyStoredKwh!);
  });
});
