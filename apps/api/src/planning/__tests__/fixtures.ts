import type { PlanningInput, RoadRoute, RoutePlanRequest, SourceReference, VehicleEnergyProfile, WeatherForecast } from '@chargeroad/shared';
import type { PreparationOptions } from '../planning-coordinator';

const unknown = { origin: 'unknown', value: null } as const;
export function source(id: string): SourceReference {
  return { sourceId: id, recordId: 'synthetic', version: 'v1', url: 'https://example.invalid/fixture',
    retrievedAt: '2026-11-10T07:59:00+03:00', publishedAt: '2026-11-10T07:00:00+03:00', license: 'TEST-ONLY' };
}
export function fixture() {
  const request: RoutePlanRequest = {
    schemaVersion: '1.0.0', requestId: '11111111-1111-4111-8111-111111111111',
    origin: { latitude: 39.9, longitude: 32.8 }, destination: { latitude: 39.909, longitude: 32.8 },
    vehicleVariantId: 'synthetic-vehicle', departureAt: '2026-11-10T08:00:00+03:00',
    startingChargePercent: 80, startingChargeSource: 'user_input', startingChargeObservedAt: '2026-11-10T07:59:00+03:00',
    initialBatteryTemperatureC: unknown, stateOfHealthPercent: unknown,
    operatingConditions: { payloadKg: unknown, cabinTargetTemperatureC: unknown,
      hvacMode: 'unknown', batteryPreconditioning: 'unknown', tireSetupId: null },
    constraints: { minimumReserveChargePercent: 10, targetArrivalChargePercent: 15 },
    policy: { id: 'test-policy', version: '1', objective: 'minimum_total_duration',
      availabilityMaxAgeSeconds: 300, forecastMaxAgeSeconds: 3600,
      unknownAvailability: 'allow_with_documented_risk', unknownWeather: 'reject',
      missingChargingCurve: 'report_insufficient_data', maxIterations: 3, maxComputationMilliseconds: 2000 },
  };
  const options: PreparationOptions = {
    road: { alternatives: 2, avoidTolls: false, avoidFerries: true,
      segmentationPolicy: { id: 'test-segments', version: '1', maxDistanceMeters: 1000,
        maxDurationSeconds: 120, splitAtSpeedChangeKph: 10, splitAtGradeChangePercent: 1,
        splitAtBearingChangeDegrees: 20, maxWeatherTimeStepSeconds: 600,
        splitAtRoadClassChanges: true, splitAtChargingAccess: true } },
    stationCorridorMeters: 1500, maxWeatherQueries: 10,
  };
  const vehicle: VehicleEnergyProfile = {
    id: 'energy-profile', version: '1', vehicleVariantId: request.vehicleVariantId,
    supportedConnectors: ['ccs2'], acMaxChargePowerKw: null,
    capacity: { referenceUsableBatteryKwh: 80, atStateOfHealthPercent: 100, source: source('vehicles') },
    voltageArchitecture: 'unknown', nominalPackVoltageV: null, packVoltageBySoc: null,
    thermalCapabilities: { heatPump: 'unknown', batteryPreconditioning: 'unknown' },
    dcChargingPaths: [], dcChargingCurves: [],
    consumptionReferences: [{ id: 'ref', version: '1', vehicleVariantId: request.vehicleVariantId,
      valueKwhPer100Km: 20, energyBoundary: 'battery_dc', basis: 'measured',
      testCycle: 'constant_speed', drivingProfile: 'highway',
      conditions: { meanSpeedKph: 60, ambientTemperatureC: null, batteryTemperatureC: null,
        payloadKg: null, windSpeedKph: null, elevationGainMetersPer100Km: null, tireDescription: null },
      includedEffects: { cabinHvac: 'unknown', batteryThermalManagement: 'unknown',
        elevation: 'unknown', wind: 'unknown', chargingLosses: 'excluded' },
      batteryDcConversion: null, source: source('vehicles') }],
    physics: { curbMassKg: null, dragAreaSquareMeters: null, rollingResistanceCoefficient: null,
      drivetrainEfficiency: null, maxRegenerationKw: null },
  };
  const road: RoadRoute = {
    id: 'road-1', distanceMeters: 1000, drivingDurationSeconds: 60,
    segments: [{ id: 'segment-1', sourceEdgeIds: ['edge-1'], startDistanceMeters: 0, endDistanceMeters: 1000,
      distanceMeters: 1000, drivingDurationSeconds: 60, geometry: [request.origin,request.destination],
      roadClass: 'motorway', bearingDegrees: 0, expectedSpeedKph: 60, speedLimitKph: 100,
      elevationProfile: null, elevationGainMeters: null, elevationLossMeters: null,
      startsAtChargingAccess: false, endsAtChargingAccess: false }],
    segmentationPolicy: options.road.segmentationPolicy, source: source('roads'),
  };
  return { request, options, vehicle, road };
}
export function forecast(query: { id: string; segmentId: string; location: { latitude: number; longitude: number }; validAt: string }): WeatherForecast {
  return { queryId: query.id, segmentId: query.segmentId, location: query.location, validAt: query.validAt,
    forecastIssuedAt: '2026-11-10T07:00:00+03:00', fetchedAt: '2026-11-10T07:59:00+03:00',
    temperatureCelsius: 20, windSpeedKph: 0, windFromDegrees: null, precipitationProbabilityPercent: 0,
    precipitationMmPerHour: 0, snowDepthCm: 0, airPressureHpa: null, source: source('weather') };
}
export function syntheticPlan(input: PlanningInput) {
  // Test engine output only. There is no production optimizer in this fixture.
  return { kind: 'result' as const, result: { status: 'planned' as const, plan: {
    schemaVersion: '1.0.0' as const, planId: '22222222-2222-4222-8222-222222222222', revision: 1,
    requestId: input.request.requestId, supersedes: null, createdAt: input.request.departureAt,
    vehicleVariantId: input.vehicle.vehicleVariantId, vehicleProfileId: input.vehicle.id,
    vehicleProfileVersion: input.vehicle.version, algorithmVersion: 'test-only-engine',
    policyId: input.request.policy.id, policyVersion: input.request.policy.version,
    dataSnapshotChecksums: input.dataSnapshots.map((snapshot) => snapshot.checksumSha256),
    roadRoute: input.roadCandidates[0], minimumReserveChargePercent: input.request.constraints.minimumReserveChargePercent,
    targetArrivalChargePercent: input.request.constraints.targetArrivalChargePercent, estimatedArrivalChargePercent: 79.75,
    energySegments: [{ segmentId: input.roadCandidates[0].segments[0].id,
      departureAt: input.request.departureAt, arrivalAt: '2026-11-10T08:01:00+03:00',
      startChargePercent: input.request.startingChargePercent, endChargePercent: 79.75, minimumChargePercent: 79.75,
      netBatteryEnergyKwh: 0.2, breakdown: null, batteryTemperatureAtEndC: unknown,
      consumptionReferenceIds: ['ref'], weatherQueryIds: [input.weather[0].queryId], modelVersion: 'test-only-energy' }],
    chargingStops: [], estimatedArrivalAt: '2026-11-10T08:01:00+03:00',
    duration: { drivingSeconds: 60, chargingSeconds: 0, connectionSeconds: 0,
      blockingPreconditioningSeconds: 0, waitingSeconds: 0, totalSeconds: 60 },
    assumptions: [{ id: 'fixture', code: 'synthetic_data', explanation: 'Not real vehicle performance.' }], warnings: [],
  } } };
}
