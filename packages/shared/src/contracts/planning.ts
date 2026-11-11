import { z } from 'zod';
import {
  contractVersionSchema, finiteSchema, idSchema, nonnegativeSchema, numericObservationSchema,
  percentSchema, positiveSchema, timestampSchema,
} from './common.js';
import { roadRouteSchema, weatherForecastSchema } from './road-weather.js';
import { chargingStationSchema } from './stations.js';
import { vehicleEnergyProfileSchema } from './vehicle-energy.js';
import { stationSearchMetadataSchema } from './station-catalogue.js';
import { routePlanRequestSchema } from './request.js';
import { chargingStopSchema } from './charging-stop.js';

export const energySegmentSchema = z.object({
  segmentId: idSchema,
  departureAt: timestampSchema.nullable(),
  arrivalAt: timestampSchema.nullable(),
  startChargePercent: percentSchema,
  endChargePercent: percentSchema,
  minimumChargePercent: percentSchema,
  netBatteryEnergyKwh: finiteSchema,
  breakdown: z.object({
    tractionKwh: nonnegativeSchema,
    baseAuxiliaryKwh:nonnegativeSchema.optional(),
    cabinAuxiliaryKwh: nonnegativeSchema,
    batteryThermalKwh: nonnegativeSchema,
    regeneratedKwh: nonnegativeSchema,
  }).strict().nullable(),
  batteryTemperatureAtEndC: numericObservationSchema,
  consumptionReferenceIds: z.array(idSchema),
  weatherQueryIds: z.array(idSchema),
  modelVersion: idSchema,
}).strict().superRefine((segment, ctx) => {
  if (segment.minimumChargePercent > Math.min(segment.startChargePercent, segment.endChargePercent))
    ctx.addIssue({ code: 'custom', path: ['minimumChargePercent'], message: 'Minimum charge exceeds an endpoint' });
  if ((segment.netBatteryEnergyKwh > 0 && segment.endChargePercent > segment.startChargePercent) ||
      (segment.netBatteryEnergyKwh < 0 && segment.endChargePercent < segment.startChargePercent))
    ctx.addIssue({ code: 'custom', message: 'Battery energy and SOC move in opposite directions' });
  if (segment.breakdown) {
    const b = segment.breakdown;
    if (Math.abs(b.tractionKwh + (b.baseAuxiliaryKwh??0) + b.cabinAuxiliaryKwh + b.batteryThermalKwh - b.regeneratedKwh - segment.netBatteryEnergyKwh) > 0.001)
      ctx.addIssue({ code: 'custom', path: ['breakdown'], message: 'Energy components do not match net battery consumption' });
  }
  if ((segment.departureAt === null) !== (segment.arrivalAt === null) ||
      (segment.departureAt && segment.arrivalAt && Date.parse(segment.arrivalAt) < Date.parse(segment.departureAt)))
    ctx.addIssue({ code: 'custom', path: ['arrivalAt'], message: 'Invalid segment timeline' });
});

export const planningInputSchema = z.object({
  request: routePlanRequestSchema,
  vehicle: vehicleEnergyProfileSchema,
  roadCandidates: z.array(roadRouteSchema).min(1),
  weather: z.array(weatherForecastSchema),
  stations: z.array(chargingStationSchema),
  stationSearch:stationSearchMetadataSchema.optional(),
  dataSnapshots: z.array(z.object({
    sourceId: idSchema,
    version: idSchema.nullable(),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    capturedAt: timestampSchema,
  }).strict()).min(1),
}).strict().superRefine((input, ctx) => {
  if (input.request.vehicleVariantId !== input.vehicle.vehicleVariantId)
    ctx.addIssue({ code: 'custom', path: ['vehicle'], message: 'Requested vehicle and energy profile differ' });
  if (new Set(input.roadCandidates.map((route) => route.id)).size !== input.roadCandidates.length)
    ctx.addIssue({ code: 'custom', path: ['roadCandidates'], message: 'Duplicate road candidate ID' });
  if (new Set(input.stations.map((station) => station.id)).size !== input.stations.length)
    ctx.addIssue({ code: 'custom', path: ['stations'], message: 'Duplicate station ID' });
  const segments = new Set(input.roadCandidates.flatMap((route) => route.segments.map((segment) => segment.id)));
  for (const forecast of input.weather) {
    if (!segments.has(forecast.segmentId))
      ctx.addIssue({ code: 'custom', path: ['weather'], message: 'Forecast references an unknown road segment' });
  }
});

