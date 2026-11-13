import {ChargingCurveEngine} from '../charging-engine';
import {chargingFixture} from './fixtures';
function input(){const r=chargingFixture(),e=r.station.evses[0];e.identityBasis='catalogue_scenario';
  const c=e.connectors[0];if(c.powerType!=='dc')throw new Error('Fixture');c.maxPowerKw=50;c.maxCurrentA=null;c.outputVoltageRangeV=null;return r;}
describe('Explicit catalogue charging scenario',()=>{
  it('requires an explicit hardware policy even with an estimated vehicle profile',async()=>{
    const r=input(),result=await new ChargingCurveEngine().evaluate(r);
    expect(result.status).toBe('insufficient_data');expect(result.reasons).toContain('CATALOGUE_HARDWARE_SCENARIO_NOT_ALLOWED');
  });
  it('integrates the known power cap without fabricated current/voltage and marks conditional assumptions',async()=>{
    const r=input();r.hardwarePolicy='catalogue_power_scenario';const result=await new ChargingCurveEngine().evaluate(r);
    expect(result.status).toBe('estimated');expect(result.dataQuality).toBe('engineering_estimate');
    expect(result.chargingSeconds).toBeCloseTo(48/50*3600,5);
    expect(result.assumptions).toContain('selected_vehicle_voltage_path_assumed_available');
    expect(r.station.evses[0].connectors[0]).toMatchObject({maxCurrentA:null,outputVoltageRangeV:null});
  });
  it('still rejects a known voltage incompatibility and an ordinary incomplete physical EVSE',async()=>{
    const r=input();r.hardwarePolicy='catalogue_power_scenario';const c=r.station.evses[0].connectors[0];
    if(c.powerType==='dc')c.outputVoltageRangeV={min:200,max:300};
    expect((await new ChargingCurveEngine().evaluate(r)).status).toBe('incompatible');
    const physical=input();delete physical.station.evses[0].identityBasis;physical.hardwarePolicy='catalogue_power_scenario';
    expect((await new ChargingCurveEngine().evaluate(physical)).reasons).toContain('DC_HARDWARE_LIMITS_MISSING');
  });
});
