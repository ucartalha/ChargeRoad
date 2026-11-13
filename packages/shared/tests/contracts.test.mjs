import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as schemas from '../dist/esm/index.js';
import { makeExample } from '../examples/planning.mjs';

test('address selection contracts reject arbitrary provider packets and unbounded searches',()=>{
  assert.equal(schemas.locationSearchRequestSchema.safeParse({query:'Ankara'}).success,true);
  for(const body of [{query:'a'},{query:'x'.repeat(121)},{query:'Ankara',providerUrl:'https://attacker'}])assert.equal(schemas.locationSearchRequestSchema.safeParse(body).success,false);
  assert.equal(schemas.locationResultSchema.safeParse({id:'place',label:'Ankara',coordinate:{latitude:999,longitude:33}}).success,false);
});
test('road-only previews cannot carry fabricated SOC or inconsistent availability',()=>{
  assert.equal(schemas.roadPreviewResponseSchema.safeParse({schemaVersion:'1.0.0',status:'not_found',route:null}).success,true);
  assert.equal(schemas.roadPreviewResponseSchema.safeParse({schemaVersion:'1.0.0',status:'available',route:null}).success,false);
  assert.equal(schemas.roadPreviewResponseSchema.safeParse({schemaVersion:'1.0.0',status:'not_found',route:null,estimatedArrivalChargePercent:50}).success,false);
});

test('usable capacity snapshots apply SOH and temperature exactly once',()=>{
  const snapshot={vehicleProfileId:'profile',vehicleProfileVersion:'1',vehicleVariantId:'vehicle',referenceUsableKwh:80,
    referenceSohPercent:100,sohPercent:90,temperatureFactor:.8,temperatureAtAssessmentC:0,temperatureModelId:'capacity-model',temperatureModelVersion:'1',effectiveKwh:57.6,assumptions:[]};
  assert.equal(schemas.usableCapacitySnapshotSchema.safeParse(snapshot).success,true);
  assert.equal(schemas.usableCapacitySnapshotSchema.safeParse({...snapshot,effectiveKwh:51.84}).success,false);
});
test('charging intervals must progress and conserve energy',()=>{
  const interval={fromSocPercent:20,toSocPercent:80,seconds:1800,storedKwh:48,inletKwh:52,auxiliaryKwh:1,lossKwh:3,minInletKw:50,maxInletKw:150,limiter:'curve'};
  assert.equal(schemas.chargingIntervalSchema.safeParse(interval).success,true);
  assert.equal(schemas.chargingIntervalSchema.safeParse({...interval,lossKwh:5}).success,false);
  assert.equal(schemas.chargingIntervalSchema.safeParse({...interval,toSocPercent:10}).success,false);
});

const evaluate = (example) => schemas.planningEvaluationSchema.safeParse({
  input: example.input, result: example.result,
});
const rejects = (example) => assert.equal(evaluate(example).success, false);

test('public plan requests default only mode/unknown observations and reject internal controls',()=>{
  const {request}=makeExample().input;
  const body={schemaVersion:'1.0.0',requestId:request.requestId,origin:request.origin,destination:request.destination,
    vehicleVariantId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',departureAt:request.departureAt,startingChargePercent:80,
    startingChargeObservedAt:request.startingChargeObservedAt,constraints:request.constraints};
  const parsed=schemas.planningApiRequestSchema.parse(body);assert.equal(parsed.objective,'minimum_total_duration');
  assert.equal(parsed.stateOfHealthPercent.origin,'unknown');assert.equal(parsed.vehicleDataQuality,'verified_only');
  assert.equal(schemas.planningApiRequestSchema.safeParse({...body,policy:request.policy}).success,false);
  assert.equal(schemas.planningApiRequestSchema.safeParse({...body,initialBatteryTemperatureC:{origin:'estimated',value:30,modelVersion:'fake'}}).success,false);
  assert.equal(schemas.planningApiRequestSchema.safeParse({...body,constraints:{minimumReserveChargePercent:10}}).success,false);
});

