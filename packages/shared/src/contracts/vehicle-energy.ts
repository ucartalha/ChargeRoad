import { z } from 'zod';
import {
  connectorStandardSchema, finiteSchema, idSchema, nonnegativeSchema, numberRangeSchema, percentRangeSchema,
  percentSchema, positiveRangeSchema, positiveSchema, sourceReferenceSchema, strictlyIncreasing,
} from './common.js';

const effectSchema = z.enum(['included', 'excluded', 'unknown']);
export const consumptionReferenceSchema = z.object({
  id: idSchema,
  vehicleVariantId: idSchema,
  version: idSchema,
  valueKwhPer100Km: positiveSchema,
  energyBoundary: z.enum(['battery_dc', 'ac_grid', 'unknown']),
  basis: z.enum(['manufacturer_declared', 'measured', 'derived']),
  testCycle: z.enum(['wltp', 'epa', 'nedc', 'cltc', 'constant_speed', 'real_world', 'unspecified']),
  drivingProfile: z.enum(['city', 'highway', 'mixed', 'unknown']),
  conditions: z.object({
    meanSpeedKph: nonnegativeSchema.nullable(),
    ambientTemperatureC: numberRangeSchema.nullable(),
    batteryTemperatureC: numberRangeSchema.nullable(),
    payloadKg: nonnegativeSchema.nullable(),
    windSpeedKph: nonnegativeSchema.nullable(),
    elevationGainMetersPer100Km: nonnegativeSchema.nullable(),
    tireDescription: z.string().min(1).nullable(),
  }).strict(),
  includedEffects: z.object({
    cabinHvac: effectSchema,
    batteryThermalManagement: effectSchema,
    elevation: effectSchema,
    wind: effectSchema,
    chargingLosses: effectSchema,
  }).strict(),
  batteryDcConversion: z.object({
    gridToBatteryEfficiency: positiveSchema.max(1),
    source: sourceReferenceSchema,
  }).strict().nullable(),
  source: sourceReferenceSchema,
}).strict().superRefine((reference, ctx) => {
  if (reference.testCycle === 'constant_speed' && !(reference.conditions.meanSpeedKph && reference.conditions.meanSpeedKph > 0))
    ctx.addIssue({ code: 'custom', path: ['conditions', 'meanSpeedKph'], message: 'Constant-speed reference requires a speed' });
  if (reference.energyBoundary !== 'ac_grid' && reference.batteryDcConversion !== null)
    ctx.addIssue({ code: 'custom', path: ['batteryDcConversion'], message: 'Conversion is only valid for AC-grid references' });
});

export const voltageBySocSchema = z.object({
  id: idSchema,
  voltageBoundary: z.enum(['charging_inlet', 'pack_terminal', 'open_circuit']),
  points: z.array(z.object({ socPercent: percentSchema, voltageV: positiveSchema }).strict()).min(2),
  batteryTemperatureC: numberRangeSchema.nullable(),
  source: sourceReferenceSchema,
}).strict().refine((curve) => strictlyIncreasing(curve.points.map((point) => point.socPercent)),
  'Voltage points must have strictly increasing state of charge');

export const dcChargingPathSchema = z.object({
  id: idSchema,
  mode: z.enum(['native_pack', 'boost_converter', 'pack_reconfiguration']),
  inletVoltageRangeV: positiveRangeSchema.nullable(),
  inletVoltageBySoc: voltageBySocSchema.nullable(),
  maxInletPowerKw: positiveSchema.nullable(),
  maxInletCurrentA: positiveSchema.nullable(),
  conversionEfficiency: positiveSchema.max(1).nullable(),
  source: sourceReferenceSchema,
}).strict().superRefine((path, ctx) => {
  if (path.inletVoltageBySoc && path.inletVoltageBySoc.voltageBoundary !== 'charging_inlet')
    ctx.addIssue({ code: 'custom', path: ['inletVoltageBySoc'], message: 'Open-circuit or pack voltage is not inlet voltage' });
  if (path.inletVoltageRangeV && path.inletVoltageBySoc &&
      path.inletVoltageBySoc.points.some((point) =>
        point.voltageV < path.inletVoltageRangeV!.min || point.voltageV > path.inletVoltageRangeV!.max))
    ctx.addIssue({ code: 'custom', path: ['inletVoltageBySoc'], message: 'Inlet voltage profile is outside the supported range' });
});

const curvePointBase = {
  socPercent: percentSchema,
  batteryTemperatureC: finiteSchema.nullable(),
};
const powerCurveSchema = z.object({
  representation: z.literal('power_by_soc'),
  points: z.array(z.object({
    ...curvePointBase, powerKw: nonnegativeSchema, voltageV: positiveSchema.nullable(),
  }).strict()).min(2),
}).strict();
const currentCurveSchema = z.object({
  representation: z.literal('current_by_soc'),
  points: z.array(z.object({
    ...curvePointBase, currentA: nonnegativeSchema, voltageV: positiveSchema,
  }).strict()).min(2),
}).strict();

