// Synthetic data for contract examples/tests. These are not vehicle specifications or product defaults.
export function makeExample() {
  const source = {
    sourceId: 'synthetic-test-only', recordId: 'fixture', version: 'fixture-v1',
    url: 'https://example.invalid/fixture', retrievedAt: '2026-11-10T07:50:00+03:00',
    publishedAt: '2026-11-10T07:00:00+03:00', license: 'TEST-ONLY',
  };
  const unknown = { origin: 'unknown', value: null };
  const warm = (validAt) => ({ origin: 'estimated', value: 30, estimatedAt: '2026-11-10T08:00:00+03:00', validAt, modelVersion: 'synthetic-thermal-v1' });
  const makeCurve = () => ({
    id: 'warm-curve', version: '1', vehicleVariantId: 'synthetic-ev-800v', chargingPathId: 'native',
    semantics: 'vehicle_acceptance_limit', powerBoundary: 'vehicle_inlet',
    curve: { representation: 'power_by_soc', points: [
      { socPercent: 10, powerKw: 250, voltageV: 650, batteryTemperatureC: 30 },
      { socPercent: 80, powerKw: 75, voltageV: 820, batteryTemperatureC: 32 },
    ] },
    interpolation: 'linear', extrapolation: 'forbidden',
    conditions: {
      batteryTemperatureC: { min: 25, max: 35 }, ambientTemperatureC: { min: 15, max: 25 },
      stateOfHealthPercent: { min: 95, max: 100 }, preconditioning: 'completed',
      evseMaxPowerKw: 300, evseMaxCurrentA: 500, evseVoltageRangeV: { min: 200, max: 1000 },
      thermalAuxiliariesIncluded: 'excluded', conversionLossesIncluded: 'excluded',
    }, source,
  });
  const reference = {
    id: 'constant-speed-90', version: '1', vehicleVariantId: 'synthetic-ev-800v',
    valueKwhPer100Km: 18, energyBoundary: 'battery_dc', basis: 'measured',
    testCycle: 'constant_speed', drivingProfile: 'highway',
    conditions: { meanSpeedKph: 90, ambientTemperatureC: { min: 15, max: 25 },
      batteryTemperatureC: { min: 25, max: 35 }, payloadKg: 75, windSpeedKph: 0,
      elevationGainMetersPer100Km: 0, tireDescription: 'synthetic reference tires' },
    includedEffects: { cabinHvac: 'excluded', batteryThermalManagement: 'excluded',
      elevation: 'excluded', wind: 'excluded', chargingLosses: 'excluded' },
    batteryDcConversion: null, source,
  };
  const vehicle = {
    id: 'synthetic-energy-profile', version: '1', vehicleVariantId: 'synthetic-ev-800v',
    supportedConnectors: ['ccs2', 'type2'], acMaxChargePowerKw: 11,
    capacity: { referenceUsableBatteryKwh: 80, atStateOfHealthPercent: 100, source },
    voltageArchitecture: '800v', nominalPackVoltageV: 800, packVoltageBySoc: null,
    thermalCapabilities: { heatPump: 'unknown', batteryPreconditioning: 'unknown' },
    dcChargingPaths: [
      { id: 'native', mode: 'native_pack', inletVoltageRangeV: { min: 600, max: 900 },
        inletVoltageBySoc: null, maxInletPowerKw: 280, maxInletCurrentA: 500,
        conversionEfficiency: null, source },
      { id: 'boost', mode: 'boost_converter', inletVoltageRangeV: { min: 300, max: 500 },
        inletVoltageBySoc: null, maxInletPowerKw: 100, maxInletCurrentA: 300,
        conversionEfficiency: 0.95, source },
    ],
    consumptionReferences: [reference], dcChargingCurves: [makeCurve()],
    physics: { curbMassKg: null, dragAreaSquareMeters: null, rollingResistanceCoefficient: null,
      drivetrainEfficiency: null, maxRegenerationKw: null },
  };
  const policy = {
    id: 'synthetic-policy', version: '1', objective: 'minimum_total_duration',
    availabilityMaxAgeSeconds: 300, forecastMaxAgeSeconds: 7200,
    unknownAvailability: 'allow_with_documented_risk', unknownWeather: 'reject',
    missingChargingCurve: 'report_insufficient_data', maxIterations: 3, maxComputationMilliseconds: 2000,
  };
  const origin = { latitude: 39.9, longitude: 32.8 };
  const middle = { latitude: 39.909, longitude: 32.8 };
  const destination = { latitude: 39.918, longitude: 32.8 };
  const request = {
    schemaVersion: '1.0.0', requestId: '11111111-1111-4111-8111-111111111111',
    origin, destination, vehicleVariantId: vehicle.vehicleVariantId,
    departureAt: '2026-11-10T08:00:00+03:00', startingChargePercent: 25,
    startingChargeSource: 'user_input', startingChargeObservedAt: '2026-11-10T07:59:00+03:00',
    initialBatteryTemperatureC: unknown, stateOfHealthPercent: unknown,
    operatingConditions: { payloadKg: unknown, cabinTargetTemperatureC: unknown,
      hvacMode: 'unknown', batteryPreconditioning: 'unknown', tireSetupId: null },
    constraints: { minimumReserveChargePercent: 10, targetArrivalChargePercent: 15 }, policy,
  };
  const segment = (id, start, geometry) => ({
    id, sourceEdgeIds: ['edge-' + id], startDistanceMeters: start, endDistanceMeters: start + 1000,
    distanceMeters: 1000, drivingDurationSeconds: 60, geometry, roadClass: 'motorway',
    bearingDegrees: 0, expectedSpeedKph: 60, speedLimitKph: 110,
    elevationProfile: [{ distanceFromStartMeters: 0, elevationMeters: 900 },
      { distanceFromStartMeters: 500, elevationMeters: 920 },
      { distanceFromStartMeters: 1000, elevationMeters: 900 }],
    elevationGainMeters: 20, elevationLossMeters: 20, startsAtChargingAccess: true, endsAtChargingAccess: true,
  });
  const road = {
    id: 'road-a', distanceMeters: 2000, drivingDurationSeconds: 120,
    segments: [segment('segment-1', 0, [origin, middle]), segment('segment-2', 1000, [middle, destination])],
    segmentationPolicy: { id: 'synthetic-segmentation', version: '1', maxDistanceMeters: 1000,
      maxDurationSeconds: 90, splitAtSpeedChangeKph: 10, splitAtGradeChangePercent: 1,
      splitAtBearingChangeDegrees: 20, maxWeatherTimeStepSeconds: 600,
      splitAtRoadClassChanges: true, splitAtChargingAccess: true },
    source,
  };
  const weather = (id, segmentId, validAt) => ({
    queryId: id, segmentId, location: middle, validAt,
    forecastIssuedAt: '2026-11-10T07:00:00+03:00', fetchedAt: '2026-11-10T07:50:00+03:00',
    temperatureCelsius: 20, windSpeedKph: 15, windFromDegrees: 0,
    precipitationProbabilityPercent: 10, precipitationMmPerHour: 0, snowDepthCm: 0, airPressureHpa: 1013,
    source,
  });
  const availability = {
    reportedStatus: 'available', sourceObservedAt: '2026-11-10T07:58:00+03:00',
    receivedAt: '2026-11-10T07:59:00+03:00', source,
  };
  const station = {
    id: 'station-a', name: 'Synthetic station', location: middle, operatorId: null,
    evses: [{ id: 'evse-1', availability, sharedPowerPoolId: 'pool-1', connectors: [{
      id: 'connector-1', powerType: 'dc', standard: 'ccs2', maxPowerKw: 300,
      maxCurrentA: 500, outputVoltageRangeV: { min: 200, max: 1000 }, powerEnvelope: [], source,
    }] }],
    sharedPowerPools: [{ id: 'pool-1', ratedTotalPowerKw: 300, availablePowerKw: unknown }],
    access: { publicAccess: true, membershipRequired: false, openingHours: null }, source,
  };
  const stop = {
    id: 'stop-1', stationId: station.id, evseId: 'evse-1', connectorId: 'connector-1', chargingPathId: 'native',
    location: middle, routeDistanceMeters: 1000, detourDistanceMeters: 100, detourDrivingSeconds: 6,
    arrivalChargePercent: 24.8, targetChargePercent: 60, effectiveBatteryCapacityKwh: 80,
    energyDeliveredAtInletKwh: 30.16, energyStoredKwh: 28.16, auxiliaryEnergyKwh: 1, conversionLossKwh: 1,
    curveReference: { id: 'warm-curve', version: '1', coveredSocPercent: { min: 10, max: 80 }, extrapolation: 'forbidden' },
    batteryTemperatureAtArrivalC: warm('2026-11-10T08:01:00+03:00'), batteryTemperatureAtDepartureC: warm('2026-11-10T08:17:00+03:00'), thermalModelVersion: 'synthetic-thermal-v1',
    chargingDurationSeconds: 900, connectionDurationSeconds: 60, blockingPreconditioningSeconds: 0,
    waiting: { basis: 'none_needed', seconds: 0, justificationId: null },
    arrivalAt: '2026-11-10T08:01:00+03:00', departureAt: '2026-11-10T08:17:00+03:00',
    availabilitySnapshot: { reportedStatus: 'available', effectiveStatus: 'available',
      sourceObservedAt: availability.sourceObservedAt, receivedAt: availability.receivedAt,
      evaluatedAt: '2026-11-10T08:00:00+03:00', maxAgeSeconds: 300, sourceId: source.sourceId },
  };
  const energy = (segmentId, start, end, departureAt, arrivalAt, weatherId) => ({
    segmentId, departureAt, arrivalAt, startChargePercent: start, endChargePercent: end,
    minimumChargePercent: end, netBatteryEnergyKwh: 0.16, breakdown: null,
    batteryTemperatureAtEndC: warm(arrivalAt), consumptionReferenceIds: [reference.id], weatherQueryIds: [weatherId],
    modelVersion: 'synthetic-energy-v1',
  });
  const input = {
    request, vehicle, roadCandidates: [road],
    weather: [weather('weather-1', 'segment-1', '2026-11-10T08:00:30+03:00'),
      weather('weather-2', 'segment-2', '2026-11-10T08:17:30+03:00')],
    stations: [station],
    dataSnapshots: [{ sourceId: source.sourceId, version: 'fixture-v1',
      checksumSha256: 'a'.repeat(64), capturedAt: '2026-11-10T07:50:00+03:00' }],
  };
  const plan = {
    schemaVersion: '1.0.0', planId: '22222222-2222-4222-8222-222222222222',
    revision: 1, requestId: request.requestId, supersedes: null, createdAt: '2026-11-10T08:00:00+03:00',
    vehicleVariantId: vehicle.vehicleVariantId, vehicleProfileId: vehicle.id, vehicleProfileVersion: vehicle.version,
    algorithmVersion: 'synthetic-solver-v1', policyId: policy.id, policyVersion: policy.version,
    dataSnapshotChecksums: ['a'.repeat(64)], roadRoute: road,
    minimumReserveChargePercent: 10, targetArrivalChargePercent: 15, estimatedArrivalChargePercent: 59.8,
    energySegments: [
      energy('segment-1', 25, 24.8, '2026-11-10T08:00:00+03:00', '2026-11-10T08:01:00+03:00', 'weather-1'),
      energy('segment-2', 60, 59.8, '2026-11-10T08:17:00+03:00', '2026-11-10T08:18:00+03:00', 'weather-2'),
    ],
    chargingStops: [stop], estimatedArrivalAt: '2026-11-10T08:18:00+03:00',
    duration: { drivingSeconds: 120, chargingSeconds: 900, connectionSeconds: 60,
      blockingPreconditioningSeconds: 0, waitingSeconds: 0, totalSeconds: 1080 },
    assumptions: [{ id: 'unknown-health', code: 'reference_capacity_used', explanation: 'Synthetic capacity at reference health; not a measured current vehicle capacity.' }],
    warnings: [],
  };
  const correction = {
    schemaVersion: '1.0.0', eventId: '33333333-3333-4333-8333-333333333333',
    tripId: 'synthetic-trip', observedPlan: { planId: plan.planId, revision: 1 }, sequence: 1,
    origin: 'user_input', chargePercent: 55, observedAt: '2026-11-10T08:17:00+03:00',
    receivedAt: '2026-11-10T08:17:01+03:00', location: middle,
    locationObservedAt: '2026-11-10T08:16:58+03:00', locationAccuracyMeters: 8,
    reason: 'after_charging', chargingStopId: stop.id,
  };
  // JSON round-trip detaches plan copies from source snapshots for tampering tests.
  return JSON.parse(JSON.stringify({ input, result: { status: 'planned', plan }, correction }));
}
