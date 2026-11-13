import { z } from 'zod';
import {
  coordinateSchema, idSchema, nonnegativeSchema, numericObservationSchema,
  percentRangeSchema, percentSchema, positiveSchema, timestampSchema,
} from './common.js';
import { stationAvailabilitySchema } from './stations.js';

export const chargingStopSchema = z.object({
  id: idSchema,
  stationId: idSchema,
  evseId: idSchema,
  connectorId: idSchema,
  chargingPathId: idSchema,
  hardwareBasis:z.enum(['verified_hardware','catalogue_power_scenario']).optional(),
  location: coordinateSchema,
  routeDistanceMeters: nonnegativeSchema,
  detourDistanceMeters: nonnegativeSchema.nullable(),
  detourDrivingSeconds: nonnegativeSchema.nullable(),
  detourBasis:z.literal('included_in_road_not_separately_quantified').optional(),
  arrivalChargePercent: percentSchema,
  chargeStartPercent:percentSchema.optional(),connectionBatteryEnergyKwh:nonnegativeSchema.optional(),
  targetChargePercent: percentSchema,
  effectiveBatteryCapacityKwh: positiveSchema,
  energyDeliveredAtInletKwh: positiveSchema,
  energyStoredKwh: positiveSchema,
  auxiliaryEnergyKwh: nonnegativeSchema,
  conversionLossKwh: nonnegativeSchema,
  curveReference: z.object({
    id: idSchema, version: idSchema,
    coveredSocPercent: percentRangeSchema,
    extrapolation: z.literal('forbidden'),
  }).strict(),
  batteryTemperatureAtArrivalC: numericObservationSchema,
  batteryTemperatureAtChargeStartC:numericObservationSchema.optional(),
  batteryTemperatureAtDepartureC: numericObservationSchema,
  thermalModelVersion: idSchema.nullable(),
  chargingDurationSeconds: positiveSchema,
  connectionDurationSeconds: nonnegativeSchema,
  blockingPreconditioningSeconds: nonnegativeSchema,
  waiting: z.object({
    basis: z.enum(['none_needed', 'operator_forecast', 'historical_model', 'policy_assumption', 'unknown']),
    seconds: nonnegativeSchema.nullable(),
    justificationId: idSchema.nullable(),
  }).strict(),
  arrivalAt: timestampSchema.nullable(),
  departureAt: timestampSchema.nullable(),
  availabilitySnapshot: z.object({
    reportedStatus: stationAvailabilitySchema,
    effectiveStatus: stationAvailabilitySchema,
    sourceObservedAt: timestampSchema.nullable(),
    receivedAt: timestampSchema,
    evaluatedAt: timestampSchema,
    maxAgeSeconds: positiveSchema,
    sourceId: idSchema,
  }).strict(),
}).strict().superRefine((stop, ctx) => {
  if((stop.detourDistanceMeters===null||stop.detourDrivingSeconds===null)&&stop.detourBasis!=='included_in_road_not_separately_quantified')
    ctx.addIssue({code:'custom',path:['detourBasis'],message:'Unknown separate detour needs explicit actual-road accounting'});
  if (stop.targetChargePercent <= stop.arrivalChargePercent)
    ctx.addIssue({ code: 'custom', path: ['targetChargePercent'], message: 'A charging stop must increase state of charge' });
  if ((stop.chargeStartPercent??stop.arrivalChargePercent) < stop.curveReference.coveredSocPercent.min ||
      stop.targetChargePercent > stop.curveReference.coveredSocPercent.max)
    ctx.addIssue({ code: 'custom', path: ['curveReference'], message: 'Charging outside reference coverage is forbidden' });
  if(stop.chargeStartPercent!==undefined&&(Math.abs((stop.arrivalChargePercent-stop.chargeStartPercent)*stop.effectiveBatteryCapacityKwh/100-(stop.connectionBatteryEnergyKwh??0))>1e-6||
    Math.abs((stop.targetChargePercent-stop.chargeStartPercent)*stop.effectiveBatteryCapacityKwh/100-stop.energyStoredKwh)>1e-6))
    ctx.addIssue({code:'custom',path:['chargeStartPercent'],message:'Connection discharge and actual charging SOC must conserve energy'});
  if (Math.abs(stop.energyDeliveredAtInletKwh - stop.energyStoredKwh - stop.auxiliaryEnergyKwh - stop.conversionLossKwh) > 0.001)
    ctx.addIssue({ code: 'custom', path: ['energyStoredKwh'], message: 'Stored, auxiliary and lost energy must balance inlet energy' });
  if (stop.energyStoredKwh > stop.effectiveBatteryCapacityKwh)
    ctx.addIssue({ code: 'custom', path: ['energyStoredKwh'], message: 'Stored energy exceeds usable capacity' });
  if ((stop.waiting.basis === 'unknown') !== (stop.waiting.seconds === null))
    ctx.addIssue({ code: 'custom', path: ['waiting'], message: 'Unknown waiting time must remain null' });
  if (stop.waiting.basis === 'none_needed' && stop.waiting.seconds !== 0)
    ctx.addIssue({ code: 'custom', path: ['waiting'], message: 'No-wait estimate must be zero' });
  if (['historical_model', 'policy_assumption'].includes(stop.waiting.basis) && !stop.waiting.justificationId)
    ctx.addIssue({ code: 'custom', path: ['waiting'], message: 'Model or assumption provenance is required' });
  if (stop.waiting.seconds === null && stop.departureAt !== null)
    ctx.addIssue({ code: 'custom', path: ['departureAt'], message: 'Unknown waiting time cannot produce a definite departure' });
  if (stop.arrivalAt === null && stop.departureAt !== null)
    ctx.addIssue({ code: 'custom', path: ['departureAt'], message: 'Departure requires a known arrival' });
  if (stop.arrivalAt && stop.departureAt && stop.waiting.seconds !== null) {
    const expected = stop.chargingDurationSeconds + stop.connectionDurationSeconds
      + stop.blockingPreconditioningSeconds + stop.waiting.seconds;
    if (Math.abs((Date.parse(stop.departureAt) - Date.parse(stop.arrivalAt)) / 1000 - expected) > 1)
      ctx.addIssue({ code: 'custom', path: ['departureAt'], message: 'Stop timeline does not match non-overlapping durations' });
  }
  const status = stop.availabilitySnapshot;
  const age = status.sourceObservedAt === null ? Infinity
    : (Date.parse(status.evaluatedAt) - Date.parse(status.sourceObservedAt)) / 1000;
  const stale = age < 0 || age > status.maxAgeSeconds;
  if (stale && status.effectiveStatus !== 'unknown')
    ctx.addIssue({ code: 'custom', path: ['availabilitySnapshot'], message: 'Stale, future-dated or undated availability must be unknown' });
  if (!stale && status.effectiveStatus !== status.reportedStatus)
    ctx.addIssue({ code: 'custom', path: ['availabilitySnapshot'], message: 'Fresh effective status must match the reported status' });
});

export type PlannedChargingStop = z.infer<typeof chargingStopSchema>;
