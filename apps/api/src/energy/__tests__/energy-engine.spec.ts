import {EnergyConsumptionEngine} from '../energy-engine';
import {energyFixture,terrain,idealMechanics} from './fixtures';
import {energyEvaluationResultSchema} from '@chargeroad/shared';
import {source} from '../../planning/__tests__/fixtures';

const run=(input=energyFixture())=>new EnergyConsumptionEngine().evaluate(input,new AbortController().signal);
describe('Deterministic battery-DC energy engine',()=>{
  it('matches an independent hand calculation of rolling and aerodynamic work',async()=>{
    const result=await run(),force=1000*9.80665*.01+.5*1*.5*(60/3.6)**2;
    expect(result.status).toBe('estimated');expect(result.netBatteryEnergyKwh).toBeCloseTo(force*1000/3600000,10);
    expect(result.finalChargePercent).toBeCloseTo(80-result.netBatteryEnergyKwh/80*100,10);
    expect(result.audit[0].driveLossKwh).toBe(0);expect(result.segments[0].breakdown?.baseAuxiliaryKwh).toBe(0);
  });
  it('keeps the same energy demand but changes the SOC timeline with initial charge',async()=>{
    const a=energyFixture(),b=energyFixture();b.request.startingChargePercent=20;
    const [x,y]=await Promise.all([run(a),run(b)]);
    expect(x.netBatteryEnergyKwh).toBeCloseTo(y.netBatteryEnergyKwh,10);expect(x.finalChargePercent!-y.finalChargePercent!).toBeCloseTo(60,10);
  });
  it('scales capacity relative to the SOH at which it was measured, exactly once',async()=>{
    const input=energyFixture();input.vehicle.capacity.atStateOfHealthPercent=80;input.request.stateOfHealthPercent={origin:'user_input',value:80,observedAt:input.request.departureAt};
    expect((await run(input)).capacityKwh).toBe(80);
    input.request.stateOfHealthPercent={origin:'user_input',value:40,observedAt:input.request.departureAt};expect((await run(input)).capacityKwh).toBe(40);
  });
  it('retains an internal peak and limits downhill recovery by actual mechanical energy',async()=>{
    const input=energyFixture();idealMechanics(input);terrain(input,[[0,0],[500,100],[1000,0]]);
    input.vehicle.energyModel!.regeneration.efficiency=.5;
    const result=await run(input),potential=1000*9.80665*100/3600000;
    expect(result.status).toBe('estimated');expect(result.audit[0].wheelPositiveKwh).toBeCloseTo(potential,10);
    expect(result.audit[0].regeneratedKwh).toBeCloseTo(potential*.5,10);expect(result.netBatteryEnergyKwh).toBeCloseTo(potential*.5,10);
    expect(result.minimumChargePercent!).toBeLessThan(result.finalChargePercent!);
    expect(result.audit[0].frictionBrakingKwh+result.audit[0].regeneratedKwh+result.audit[0].recoveryLossKwh).toBeCloseTo(potential,10);
  });
  it('reports an intermediate reserve violation even if a later descent restores arrival SOC',async()=>{
    const input=energyFixture();idealMechanics(input);terrain(input,[[0,0],[500,100],[1000,0]]);
    input.vehicle.capacity.referenceUsableBatteryKwh=1;input.request.startingChargePercent=30;
    const result=await run(input);expect(result.status).toBe('charge_required');expect(result.finalChargePercent).toBeCloseTo(30,8);
    expect(result.minimumChargePercent!).toBeLessThan(10);expect(result.reasons.map(r=>r.code)).toContain('RESERVE_WOULD_BE_VIOLATED');
  });
  it('never clips a depleted battery into a successful route; partial segments are explicit',async()=>{
    const input=energyFixture();idealMechanics(input);terrain(input,[[0,0],[1000,100]]);input.vehicle.capacity.referenceUsableBatteryKwh=.1;
    const result=await run(input);expect(result.status).toBe('charge_required');expect(result.completedDistanceMeters).toBeLessThan(1000);
    expect(result.finalChargePercent!).toBeGreaterThanOrEqual(0);expect(result.partialSegmentId).toBe(input.route.segments[0].id);
    expect(result.segments.reduce((sum,s)=>sum+s.netBatteryEnergyKwh,0)).toBeCloseTo(result.netBatteryEnergyKwh,10);
  });
  it.each(['full','cold','unknown'] as const)('does not invent regen headroom or thermal knowledge: %s',async mode=>{
    const input=energyFixture();idealMechanics(input);terrain(input,[[0,100],[1000,0]]);
    if(mode==='full')input.request.startingChargePercent=100;
    if(mode==='cold')input.request.initialBatteryTemperatureC={origin:'user_input',value:-10,observedAt:input.request.departureAt};
    if(mode==='unknown')input.request.initialBatteryTemperatureC={origin:'unknown',value:null};
    const result=await run(input);expect(result.audit[0].regeneratedKwh).toBeCloseTo(0,10);expect(result.finalChargePercent!).toBeLessThanOrEqual(100);
    if(mode==='unknown')expect(result.segments[0].batteryTemperatureAtEndC).toEqual({origin:'unknown',value:null});
  });
  it('enforces regenerative power, SOC taper, efficiency and missing-power limits',async()=>{
    const input=energyFixture();idealMechanics(input);terrain(input,[[0,100],[1000,0]]);input.vehicle.physics.maxRegenerationKw=1;
    const limited=await run(input);expect(limited.audit[0].regeneratedKwh).toBeLessThanOrEqual(1/60+1e-10);
    input.request.startingChargePercent=97.5;expect((await run(input)).audit[0].regeneratedKwh).toBeLessThanOrEqual(.5/60+1e-10);
    input.vehicle.physics.maxRegenerationKw=null;expect((await run(input)).audit[0].regeneratedKwh).toBe(0);
  });
  it('models headwind/crosswind and never turns excessive tailwind into free battery energy',async()=>{
    const input=energyFixture(),calm=await run(input);input.weather[0].windSpeedKph=36;input.weather[0].windFromDegrees=0;
    const head=await run(input);expect(head.netBatteryEnergyKwh).toBeGreaterThan(calm.netBatteryEnergyKwh);
    input.weather[0].windFromDegrees=90;expect((await run(input)).netBatteryEnergyKwh).toBeGreaterThan(calm.netBatteryEnergyKwh);
    input.weather[0].windFromDegrees=180;input.weather[0].windSpeedKph=100;const tail=await run(input);
    expect(tail.netBatteryEnergyKwh).toBeGreaterThan(0);expect(tail.audit[0].regeneratedKwh).toBe(0);expect(tail.assumptions).toContain('tailwind_assistance_not_harvested');
  });
  it('counts base auxiliary, cabin and battery thermal power separately, once',async()=>{
    const input=energyFixture(),baseline=await run(input);input.weather[0].temperatureCelsius=0;
    input.vehicle.energyModel!.baseAuxiliaryKw=.3;input.vehicle.energyModel!.batteryThermalKw=.2;input.request.operatingConditions.hvacMode='heat';
    const result=await run(input);expect(result.netBatteryEnergyKwh-baseline.netBatteryEnergyKwh).toBeCloseTo(2.5/60,10);
    expect(result.audit[0].cabinKwh).toBeCloseTo(2/60,10);expect(result.segments[0].batteryTemperatureAtEndC.value).toBeNull();
  });
  it('integrates actual acceleration/braking traces including stopped-time auxiliary consumption',async()=>{
    const input=energyFixture();idealMechanics(input);input.vehicle.energyModel!.baseAuxiliaryKw=1;
    const segment=input.route.segments[0];segment.drivingDurationSeconds=120;segment.expectedSpeedKph=30;input.route.drivingDurationSeconds=120;
    segment.speedProfile=[{elapsedSeconds:0,speedKph:0},{elapsedSeconds:20,speedKph:0},{elapsedSeconds:70,speedKph:72},{elapsedSeconds:120,speedKph:0}];
    const result=await run(input);expect(result.status).toBe('estimated');expect(result.audit[0].wheelPositiveKwh).toBeCloseTo(.5*1000*20**2/3600000,9);
    expect(result.netBatteryEnergyKwh).toBeCloseTo(120/3600,9);expect(result.audit[0].regeneratedKwh).toBeCloseTo(result.audit[0].wheelPositiveKwh,9);
  });
  it('rejects inconsistent speed traces and road time above a known speed limit',async()=>{
    const input=energyFixture();input.route.segments[0].speedProfile=[{elapsedSeconds:0,speedKph:0},{elapsedSeconds:60,speedKph:0}];
    await expect(run(input)).rejects.toThrow();delete input.route.segments[0].speedProfile;input.route.segments[0].speedLimitKph=50;
    expect((await run(input)).reasons[0].code).toBe('ROAD_TIME_OR_TRACE_EXCEEDS_SPEED_LIMIT');
  });
  it('requires motion distribution when the calibration disallows the travel-average proxy',async()=>{
    const input=energyFixture();input.vehicle.energyModel!.speedPolicy='require_speed_trace';
    expect((await run(input)).reasons[0].code).toBe('SPEED_DISTRIBUTION_MISSING');
  });
  it('applies an explicit initial cold capacity curve without generating energy as the pack warms',async()=>{
    const input=energyFixture();input.vehicle.energyModel!.capacityTemperatureCurve=[{temperatureC:-10,factor:.8},{temperatureC:30,factor:1}];
    input.request.initialBatteryTemperatureC={origin:'user_input',value:-10,observedAt:input.request.departureAt};
    const result=await run(input);expect(result.capacityKwh).toBe(64);expect(result.assumptions).toContain('capacity_fixed_at_evaluation_start_no_energy_created_by_warming');
    input.request.initialBatteryTemperatureC={origin:'unknown',value:null};expect((await run(input)).status).toBe('insufficient_data');
  });
  it('will not silently use a different vehicle, uncalibrated model, missing terrain or unknown HVAC',async()=>{
    const input=energyFixture();input.request.vehicleVariantId='another';expect((await run(input)).reasons[0].code).toBe('VEHICLE_VARIANT_MISMATCH');
    const missing=energyFixture();delete missing.vehicle.energyModel;expect((await run(missing)).reasons[0].code).toBe('ENERGY_CALIBRATION_MISSING');
    const terrainMissing=energyFixture();terrainMissing.route.segments[0].elevationProfile=null;terrainMissing.route.segments[0].elevationGainMeters=null;terrainMissing.route.segments[0].elevationLossMeters=null;
    expect((await run(terrainMissing)).reasons[0].code).toBe('ELEVATION_MISSING');
    terrainMissing.vehicle.energyModel!.unknowns.allowFlatElevation=true;expect((await run(terrainMissing)).assumptions).toContain('explicit_flat_elevation_fallback');
    const hvac=energyFixture();hvac.request.operatingConditions.hvacMode='unknown';expect((await run(hvac)).reasons[0].code).toBe('HVAC_STATE_MISSING');
  });
  it('rejects stale or absent core weather even if the caller permits assumptions',async()=>{
    const input=energyFixture();input.request.policy.unknownWeather='allow_with_documented_assumption';input.weather[0].windSpeedKph=null;
    expect((await run(input)).status).toBe('insufficient_data');
    const stale=energyFixture();stale.weather[0].sourceUpdatedAt='2026-11-01T00:00:00Z';stale.weather[0].fetchedAt=stale.evaluatedAt;
    expect((await run(stale)).reasons[0].code).toBe('WEATHER_CORE_OR_FRESHNESS_MISSING');
  });
  it('does not accept weather for another physical location or car road-load for a ferry',async()=>{
    const input=energyFixture();input.weather[0].location={latitude:0,longitude:0};
    expect((await run(input)).reasons[0].code).toBe('WEATHER_NOT_ON_ROAD_SEGMENT');
    const ferry=energyFixture();ferry.route.segments[0].roadClass='ferry';expect((await run(ferry)).reasons[0].code).toBe('FERRY_STANDBY_ENERGY_MODEL_REQUIRED');
  });
  it('requires wet/snow calibration rather than guessing surface coefficients',async()=>{
    const input=energyFixture();input.weather[0].precipitationMmPerHour=1;expect((await run(input)).reasons[0].code).toBe('WET_ROAD_CALIBRATION_MISSING');
    input.vehicle.energyModel!.wetRollingMultiplier=1.2;expect((await run(input)).status).toBe('estimated');
    input.weather[0].snowDepthCm=1;expect((await run(input)).reasons[0].code).toBe('SNOW_ROAD_CALIBRATION_MISSING');
  });
  it('does not select consumption by voltage architecture or change input snapshots',async()=>{
    const input=energyFixture(),before=JSON.stringify(input),a=await run(input);expect(JSON.stringify(input)).toBe(before);
    input.vehicle.voltageArchitecture='800v';const b=await run(input);expect(b.netBatteryEnergyKwh).toBeCloseTo(a.netBatteryEnergyKwh,10);
    expect(JSON.stringify(await run(input))).toBe(JSON.stringify(b));expect(energyEvaluationResultSchema.parse(b)).toEqual(b);
  });
  it('uses explicit strict/estimated gates and reports a target that requires charging',async()=>{
    const input=energyFixture();input.request.policy.vehicleDataQuality='verified_only';expect((await run(input)).reasons[0].code).toBe('ENGINEERING_ESTIMATE_NOT_ALLOWED');
    const target=energyFixture();target.request.startingChargePercent=15;expect((await run(target)).reasons.map(r=>r.code)).toContain('ARRIVAL_TARGET_NOT_MET');
  });
  it('cooperates with cancellation and enforces a bounded computation deadline',async()=>{
    const controller=new AbortController();controller.abort(new Error('cancelled'));
    await expect(new EnergyConsumptionEngine().evaluate(energyFixture(),controller.signal)).rejects.toThrow('cancelled');
    let clock=0;const input=energyFixture();input.request.policy.maxComputationMilliseconds=1;
    expect((await new EnergyConsumptionEngine(()=>clock++).evaluate(input,new AbortController().signal)).status).toBe('computation_limit');
  });
});

