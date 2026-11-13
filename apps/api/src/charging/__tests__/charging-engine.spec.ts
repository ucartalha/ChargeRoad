import {chargingEvaluationRequestSchema,chargingEvaluationResultSchema} from '@chargeroad/shared';
import {ChargingCurveEngine} from '../charging-engine';
import {crossings} from '../charging-math';
import {chargingFixture} from './fixtures';
import {energyFixture} from '../../energy/__tests__/fixtures';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {detailedChargingCase} from '../validation/charging-cases';
const engine=new ChargingCurveEngine();
describe('DC charging integration and energy accounting',()=>{
  it('integrates constant 100 kW: 80 kWh × 60% / 100 = 1728 seconds',async()=>{
    const r=await engine.evaluate(chargingFixture());expect(r.status).toBe('estimated');expect(r.chargingSeconds).toBeCloseTo(1728,8);
    expect(r.dataQuality).toBe('engineering_estimate');expect(r.energyStoredKwh).toBe(48);expect(r.energyDeliveredAtInletKwh).toBeCloseTo(48,9);expect(r.totalStopSeconds).toBeCloseTo(1788,8);
    expect(r.batteryTemperatureAtDepartureC.value).toBeNull();expect(r.inputChecksumSha256).toHaveLength(64);
  });
  it('integrates taper analytically rather than using the maximum power',async()=>{
    const f=chargingFixture(),curve=f.vehicle.dcChargingCurves[0];
    curve.curve={representation:'power_by_soc',points:[{socPercent:20,powerKw:100,voltageV:400,batteryTemperatureC:null},{socPercent:80,powerKw:50,voltageV:400,batteryTemperatureC:null}]};
    const r=await engine.evaluate(f);expect(r.status).toBe('estimated');expect(r.chargingSeconds).toBeCloseTo(80/100*60/50*Math.log(2)*3600,5);
    expect(r.chargingSeconds!).toBeGreaterThan(1728);expect(r.energyDeliveredAtInletKwh).toBeCloseTo(48,7);
  });
  it('splits a station/vehicle bottleneck crossover exactly',async()=>{
    const f=chargingFixture(),c=f.vehicle.dcChargingCurves[0];
    c.curve={representation:'power_by_soc',points:[{socPercent:20,powerKw:120,voltageV:400,batteryTemperatureC:null},{socPercent:80,powerKw:60,voltageV:400,batteryTemperatureC:null}]};
    f.station.evses[0].connectors[0].maxPowerKw=90;
    const r=await engine.evaluate(f);expect(r.status).toBe('estimated');
    expect(r.chargingSeconds).toBeCloseTo((24/90+.8*Math.log(90/60))*3600,5);
    expect(r.intervals.map(x=>x.limiter)).toEqual(['connector_power','vehicle_curve']);
  });
  it('accounts for converter, pack storage loss and thermal auxiliaries separately',async()=>{
    const f=chargingFixture();f.vehicle.dcChargingPaths[0].conversionEfficiency=.9;f.vehicle.chargingModel!.terminalToStoredEfficiency=.95;f.vehicle.chargingModel!.auxiliaryPackKw=2;
    const r=await engine.evaluate(f),hours=48/((100*.9-2)*.95);expect(r.status).toBe('estimated');expect(r.chargingSeconds).toBeCloseTo(hours*3600,6);
    expect(r.energyDeliveredAtInletKwh).toBeCloseTo(100*hours,8);expect(r.auxiliaryEnergyKwh).toBeCloseTo(2*hours,8);
    expect(r.conversionLossKwh).toBeCloseTo((10+88*.05)*hours,8);
  });
  it('does not subtract losses twice from a net-stored curve',async()=>{
    const f=chargingFixture(),curve=f.vehicle.dcChargingCurves[0];curve.powerBoundary='battery_stored';
    curve.conditions.thermalAuxiliariesIncluded=curve.conditions.conversionLossesIncluded='included';
    f.vehicle.dcChargingPaths[0].conversionEfficiency=.9;f.vehicle.chargingModel!.terminalToStoredEfficiency=.95;f.vehicle.chargingModel!.auxiliaryPackKw=2;
    f.vehicle.dcChargingPaths[0].inletVoltageBySoc={id:'inlet',voltageBoundary:'charging_inlet',points:[{socPercent:0,voltageV:400},{socPercent:100,voltageV:400}],batteryTemperatureC:null,source:curve.source};
    const r=await engine.evaluate(f);expect(r.status).toBe('estimated');expect(r.chargingSeconds).toBeCloseTo(1728,7);
    expect(r.energyDeliveredAtInletKwh).toBeCloseTo((100/.95+2)/.9*.48,7);
    f.station.evses[0].connectors[0].maxPowerKw=80;const limited=await engine.evaluate(f);
    expect(limited.chargingSeconds).toBeCloseTo(48/((80*.9-2)*.95)*3600,6);
  });
  it('handles a terminal curve with losses and uses inlet voltage rather than pack voltage',async()=>{
    const f=chargingFixture(),curve=f.vehicle.dcChargingCurves[0],path=f.vehicle.dcChargingPaths[0];
    curve.powerBoundary='pack_terminal';curve.conditions.thermalAuxiliariesIncluded=curve.conditions.conversionLossesIncluded='included';
    curve.curve={representation:'current_by_soc',points:[{socPercent:0,currentA:125,voltageV:800,batteryTemperatureC:null},{socPercent:100,currentA:125,voltageV:800,batteryTemperatureC:null}]};
    path.mode='boost_converter';path.conversionEfficiency=.9;path.inletVoltageBySoc={id:'boost-voltage',voltageBoundary:'charging_inlet',source:path.source,batteryTemperatureC:null,
      points:[{socPercent:0,voltageV:400},{socPercent:100,voltageV:400}]};
    f.vehicle.chargingModel!.terminalToStoredEfficiency=.95;f.vehicle.chargingModel!.auxiliaryPackKw=2;
    const dc=f.station.evses[0].connectors[0];if(dc.powerType!=='dc')throw new Error();dc.maxCurrentA=250;
    const r=await engine.evaluate(f);expect(r.status).toBe('estimated');expect(r.chargingSeconds).toBeCloseTo(48/((100*.9-2)*.95)*3600,6);
  });
  it('integrates a current × varying inlet-voltage curve',async()=>{
    const f=chargingFixture();f.vehicle.dcChargingCurves[0].curve={representation:'current_by_soc',points:[
      {socPercent:20,currentA:200,voltageV:300,batteryTemperatureC:null},{socPercent:80,currentA:200,voltageV:600,batteryTemperatureC:null}]};
    const r=await engine.evaluate(f);expect(r.status).toBe('estimated');expect(r.chargingSeconds).toBeCloseTo(.8*Math.log(2)*3600,5);
  });
  it('uses a declared voltage power envelope and never sums two sockets',async()=>{
    const f=chargingFixture(),dc=f.station.evses[0].connectors[0];if(dc.powerType!=='dc')throw new Error();
    dc.powerEnvelopeInterpolation='linear';dc.powerEnvelope=[{voltageV:300,maxCurrentA:100,maxPowerKw:150},{voltageV:500,maxCurrentA:100,maxPowerKw:150}];
    f.station.evses[0].connectors.push({...structuredClone(dc),id:'unused-socket',maxPowerKw:300});
    const r=await engine.evaluate(f);expect(r.status).toBe('estimated');expect(r.chargingSeconds).toBeCloseTo(48/40*3600,6);
  });
  it('applies an explicit shared allocation instead of all pool capacity',async()=>{
    const f=chargingFixture();f.station.evses[0].sharedPowerPoolId='pool';f.station.sharedPowerPools=[{id:'pool',ratedTotalPowerKw:300,availablePowerKw:{origin:'unknown',value:null}}];
    expect((await engine.evaluate(f)).reasons).toContain('SHARED_POWER_ALLOCATION_MISSING');
    f.sharedPowerAllocation={poolId:'pool',powerKw:50,observedAt:f.evaluatedAt,sourceId:'scheduler'};
    const r=await engine.evaluate(f);expect(r.chargingSeconds).toBeCloseTo(3456,6);
    f.sharedPowerAllocation.powerKw=0;expect((await engine.evaluate(f)).status).toBe('unreachable');
    f.sharedPowerAllocation.observedAt='2026-11-09T00:00:00Z';expect((await engine.evaluate(f)).reasons).toContain('SHARED_POWER_ALLOCATION_STALE');
  });
  it('consumes the Task 11 capacity snapshot without applying SOH twice',async()=>{
    const input=energyFixture();input.request.stateOfHealthPercent={origin:'user_input',value:90,observedAt:input.evaluatedAt};
    input.vehicle.energyModel!.capacityTemperatureCurve=[{temperatureC:0,factor:.8},{temperatureC:30,factor:.8}];
    const energy=await new EnergyConsumptionEngine().evaluate(input,new AbortController().signal);expect(energy.status).toBe('estimated');
    const f=chargingFixture();f.vehicle.energyModel=input.vehicle.energyModel;f.capacity=energy.capacitySnapshot!;
    const r=await engine.evaluate(f);expect(r.status).toBe('estimated');expect(r.effectiveBatteryCapacityKwh).toBeCloseTo(57.6,9);
    expect(r.chargingSeconds).toBeCloseTo(57.6*.6/100*3600,6);
  });
  it('does not fabricate waiting time or departure temperature',async()=>{
    const f=chargingFixture();f.timing.waitingSeconds=null;const r=await engine.evaluate(f);
    expect(r.status).toBe('estimated');expect(r.totalStopSeconds).toBeNull();expect(r.departureAt).toBeNull();expect(r.batteryTemperatureAtDepartureC.origin).toBe('unknown');
  });
  it('returns zero for equal SOC and rejects a descending target',async()=>{
    const f=chargingFixture();f.targetSocPercent=f.arrivalSocPercent;expect((await engine.evaluate(f)).status).toBe('no_charge_required');
    f.targetSocPercent=10;expect(()=>chargingEvaluationRequestSchema.parse(f)).toThrow();
  });
  it('detects zero net charging and a zero-power 100% endpoint',async()=>{
    const f=chargingFixture();f.vehicle.chargingModel!.auxiliaryPackKw=100;expect((await engine.evaluate(f)).status).toBe('unreachable');
    f.vehicle.chargingModel!.auxiliaryPackKw=0;f.targetSocPercent=100;
    const curve=f.vehicle.dcChargingCurves[0].curve;if(curve.representation!=='power_by_soc')throw new Error();curve.points[1].powerKw=0;
    const r=await engine.evaluate(f);expect(r.status).toBe('unreachable');expect(r.chargingSeconds).toBeNull();
  });
  it.each(['unknown_temperature','cold','hot','stale_temperature','future_temperature','missing_efficiency','missing_current','missing_model','missing_curve','outside_soc','ambiguous_effects','observed_session','wrong_capacity','quality','missing_license','voltage','unknown_voltage','envelope','preconditioning'] as const)('rejects unsupported input: %s',async kind=>{
    const f=chargingFixture(),curve=f.vehicle.dcChargingCurves[0],path=f.vehicle.dcChargingPaths[0],dc=f.station.evses[0].connectors[0];
    switch(kind){
      case 'unknown_temperature':f.batteryTemperatureAtStartC={origin:'unknown',value:null};break;
      case 'cold':f.batteryTemperatureAtStartC.value=-10;break;
      case 'hot':f.batteryTemperatureAtStartC.value=55;break;
      case 'stale_temperature':f.batteryTemperatureAtStartC={origin:'user_input',value:30,observedAt:'2026-11-09T00:00:00Z'};break;
      case 'future_temperature':f.batteryTemperatureAtStartC={origin:'estimated',value:30,estimatedAt:'2026-11-11T00:00:00Z',validAt:f.evaluatedAt,modelVersion:'not-proof'};break;
      case 'missing_efficiency':path.conversionEfficiency=null;break;
      case 'missing_current':if(dc.powerType==='dc')dc.maxCurrentA=null;break;
      case 'missing_model':delete f.vehicle.chargingModel;break;
      case 'missing_curve':f.vehicle.dcChargingCurves=[];break;
      case 'outside_soc':curve.curve.points[0].socPercent=30;break;
      case 'ambiguous_effects':curve.conditions.conversionLossesIncluded='unknown';break;
      case 'observed_session':curve.semantics='observed_station_session';break;
      case 'wrong_capacity':f.capacity.vehicleProfileVersion='another';break;
      case 'quality':f.qualityPolicy='verified_only';break;
      case 'missing_license':curve.source={...curve.source,license:null};break;
      case 'voltage':if(dc.powerType==='dc')dc.outputVoltageRangeV={min:500,max:1000};break;
      case 'unknown_voltage':curve.curve.points.forEach(p=>p.voltageV=null!);break;
      case 'envelope':if(dc.powerType==='dc')dc.powerEnvelope=[{voltageV:300,maxCurrentA:100,maxPowerKw:100}];break;
      case 'preconditioning':curve.conditions.preconditioning='completed';f.preconditioning='active';break;
    }
    const r=await engine.evaluate(f);expect(['insufficient_data','incompatible']).toContain(r.status);expect(r.chargingSeconds).toBeNull();expect(r.reasons.length).toBeGreaterThan(0);
  });
  it('requires a separate AC model',async()=>{
    const f=chargingFixture();f.station.evses[0].connectors[0]={id:'connector',powerType:'ac',standard:'type2',maxPowerKw:11,phases:3,voltageV:230,maxCurrentA:16,source:f.station.source};
    expect((await engine.evaluate(f)).reasons).toContain('AC_REQUIRES_SEPARATE_CHARGING_MODEL');
  });
  it('honors cancellation and produces deterministic replay',async()=>{
    const f=chargingFixture(),abort=new AbortController();abort.abort(new Error('caller cancelled'));
    await expect(engine.evaluate(f,abort.signal)).rejects.toThrow('caller cancelled');
    expect(await engine.evaluate(f)).toEqual(await engine.evaluate(structuredClone(f)));
  });
  it('rejects an unbalanced published ledger',async()=>{
    const r=await engine.evaluate(chargingFixture());r.energyDeliveredAtInletKwh!+=1;expect(()=>chargingEvaluationResultSchema.parse(r)).toThrow();
  });
  it('finds close crossings that ordinary fixed SOC sampling would miss',()=>{
    const roots=crossings(t=>[100,100+(t-.499)*(t-.501)],0,1);
    expect(roots.some(x=>Math.abs(x-.499)<1e-8)).toBe(true);expect(roots.some(x=>Math.abs(x-.501)<1e-8)).toBe(true);
  });
  it('does not treat current measured temperature as a future arrival prediction when waiting is unknown',async()=>{
    const f=chargingFixture();f.timing.arrivalAt='2026-11-10T10:00:00+03:00';f.timing.waitingSeconds=null;
    expect((await engine.evaluate(f)).reasons).toContain('CHARGE_START_TEMPERATURE_NOT_VALID');
    f.batteryTemperatureAtStartC={origin:'estimated',value:30,estimatedAt:f.evaluatedAt,validAt:'2026-11-10T10:01:00+03:00',modelVersion:'explicit-scenario'};
    const r=await engine.evaluate(f);expect(r.status).toBe('estimated');expect(r.departureAt).toBeNull();
  });
  it('rejects missing capacity calibration without throwing an internal error',async()=>{
    const f=chargingFixture();f.vehicle.energyModel=energyFixture().vehicle.energyModel;
    f.vehicle.energyModel!.capacityTemperatureCurve=[{temperatureC:0,factor:.8},{temperatureC:40,factor:1}];
    f.capacity.temperatureAtAssessmentC=null;
    expect((await engine.evaluate(f)).reasons).toContain('BATTERY_TEMPERATURE_FOR_CAPACITY_MISSING');
  });
  it('rejects an uncovered and unordered voltage envelope',async()=>{
    const f=chargingFixture(),dc=f.station.evses[0].connectors[0];if(dc.powerType!=='dc')throw new Error();
    dc.powerEnvelopeInterpolation='linear';dc.powerEnvelope=[{voltageV:450,maxCurrentA:100,maxPowerKw:150},{voltageV:500,maxCurrentA:100,maxPowerKw:150}];
    expect((await engine.evaluate(f)).reasons).toContain('POWER_ENVELOPE_VOLTAGE_OUTSIDE_COVERAGE');
    dc.powerEnvelope.reverse();expect((await engine.evaluate(f)).reasons).toContain('POWER_ENVELOPE_INTERPOLATION_UNDEFINED');
  });
  it('bounds source size and yields so cancellation can interrupt detailed integration',async()=>{
    const f=chargingFixture();f.vehicle.dcChargingCurves[0].curve={representation:'power_by_soc',points:Array.from({length:2049},(_,i)=>({socPercent:i/2048*100,powerKw:100,voltageV:400,batteryTemperatureC:null}))};
    expect((await engine.evaluate(f)).status).toBe('computation_limit');
    const abort=new AbortController();const pending=engine.evaluate(detailedChargingCase(),abort.signal);
    queueMicrotask(()=>abort.abort(new Error('cancelled during integration')));
    await expect(pending).rejects.toThrow('cancelled during integration');
  });
});