test('approved planning mode defaults to duration but reserve and arrival SOC stay mandatory',()=>{
  const {input}=makeExample();delete input.request.policy.objective;
  assert.equal(schemas.routePlanRequestSchema.parse(input.request).policy.objective,'minimum_total_duration');
  delete input.request.constraints.targetArrivalChargePercent;
  assert.equal(schemas.routePlanRequestSchema.safeParse(input.request).success,false);
});

test('a complete synthetic envelope round-trips through the runtime contracts', () => {
  const example = makeExample();
  const parsed = evaluate(example);
  assert.equal(parsed.success, true, parsed.error?.message);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.data)), { input: example.input, result: example.result });
  assert.equal(schemas.chargeCorrectionSchema.safeParse(example.correction).success, true);
});

test('CommonJS API and ESM consumers enforce the same contract', () => {
  const require = createRequire(import.meta.url);
  const cjs = require('../dist/cjs/index.js');
  assert.deepEqual(cjs.routePlanRequestSchema.parse(makeExample().input.request),
    schemas.routePlanRequestSchema.parse(makeExample().input.request));
});

test('starting charge, reserve and arrival target are independent explicit values', () => {
  const request = makeExample().input.request;
  delete request.constraints.minimumReserveChargePercent;
  assert.equal(schemas.routePlanRequestSchema.safeParse(request).success, false);
  request.constraints.minimumReserveChargePercent = 20;
  request.constraints.targetArrivalChargePercent = 15;
  assert.equal(schemas.routePlanRequestSchema.safeParse(request).success, false);
  request.constraints.targetArrivalChargePercent = 25;
  request.startingChargePercent = 0; // At an origin charger this can still be a meaningful request.
  assert.equal(schemas.routePlanRequestSchema.safeParse(request).success, true);
});

test('units reject NaN, out-of-range percentages, invalid coordinates and naive timestamps', () => {
  for (const charge of [-1, 101, NaN, Infinity]) {
    const request = makeExample().input.request;
    request.startingChargePercent = charge;
    assert.equal(schemas.routePlanRequestSchema.safeParse(request).success, false);
  }
  const request = makeExample().input.request;
  request.origin.latitude = 91;
  assert.equal(schemas.routePlanRequestSchema.safeParse(request).success, false);
  request.origin.latitude = 39;
  request.departureAt = '2026-11-10T08:00:00';
  assert.equal(schemas.routePlanRequestSchema.safeParse(request).success, false);
});

test('unknown battery temperature remains unknown and cannot carry a numeric temperature', () => {
  assert.equal(schemas.numericObservationSchema.safeParse({ origin: 'unknown', value: 20 }).success, false);
  assert.equal(schemas.numericObservationSchema.safeParse({ origin: 'estimated', value: 20,
    observedAt: '2026-11-10T08:00:00Z' }).success, false);
});

test('AC-grid consumption is retained but cannot silently become driving battery consumption', () => {
  const e = makeExample();
  e.input.vehicle.consumptionReferences[0].energyBoundary = 'ac_grid';
  e.input.vehicle.consumptionReferences[0].includedEffects.chargingLosses = 'included';
  rejects(e);
  e.input.vehicle.consumptionReferences[0].batteryDcConversion = {
    gridToBatteryEfficiency: 0.9, source: e.input.vehicle.consumptionReferences[0].source,
  };
  assert.equal(evaluate(e).success, true);
});

test('a single claimed constant-speed reference must identify its actual speed', () => {
  const reference = makeExample().input.vehicle.consumptionReferences[0];
  reference.conditions.meanSpeedKph = null;
  assert.equal(schemas.consumptionReferenceSchema.safeParse(reference).success, false);
});