export const routePlanSchema = z.object({
  stationSearch:stationSearchMetadataSchema.optional(),
  schemaVersion: contractVersionSchema,
  planId: z.string().uuid(),
  revision: z.number().int().positive(),
  requestId: z.string().uuid(),
  supersedes: z.object({ planId: z.string().uuid(), revision: z.number().int().positive() }).strict().nullable(),
  createdAt: timestampSchema,
  vehicleVariantId: idSchema,
  vehicleProfileId: idSchema,
  vehicleProfileVersion: idSchema,
  algorithmVersion: idSchema,
  policyId: idSchema,
  policyVersion: idSchema,
  dataSnapshotChecksums: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1),
  roadRoute: roadRouteSchema,
  minimumReserveChargePercent: percentSchema,
  targetArrivalChargePercent: percentSchema,
  estimatedArrivalChargePercent: percentSchema,
  energySegments: z.array(energySegmentSchema).min(1),
  chargingStops: z.array(chargingStopSchema),
  estimatedArrivalAt: timestampSchema.nullable(),
  duration: z.object({
    drivingSeconds: positiveSchema,
    chargingSeconds: nonnegativeSchema,
    connectionSeconds: nonnegativeSchema,
    blockingPreconditioningSeconds: nonnegativeSchema,
    waitingSeconds: nonnegativeSchema.nullable(),
    totalSeconds: positiveSchema.nullable(),
  }).strict(),
  assumptions: z.array(z.object({ id: idSchema, code: idSchema, explanation: z.string().min(1) }).strict()),
  warnings: z.array(z.object({ code: idSchema, explanation: z.string().min(1) }).strict()),
}).strict().superRefine((plan, ctx) => {
  if (plan.supersedes && plan.supersedes.planId === plan.planId && plan.revision <= plan.supersedes.revision)
    ctx.addIssue({ code: 'custom', path: ['revision'], message: 'A replacement revision must be newer' });
  if (plan.targetArrivalChargePercent < plan.minimumReserveChargePercent ||
      plan.estimatedArrivalChargePercent < plan.targetArrivalChargePercent)
    ctx.addIssue({ code: 'custom', path: ['estimatedArrivalChargePercent'], message: 'Plan fails reserve or arrival target' });
  const road = plan.roadRoute.segments;
  if (road.length !== plan.energySegments.length ||
      road.some((segment, index) => segment.id !== plan.energySegments[index]?.segmentId))
    ctx.addIssue({ code: 'custom', path: ['energySegments'], message: 'Energy segments must match road order exactly' });
  for (const [index, segment] of plan.energySegments.entries()) {
    if (segment.minimumChargePercent < plan.minimumReserveChargePercent)
      ctx.addIssue({ code: 'custom', path: ['energySegments', index], message: 'Predicted battery reserve is violated' });
    if (segment.departureAt && segment.arrivalAt && road[index] &&
        Math.abs((Date.parse(segment.arrivalAt) - Date.parse(segment.departureAt)) / 1000 - road[index].drivingDurationSeconds) > 1)
      ctx.addIssue({ code: 'custom', path: ['energySegments', index], message: 'Energy timing differs from road duration' });
  }
  const stops = plan.chargingStops;
  if (!stops.every((stop, index) => index === 0 || stop.routeDistanceMeters >= stops[index - 1].routeDistanceMeters))
    ctx.addIssue({ code: 'custom', path: ['chargingStops'], message: 'Charging stops must follow route distance order' });
  const boundaries = [0, ...road.map((segment) => segment.endDistanceMeters)];
  for (const stop of stops) {
    if (stop.routeDistanceMeters >= plan.roadRoute.distanceMeters)
      ctx.addIssue({ code: 'custom', path: ['chargingStops'], message: 'Charging after destination arrival cannot satisfy arrival SOC' });
    if (!boundaries.some((distance) => Math.abs(stop.routeDistanceMeters - distance) <= 0.001))
      ctx.addIssue({ code: 'custom', path: ['chargingStops'], message: 'Split road segments at each charging stop' });
    if (stop.routeDistanceMeters > 0 && stop.arrivalChargePercent < plan.minimumReserveChargePercent)
      ctx.addIssue({ code: 'custom', path: ['chargingStops'], message: 'Charging arrival violates reserve' });
  }
  const d = plan.duration;
  const charge = stops.reduce((sum, stop) => sum + stop.chargingDurationSeconds, 0);
  const connection = stops.reduce((sum, stop) => sum + stop.connectionDurationSeconds, 0);
  const preconditioning = stops.reduce((sum, stop) => sum + stop.blockingPreconditioningSeconds, 0);
  if (Math.abs(d.drivingSeconds - plan.roadRoute.drivingDurationSeconds) > 0.001 ||
      Math.abs(d.chargingSeconds - charge) > 0.001 || Math.abs(d.connectionSeconds - connection) > 0.001 ||
      Math.abs(d.blockingPreconditioningSeconds - preconditioning) > 0.001)
    ctx.addIssue({ code: 'custom', path: ['duration'], message: 'Duration components do not match route and stops' });
  const waitUnknown = stops.some((stop) => stop.waiting.seconds === null);
  if (waitUnknown !== (d.waitingSeconds === null))
    ctx.addIssue({ code: 'custom', path: ['duration'], message: 'Unknown stop waiting must propagate to the total' });
  if (!waitUnknown && d.waitingSeconds !== stops.reduce((sum, stop) => sum + (stop.waiting.seconds ?? 0), 0))
    ctx.addIssue({ code: 'custom', path: ['duration'], message: 'Waiting total does not match stops' });
  if (d.waitingSeconds === null) {
    if (d.totalSeconds !== null || plan.estimatedArrivalAt !== null)
      ctx.addIssue({ code: 'custom', path: ['duration'], message: 'Do not present a precise total/ETA with unknown waiting' });
  } else if (d.totalSeconds === null ||
      Math.abs(d.totalSeconds - d.drivingSeconds - d.chargingSeconds - d.connectionSeconds
        - d.blockingPreconditioningSeconds - d.waitingSeconds) > 0.001)
    ctx.addIssue({ code: 'custom', path: ['duration'], message: 'Total duration double-counts or omits time' });
  if (plan.energySegments.length &&
      Math.abs(plan.energySegments[plan.energySegments.length - 1].endChargePercent - plan.estimatedArrivalChargePercent) > 0.001)
    ctx.addIssue({ code: 'custom', path: ['estimatedArrivalChargePercent'], message: 'Final segment SOC differs from arrival SOC' });
});

export const planningResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('planned'), plan: routePlanSchema }).strict(),
  z.object({
    status: z.enum(['infeasible', 'insufficient_data', 'provider_error', 'computation_limit']),
    requestId: z.string().uuid(),
    reasons: z.array(z.object({ code: idSchema, explanation: z.string().min(1) }).strict()).min(1),
  }).strict(),
]);

export type EnergySegment = z.infer<typeof energySegmentSchema>;
export type RoutePlan = z.infer<typeof routePlanSchema>;
export type PlanningInput = z.infer<typeof planningInputSchema>;
export type PlanningResult = z.infer<typeof planningResultSchema>;