describe('Conditioned reference correction without double counting',()=>{
  function input(){const e=energyFixture();e.vehicle.energyModel!.mode='reference_corrected';return e;}
  it('returns the original reference in its flat, calm baseline, without adding base auxiliary twice',async()=>{
    const e=input();e.vehicle.energyModel!.baseAuxiliaryKw=5;const result=await run(e);
    expect(result.netBatteryEnergyKwh).toBeCloseTo(.2,10);expect(result.segments[0].breakdown).toBeNull();expect(result.audit[0].baseAuxiliaryKwh).toBe(0);
  });
  it('interpolates only within a matched speed band and never extrapolates or substitutes WLTP',async()=>{
    const e=input(),a=e.vehicle.consumptionReferences[0];a.conditions.meanSpeedKph=40;a.valueKwhPer100Km=10;
    e.vehicle.consumptionReferences.push({...structuredClone(a),id:'upper',valueKwhPer100Km:20,conditions:{...a.conditions,meanSpeedKph:80}});
    expect((await run(e)).netBatteryEnergyKwh).toBeCloseTo(.15,10);
    e.vehicle.consumptionReferences[1].conditions.meanSpeedKph=50;expect((await run(e)).status).toBe('insufficient_data');
    e.vehicle.consumptionReferences=[{...a,testCycle:'wltp'}];expect((await run(e)).status).toBe('insufficient_data');
  });
  it('corrects grade relative to the physical baseline rather than summing two complete consumption estimates',async()=>{
    const e=input();terrain(e,[[0,0],[1000,100]]);const result=await run(e);
    expect(result.netBatteryEnergyKwh).toBeCloseTo(.2+1000*9.80665*100/3600000,10);
    expect(result.referenceIds).toEqual(['ref']);
  });
  it('removes a documented included HVAC load before adding the actual requested HVAC load',async()=>{
    const e=input();e.vehicle.consumptionReferences[0].includedEffects.cabinHvac='included';e.vehicle.energyModel!.referenceCabinKw=2;
    e.request.operatingConditions.hvacMode='heat';e.weather[0].temperatureCelsius=0;
    expect((await run(e)).netBatteryEnergyKwh).toBeCloseTo(.2,10);
    e.request.operatingConditions.hvacMode='off';expect((await run(e)).netBatteryEnergyKwh).toBeCloseTo(.2-2/60,10);
  });
  it('requires a licensed battery-DC conversion for AC-grid values',async()=>{
    const e=input(),ref=e.vehicle.consumptionReferences[0];ref.energyBoundary='ac_grid';ref.includedEffects.chargingLosses='included';
    expect((await run(e)).status).toBe('insufficient_data');
    ref.batteryDcConversion={gridToBatteryEfficiency:.9,source:source('test-conversion')};
    expect((await run(e)).netBatteryEnergyKwh).toBeCloseTo(.18,10);
  });
  it('rejects unknown effects, ambiguous duplicate speeds and a reference below the physical road load',async()=>{
    const e=input();e.vehicle.consumptionReferences[0].includedEffects.cabinHvac='unknown';expect((await run(e)).status).toBe('insufficient_data');
    const duplicate=input();duplicate.vehicle.consumptionReferences.push({...structuredClone(duplicate.vehicle.consumptionReferences[0]),id:'same-speed'});
    expect((await run(duplicate)).status).toBe('insufficient_data');
    const low=input();low.vehicle.consumptionReferences[0].valueKwhPer100Km=1;
    expect((await run(low)).reasons[0].code).toBe('REFERENCE_BELOW_CALIBRATED_ROAD_LOAD');
  });
});