test('ascent and descent do not disappear when endpoints have equal elevation', () => {
  const segment = makeExample().input.roadCandidates[0].segments[0];
  assert.equal(schemas.roadSegmentSchema.safeParse(segment).success, true);
  segment.elevationGainMeters = 0;
  segment.elevationLossMeters = 0;
  assert.equal(schemas.roadSegmentSchema.safeParse(segment).success, false);
});

test('road gaps, speed/time inconsistencies and unsplit long segments are rejected', () => {
  let e = makeExample();
  e.input.roadCandidates[0].segments[1].startDistanceMeters += 1;
  rejects(e);
  e = makeExample();
  e.input.roadCandidates[0].segments[0].expectedSpeedKph = 110;
  rejects(e);
  e = makeExample();
  e.input.roadCandidates[0].segmentationPolicy.maxDistanceMeters = 500;
  rejects(e);
});

test('speed traces must integrate to the road distance and cover the full segment duration',()=>{
  const segment=makeExample().input.roadCandidates[0].segments[0];
  segment.speedProfile=[{elapsedSeconds:0,speedKph:60},{elapsedSeconds:60,speedKph:60}];
  assert.equal(schemas.roadSegmentSchema.safeParse(segment).success,true);
  segment.speedProfile[1].speedKph=0;assert.equal(schemas.roadSegmentSchema.safeParse(segment).success,false);
});

test('base auxiliaries participate in battery energy balance instead of disappearing in the breakdown',()=>{
  const segment=makeExample().result.plan.energySegments[0];
  segment.breakdown={tractionKwh:segment.netBatteryEnergyKwh,baseAuxiliaryKwh:.01,cabinAuxiliaryKwh:0,batteryThermalKwh:0,regeneratedKwh:0};
  assert.equal(schemas.energySegmentSchema.safeParse(segment).success,false);
  segment.breakdown.tractionKwh-=.01;assert.equal(schemas.energySegmentSchema.safeParse(segment).success,true);
});

test('weather is tied to passage time after charging, not just initial departure', () => {
  const e = makeExample();
  e.input.weather[1].validAt = '2026-11-10T08:01:30+03:00';
  rejects(e);
  e.input.weather[1].validAt = '2026-11-10T08:17:30+03:00';
  assert.equal(evaluate(e).success, true);
});

test('stale forecasts are not silently used under a reject policy', () => {
  const e = makeExample();
  e.input.weather[0].forecastIssuedAt = '2026-11-09T07:00:00+03:00';
  rejects(e);
});

test('unknown model issue time requires a genuine dataset update time, never a download timestamp', () => {
  const e = makeExample(), weather=e.input.weather[0];
  weather.sourceUpdatedAt=weather.forecastIssuedAt;weather.forecastIssuedAt=null;
  assert.equal(evaluate(e).success,true);
  weather.sourceUpdatedAt=null;rejects(e);
});

test('fresh downloads and permissive client assumptions cannot make unavailable core weather reliable', () => {
  const e=makeExample(),weather=e.input.weather[0];
  weather.sourceUpdatedAt='2026-11-09T07:00:00+03:00';weather.fetchedAt=e.result.plan.createdAt;rejects(e);
  weather.sourceUpdatedAt=weather.forecastIssuedAt;weather.status='provider_unavailable';
  e.input.request.policy.unknownWeather='allow_with_documented_assumption';rejects(e);
  weather.status='partial';weather.windSpeedKph=null;rejects(e);
});

test('current curves require voltage at every SOC point; electrical power is not net stored power', () => {
  const curve = makeExample().input.vehicle.dcChargingCurves[0];
  curve.curve = { representation: 'current_by_soc', points: [
    { socPercent: 10, currentA: 300, voltageV: 650, batteryTemperatureC: 30 },
    { socPercent: 80, currentA: 100, voltageV: 820, batteryTemperatureC: 32 },
  ] };
  assert.equal(schemas.dcChargingCurveSchema.safeParse(curve).success, true);
  delete curve.curve.points[0].voltageV;
  assert.equal(schemas.dcChargingCurveSchema.safeParse(curve).success, false);
  curve.curve.points[0].voltageV = 650;
  curve.powerBoundary = 'battery_stored';
  assert.equal(schemas.dcChargingCurveSchema.safeParse(curve).success, false);
});

