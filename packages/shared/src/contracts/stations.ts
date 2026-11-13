import { z } from 'zod';
import {
  connectorStandardSchema, coordinateSchema, idSchema, numericObservationSchema,
  positiveRangeSchema, positiveSchema, sourceReferenceSchema, timestampSchema,
} from './common.js';

export const stationAvailabilitySchema = z.enum([
  'available', 'occupied', 'reserved', 'blocked', 'out_of_service', 'unknown',
]);
export const availabilityObservationSchema = z.object({
  reportedStatus: stationAvailabilitySchema,
  sourceObservedAt: timestampSchema.nullable(),
  receivedAt: timestampSchema,
  source: sourceReferenceSchema,
}).strict();

const dcConnectorSchema = z.object({
  id: idSchema,
  powerType: z.literal('dc'),
  permissionBasis:z.literal('public_service').optional(),
  standard: connectorStandardSchema,
  maxPowerKw: positiveSchema.nullable(),
  maxCurrentA: positiveSchema.nullable(),
  outputVoltageRangeV: positiveRangeSchema.nullable(),
  powerEnvelope: z.array(z.object({
    voltageV: positiveSchema,
    maxCurrentA: positiveSchema,
    maxPowerKw: positiveSchema,
  }).strict()),
  powerEnvelopeInterpolation:z.literal('linear').optional(),
  source: sourceReferenceSchema,
}).strict();
const acConnectorSchema = z.object({
  id: idSchema,
  powerType: z.literal('ac'),
  standard: connectorStandardSchema,
  maxPowerKw: positiveSchema.nullable(),
  phases: z.union([z.literal(1), z.literal(3)]).nullable(),
  voltageV: positiveSchema.nullable(),
  maxCurrentA: positiveSchema.nullable(),
  source: sourceReferenceSchema,
}).strict();
export const stationConnectorSchema = z.discriminatedUnion('powerType', [dcConnectorSchema, acConnectorSchema]);

export const evseSchema = z.object({
  id: idSchema,
  identityBasis:z.enum(['provider_evse','catalogue_scenario']).optional(),
  availability: availabilityObservationSchema,
  sharedPowerPoolId: idSchema.nullable(),
  connectors: z.array(stationConnectorSchema).min(1),
}).strict().refine((evse) => new Set(evse.connectors.map((connector) => connector.id)).size === evse.connectors.length,
  'Duplicate connector ID within EVSE');

const openingIntervalSchema = z.object({
  fromMinuteOfDay: z.number().int().min(0).max(1439),
  toMinuteOfDay: z.number().int().min(1).max(1440),
}).strict().refine((interval) => interval.fromMinuteOfDay < interval.toMinuteOfDay,
  'Split overnight opening intervals across calendar days');
const openingDaySchema = z.object({
  isoWeekday: z.number().int().min(1).max(7),
  intervals: z.array(openingIntervalSchema),
}).strict();
export const chargingStationSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  location: coordinateSchema,
  operatorId: idSchema.nullable(),
  evses: z.array(evseSchema),
  sharedPowerPools: z.array(z.object({
    id: idSchema,
    ratedTotalPowerKw: positiveSchema.nullable(),
    availablePowerKw: numericObservationSchema.refine(
      (signal) => signal.value === null || signal.value >= 0, 'Available power cannot be negative'),
  }).strict()),
  access: z.object({
    publicAccess: z.boolean().nullable(),
    membershipRequired: z.boolean().nullable(),
    openingHours: z.object({
      timezone: z.string().min(1),
      weekly: z.array(openingDaySchema),
      exceptions: z.array(z.object({
        date: z.iso.date(),
        intervals: z.array(openingIntervalSchema),
      }).strict()),
    }).strict().nullable(),
  }).strict(),
  source: sourceReferenceSchema,
}).strict().superRefine((station, ctx) => {
  const pools = new Set(station.sharedPowerPools.map((pool) => pool.id));
  if (pools.size !== station.sharedPowerPools.length || new Set(station.evses.map((evse) => evse.id)).size !== station.evses.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate EVSE or power pool ID' });
  for (const evse of station.evses) {
    if (evse.sharedPowerPoolId && !pools.has(evse.sharedPowerPoolId))
      ctx.addIssue({ code: 'custom', path: ['evses'], message: 'EVSE references an unknown power pool' });
  }
  for (const pool of station.sharedPowerPools) {
    if (pool.availablePowerKw.value !== null && pool.ratedTotalPowerKw !== null &&
        pool.availablePowerKw.value > pool.ratedTotalPowerKw)
      ctx.addIssue({ code: 'custom', path: ['sharedPowerPools'], message: 'Available power exceeds pool rating' });
  }
  const hours = station.access.openingHours;
  if (hours && new Set(hours.weekly.map((day) => day.isoWeekday)).size !== hours.weekly.length)
    ctx.addIssue({ code: 'custom', path: ['access', 'openingHours'], message: 'Duplicate opening weekday' });
});

export type StationAvailability = z.infer<typeof stationAvailabilitySchema>;
export type ChargingStation = z.infer<typeof chargingStationSchema>;
export type Evse = z.infer<typeof evseSchema>;
export type StationConnector = z.infer<typeof stationConnectorSchema>;
