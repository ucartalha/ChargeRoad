import { z } from 'zod';
import {
  contractVersionSchema, coordinateSchema, idSchema, nonnegativeSchema, numericObservationSchema,
  percentSchema, positiveSchema, timestampSchema,
} from './common.js';

export const planningPolicySchema = z.object({
  vehicleDataQuality: z.enum(['verified_only','allow_engineering_estimates']).optional(),
  id: idSchema,
  version: idSchema,
  objective: z.enum(['minimum_total_duration', 'minimum_energy', 'minimum_charging_stops']),
  availabilityMaxAgeSeconds: positiveSchema,
  forecastMaxAgeSeconds: positiveSchema,
  unknownAvailability: z.enum(['exclude', 'allow_with_documented_risk']),
  unknownWeather: z.enum(['reject', 'allow_with_documented_assumption']),
  missingChargingCurve: z.literal('report_insufficient_data'),
  maxIterations: z.number().int().positive(),
  maxComputationMilliseconds: z.number().int().positive(),
}).strict();

export const routePlanRequestSchema = z.object({
  schemaVersion: contractVersionSchema,
  requestId: z.string().uuid(),
  origin: coordinateSchema,
  destination: coordinateSchema,
  vehicleVariantId: idSchema,
  departureAt: timestampSchema,
  startingChargePercent: percentSchema,
  startingChargeSource: z.enum(['user_input', 'measured']),
  startingChargeObservedAt: timestampSchema,
  initialBatteryTemperatureC: numericObservationSchema,
  stateOfHealthPercent: numericObservationSchema.refine(
    (signal) => signal.value === null || (signal.value > 0 && signal.value <= 100),
    'Battery state of health must be in (0,100]'),
  operatingConditions: z.object({
    payloadKg: numericObservationSchema.refine((signal) => signal.value === null || signal.value >= 0, 'Payload cannot be negative'),
    cabinTargetTemperatureC: numericObservationSchema,
    hvacMode: z.enum(['off', 'heat', 'cool', 'auto', 'unknown']),
    batteryPreconditioning: z.enum(['requested', 'off', 'unknown']),
    tireSetupId: idSchema.nullable(),
  }).strict(),
  constraints: z.object({
    minimumReserveChargePercent: percentSchema,
    targetArrivalChargePercent: percentSchema,
  }).strict(),
  policy: planningPolicySchema,
}).strict().superRefine((request, ctx) => {
  if (request.constraints.targetArrivalChargePercent < request.constraints.minimumReserveChargePercent)
    ctx.addIssue({ code: 'custom', path: ['constraints'], message: 'Arrival target cannot be below the reserve' });
  if (Date.parse(request.startingChargeObservedAt) > Date.parse(request.departureAt))
    ctx.addIssue({ code: 'custom', path: ['startingChargeObservedAt'], message: 'Starting observation is later than departure' });
});

export const chargeCorrectionSchema = z.object({
  schemaVersion: contractVersionSchema,
  eventId: z.string().uuid(),
  tripId: idSchema,
  observedPlan: z.object({ planId: z.string().uuid(), revision: z.number().int().positive() }).strict(),
  sequence: z.number().int().positive(),
  origin: z.literal('user_input'),
  chargePercent: percentSchema,
  observedAt: timestampSchema,
  receivedAt: timestampSchema,
  location: coordinateSchema,
  locationObservedAt: timestampSchema,
  locationAccuracyMeters: nonnegativeSchema,
  reason: z.enum(['after_charging', 'in_trip_correction']),
  chargingStopId: idSchema.nullable(),
}).strict().refine((event) => event.reason !== 'after_charging' || event.chargingStopId !== null,
  'A post-charge correction must identify its charging stop');

export type PlanningPolicy = z.infer<typeof planningPolicySchema>;
export type RoutePlanRequest = z.infer<typeof routePlanRequestSchema>;
export type ChargeCorrection = z.infer<typeof chargeCorrectionSchema>;