test('duplicate SOC points and extrapolation beyond measured coverage are rejected', () => {
  const e = makeExample();
  e.input.vehicle.dcChargingCurves[0].curve.points[1].socPercent = 10;
  rejects(e);
  const stop = makeExample().result.plan.chargingStops[0];
  stop.targetChargePercent = 90;
  assert.equal(schemas.chargingStopSchema.safeParse(stop).success, false);
});

test('800V label cannot bypass incompatible station voltage or select the wrong conversion path', () => {
  const e = makeExample();
  e.input.stations[0].evses[0].connectors[0].outputVoltageRangeV = { min: 200, max: 500 };
  rejects(e); // Native path is 600–900V even though the same vehicle also has a boost path.
  e.result.plan.chargingStops[0].chargingPathId = 'boost';
  rejects(e); // The warm curve was measured on native input, not the boost path.
});

test('open-circuit pack voltage cannot be substituted for a charging inlet voltage profile', () => {
  const e = makeExample();
  const path = e.input.vehicle.dcChargingPaths[0];
  path.inletVoltageBySoc = {
    id: 'voltage', voltageBoundary: 'open_circuit',
    points: [{ socPercent: 10, voltageV: 650 }, { socPercent: 80, voltageV: 820 }],
    batteryTemperatureC: null, source: path.source,
  };
  rejects(e);
});

test('cold/unknown battery conditions cannot silently reuse a warm curve without a thermal model', () => {
  const e = makeExample();
  const stop = e.result.plan.chargingStops[0];
  stop.batteryTemperatureAtArrivalC = { origin: 'user_input', value: 0, observedAt: e.input.request.departureAt };
  stop.thermalModelVersion = null;
  rejects(e);
  stop.thermalModelVersion = 'explicit-cold-model-v1';
  assert.equal(evaluate(e).success, true);
});

test('one EVSE cannot double its capacity by listing alternative connectors', () => {
  const station = makeExample().input.stations[0];
  const evse = station.evses[0];
  evse.connectors.push({ ...evse.connectors[0] });
  assert.equal(schemas.chargingStationSchema.safeParse(station).success, false);
  evse.connectors[1].id = 'alternative-plug';
  assert.equal(schemas.chargingStationSchema.safeParse(station).success, true);
  assert.equal(station.evses.length, 1);
});

test('an EVSE power-pool allocation cannot exceed the declared shared total', () => {
  const station = makeExample().input.stations[0];
  station.sharedPowerPools[0].availablePowerKw = {
    origin: 'measured', value: 350, observedAt: '2026-11-10T08:00:00Z', sourceId: 'test-meter',
  };
  assert.equal(schemas.chargingStationSchema.safeParse(station).success, false);
});

test('stale connector availability must become unknown using the actual planning policy', () => {
  const e = makeExample();
  const stop = e.result.plan.chargingStops[0];
  e.input.stations[0].evses[0].availability.sourceObservedAt = '2026-11-09T07:58:00+03:00';
  stop.availabilitySnapshot.sourceObservedAt = '2026-11-09T07:58:00+03:00';
  rejects(e);
  stop.availabilitySnapshot.effectiveStatus = 'unknown';
  rejects(e);
  e.result.plan.warnings.push({ code: 'unknown_availability', explanation: 'Synthetic station status is stale.' });
  assert.equal(evaluate(e).success, true);
  stop.availabilitySnapshot.maxAgeSeconds = 999999;
  rejects(e);
});

test('stop energy must balance and cannot create charge beyond inlet energy', () => {
  const stop = makeExample().result.plan.chargingStops[0];
  stop.energyStoredKwh += 1;
  assert.equal(schemas.chargingStopSchema.safeParse(stop).success, false);
});