export const dcChargingCurveSchema = z.object({
  id: idSchema,
  version: idSchema,
  vehicleVariantId: idSchema,
  chargingPathId: idSchema,
  semantics: z.enum(['vehicle_acceptance_limit', 'observed_station_session']),
  powerBoundary: z.enum(['vehicle_inlet', 'pack_terminal', 'battery_stored']),
  curve: z.discriminatedUnion('representation', [powerCurveSchema, currentCurveSchema]),
  interpolation: z.literal('linear'),
  extrapolation: z.literal('forbidden'),
  conditions: z.object({
    batteryTemperatureC: numberRangeSchema.nullable(),
    ambientTemperatureC: numberRangeSchema.nullable(),
    stateOfHealthPercent: percentRangeSchema.nullable(),
    preconditioning: z.enum(['completed', 'active', 'not_used', 'unknown']),
    evseMaxPowerKw: positiveSchema.nullable(),
    evseMaxCurrentA: positiveSchema.nullable(),
    evseVoltageRangeV: positiveRangeSchema.nullable(),
    thermalAuxiliariesIncluded: effectSchema,
    conversionLossesIncluded: effectSchema,
  }).strict(),
  source: sourceReferenceSchema,
}).strict().superRefine((curve, ctx) => {
  if (!strictlyIncreasing(curve.curve.points.map((point) => point.socPercent)))
    ctx.addIssue({ code: 'custom', path: ['curve', 'points'], message: 'SOC points must be strictly increasing; duplicate SOC is not allowed' });
  const hasPositivePower = curve.curve.representation === 'power_by_soc'
    ? curve.curve.points.some((point) => point.powerKw > 0)
    : curve.curve.points.some((point) => point.currentA > 0);
  if (!hasPositivePower) ctx.addIssue({ code: 'custom', path: ['curve'], message: 'Curve cannot be entirely zero' });
  if (curve.powerBoundary === 'battery_stored' && curve.curve.representation === 'current_by_soc')
    ctx.addIssue({ code: 'custom', path: ['powerBoundary'], message: 'V × I is electrical power, not net battery storage power' });
});

export const vehicleEnergyProfileSchema = z.object({
  dataQuality: z.object({
    schemaVersion:z.literal('vehicle-quality/1.0.0'),
    policy:z.enum(['verified_only','allow_engineering_estimates']),
    quality:z.enum(['verified','engineering_estimate']),
    verificationNote:z.string().min(1), assumptions:z.array(z.string().min(1)),
    methodId:idSchema.nullable(), methodVersion:idSchema.nullable(),
  }).strict().optional(),
  id: idSchema,
  version: idSchema,
  vehicleVariantId: idSchema,
  supportedConnectors: z.array(connectorStandardSchema).min(1),
  acMaxChargePowerKw: positiveSchema.nullable(),
  capacity: z.object({
    referenceUsableBatteryKwh: positiveSchema,
    atStateOfHealthPercent: positiveSchema.max(100),
    source: sourceReferenceSchema,
  }).strict(),
  voltageArchitecture: z.enum(['400v', '800v', 'other', 'unknown']),
  nominalPackVoltageV: positiveSchema.nullable(),
  thermalCapabilities: z.object({
    heatPump: z.enum(['present', 'absent', 'unknown']),
    batteryPreconditioning: z.enum(['supported', 'unsupported', 'unknown']),
  }).strict(),
  packVoltageBySoc: voltageBySocSchema.nullable(),
  dcChargingPaths: z.array(dcChargingPathSchema),
  consumptionReferences: z.array(consumptionReferenceSchema),
  dcChargingCurves: z.array(dcChargingCurveSchema),
  physics: z.object({
    curbMassKg: positiveSchema.nullable(),
    dragAreaSquareMeters: positiveSchema.nullable(),
    rollingResistanceCoefficient: positiveSchema.max(1).nullable(),
    drivetrainEfficiency: positiveSchema.max(1).nullable(),
    maxRegenerationKw: nonnegativeSchema.nullable(),
  }).strict(),
}).strict().superRefine((profile, ctx) => {
  const paths = new Set(profile.dcChargingPaths.map((path) => path.id));
  if (paths.size !== profile.dcChargingPaths.length)
    ctx.addIssue({ code: 'custom', path: ['dcChargingPaths'], message: 'Duplicate charging path ID' });
  const all = [...profile.consumptionReferences, ...profile.dcChargingCurves];
  if (new Set(all.map((entry) => entry.id)).size !== all.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate reference/curve ID' });
  for (const reference of all) {
    if (reference.vehicleVariantId !== profile.vehicleVariantId)
      ctx.addIssue({ code: 'custom', message: 'Reference belongs to a different vehicle variant' });
  }
  for (const curve of profile.dcChargingCurves) {
    if (!paths.has(curve.chargingPathId))
      ctx.addIssue({ code: 'custom', path: ['dcChargingCurves'], message: 'Curve references an unknown vehicle charging path' });
    const path = profile.dcChargingPaths.find((entry) => entry.id === curve.chargingPathId);
    if (path?.maxInletPowerKw && curve.powerBoundary === 'vehicle_inlet' &&
        curve.curve.representation === 'power_by_soc' &&
        curve.curve.points.some((point) => point.powerKw > path.maxInletPowerKw!))
      ctx.addIssue({ code: 'custom', path: ['dcChargingCurves'], message: 'Curve exceeds the declared input path power limit' });
  }
});

export type ConsumptionReference = z.infer<typeof consumptionReferenceSchema>;
export type DcChargingCurve = z.infer<typeof dcChargingCurveSchema>;
export type DcChargingPath = z.infer<typeof dcChargingPathSchema>;
export type VehicleEnergyProfile = z.infer<typeof vehicleEnergyProfileSchema>;
