import {energyModelSchema} from '@chargeroad/shared';
import {modelFixture,energyFixture} from './fixtures';
import {batteryThermalStep} from '../battery-thermal';
import {EnergyConsumptionEngine} from '../energy-engine';
function model(){const m=modelFixture();m.passiveThermal={heatCapacityKwhPerC:1,conductanceKwPerC:0};
  m.automaticBatteryThermal={controlBandC:{min:20,max:30},maxHeatingElectricalKw:10,maxCoolingElectricalKw:10,heatingCop:2,coolingCop:2};return m;}
describe('Source-calibrated automatic battery thermal control',()=>{
  it('accounts for cold-start energy without exceeding heater power',()=>{
    const step=batteryThermalStep(model(),0,0,.5);expect(step.energyKwh).toBe(5);expect(step.temperatureC).toBe(10);
  });
  it('stops at the control band instead of heating beyond the target',()=>{
    const step=batteryThermalStep(model(),19,0,1);expect(step.energyKwh).toBeCloseTo(.5,12);expect(step.temperatureC).toBe(20);
  });
  it('handles cooling with positive electrical consumption',()=>{
    const step=batteryThermalStep(model(),35,35,1);expect(step.energyKwh).toBeCloseTo(2.5,12);expect(step.temperatureC).toBe(30);
  });
  it('integrates ambient heat loss using the RC solution',()=>{
    const m=model();m.passiveThermal!.conductanceKwPerC=1;m.automaticBatteryThermal!.maxHeatingElectricalKw=0;
    const step=batteryThermalStep(m,20,0,1);expect(step.temperatureC).toBeCloseTo(20/Math.E,12);expect(step.energyKwh).toBe(0);
  });
  it('requires actual initial temperature and never replaces it with ambient',()=>{
    expect(()=>batteryThermalStep(model(),null,-7,1)).toThrow('ACTIVE_THERMAL_INITIAL_BATTERY_TEMPERATURE_MISSING');
  });
  it('forbids double-counting a fixed thermal load and requires a thermal mass model',()=>{
    const m=model();m.batteryThermalKw=2;expect(()=>energyModelSchema.parse(m)).toThrow();
    m.batteryThermalKw=0;m.passiveThermal=null;expect(()=>energyModelSchema.parse(m)).toThrow();
  });
  it('distinguishes a warm and cold battery at the same outdoor temperature without fitting a vehicle',async()=>{
    const cold=energyFixture();cold.vehicle.energyModel=model();cold.weather[0].temperatureCelsius=-7;
    cold.request.initialBatteryTemperatureC={origin:'user_input',value:0,observedAt:cold.evaluatedAt};
    const warm=structuredClone(cold);warm.request.initialBatteryTemperatureC.value=25;
    const engine=new EnergyConsumptionEngine(),a=await engine.evaluate(cold,new AbortController().signal),b=await engine.evaluate(warm,new AbortController().signal);
    expect(a.status).toBe('estimated');expect(b.status).toBe('estimated');expect(a.netBatteryEnergyKwh-b.netBatteryEnergyKwh).toBeCloseTo(10/60,9);
    expect(a.audit[0].batteryThermalKwh).toBeCloseTo(10/60,9);expect(b.audit[0].batteryThermalKwh).toBe(0);
    expect(a.capacityKwh).toBe(b.capacityKwh); // heating never creates extra usable SOC energy
  });
});