test('driving to a station is part of the road route and cannot be added twice to total duration', () => {
  const e = makeExample();
  e.result.plan.duration.totalSeconds += e.result.plan.chargingStops[0].detourDrivingSeconds;
  rejects(e);
});

test('unknown queue duration propagates to later segment times and final ETA', () => {
  const e = makeExample();
  const plan = e.result.plan;
  const stop = plan.chargingStops[0];
  stop.waiting = { basis: 'unknown', seconds: null, justificationId: null };
  stop.departureAt = null;
  rejects(e);
  plan.duration.waitingSeconds = null;
  plan.duration.totalSeconds = null;
  plan.estimatedArrivalAt = null;
  plan.energySegments[1].departureAt = null;
  plan.energySegments[1].arrivalAt = null;
  assert.equal(evaluate(e).success, true);
});

test('the battery timeline cannot jump between driving and charging', () => {
  const e = makeExample();
  e.result.plan.energySegments[1].startChargePercent = 65;
  rejects(e);
});

test('reserve and target cannot be bypassed by a superficially valid route', () => {
  const e = makeExample();
  e.result.plan.energySegments[0].minimumChargePercent = 5;
  rejects(e);
});

test('data snapshots and requested vehicle variant cannot be silently replaced', () => {
  let e = makeExample();
  e.result.plan.dataSnapshotChecksums = ['b'.repeat(64)];
  rejects(e);
  e = makeExample();
  e.input.vehicle.vehicleVariantId = 'another-variant';
  rejects(e);
});

test('a superseding plan must advance its revision', () => {
  const e = makeExample();
  e.result.plan.supersedes = { planId: e.result.plan.planId, revision: 1 };
  rejects(e);
});

test('lower/higher post-charge user entries remain absolute SOC observations, not deltas', () => {
  for (const charge of [0, 40, 60, 90, 100]) {
    const correction = makeExample().correction;
    correction.chargePercent = charge;
    const parsed = schemas.chargeCorrectionSchema.parse(correction);
    assert.equal(parsed.chargePercent, charge);
    assert.equal(parsed.origin, 'user_input');
    assert.equal(parsed.observedPlan.revision, 1);
  }
  const correction = makeExample().correction;
  correction.reason = 'after_charging';
  correction.chargingStopId = null;
  assert.equal(schemas.chargeCorrectionSchema.safeParse(correction).success, false);
});

test('infeasible, insufficient-data and provider errors stay separate from valid plans', () => {
  for (const status of ['infeasible', 'insufficient_data', 'provider_error', 'computation_limit']) {
    const e = makeExample();
    e.result = { status, requestId: e.input.request.requestId,
      reasons: [{ code: 'synthetic-reason', explanation: 'Synthetic failure; no invented plan.' }] };
    assert.equal(evaluate(e).success, true);
  }
});

test('estimated battery temperature identifies both computation time and validity time', () => {
  const sample = makeExample().result.plan.chargingStops[0].batteryTemperatureAtArrivalC;
  assert.equal(sample.estimatedAt, '2026-11-10T08:00:00+03:00');
  assert.equal(sample.validAt, '2026-11-10T08:01:00+03:00');
  delete sample.validAt;
  assert.equal(schemas.numericObservationSchema.safeParse(sample).success, false);
});

test('unknown payload and HVAC settings are explicit and negative payload is rejected', () => {
  const request = makeExample().input.request;
  assert.equal(request.operatingConditions.hvacMode, 'unknown');
  request.operatingConditions.payloadKg = { origin: 'user_input', value: -10,
    observedAt: '2026-11-10T07:59:00+03:00' };
  assert.equal(schemas.routePlanRequestSchema.safeParse(request).success, false);
});

test('a voltage-converter path cannot claim a curve above its own input power limit', () => {
  const profile = makeExample().input.vehicle;
  profile.dcChargingCurves[0].chargingPathId = 'boost';
  assert.equal(schemas.vehicleEnergyProfileSchema.safeParse(profile).success, false);
});
