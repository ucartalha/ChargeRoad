import {z} from 'zod';
import {finiteSchema,idSchema,nonnegativeSchema,numberRangeSchema,percentSchema,positiveSchema,sourceReferenceSchema,strictlyIncreasing} from './common.js';

// All coefficients are explicit, source-backed vehicle calibration, never universal defaults.
export const energyModelSchema=z.object({
  id:idSchema,version:idSchema,quality:z.enum(['verified','engineering_estimate']),source:sourceReferenceSchema,
  verificationNote:z.string().min(1),assumptions:z.array(z.string().min(1)),
  tireSetupId:idSchema.nullable(),referenceTireDescription:z.string().min(1).nullable(),
  mode:z.enum(['physics','reference_corrected']),
  speedPolicy:z.enum(['require_speed_trace','allow_travel_average_proxy']),
  ambientRangeC:numberRangeSchema,
  referenceAirDensityKgPerM3:positiveSchema.nullable(),
  referenceCabinKw:nonnegativeSchema.nullable(),referenceBatteryThermalKw:nonnegativeSchema.nullable(),
  baseAuxiliaryKw:nonnegativeSchema,
  cabin:z.object({heatKwPerDegree:nonnegativeSchema,coolKwPerDegree:nonnegativeSchema,maxKw:nonnegativeSchema}).strict(),
  batteryThermalKw:nonnegativeSchema,
  regeneration:z.object({efficiency:nonnegativeSchema.max(1),temperatureRangeC:numberRangeSchema,
    taperStartSocPercent:percentSchema,zeroAtSocPercent:percentSchema}).strict(),
  rotationalMassFactor:positiveSchema.min(1).max(2),maxTractionBatteryKw:positiveSchema.nullable(),
  wetRollingMultiplier:positiveSchema.min(1).nullable(),snowRollingMultiplier:positiveSchema.min(1).nullable(),
  capacityTemperatureCurve:z.array(z.object({temperatureC:finiteSchema,factor:positiveSchema.max(1)}).strict()).min(2).nullable(),
  passiveThermal:z.object({heatCapacityKwhPerC:positiveSchema,conductanceKwPerC:nonnegativeSchema}).strict().nullable(),
  unknowns:z.object({payloadKg:nonnegativeSchema.nullable(),sohPercent:positiveSchema.max(100).nullable(),
    cabinTargetC:finiteSchema.nullable(),hvacKw:nonnegativeSchema.nullable(),
    capacityTemperatureFactor:positiveSchema.max(1).nullable(),airDensityKgPerM3:positiveSchema.nullable(),
    allowFlatElevation:z.boolean()}).strict(),
}).strict().superRefine((model,ctx)=>{
  if(model.regeneration.taperStartSocPercent>=model.regeneration.zeroAtSocPercent)
    ctx.addIssue({code:'custom',path:['regeneration'],message:'Regeneration SOC taper must have positive width'});
  if(model.capacityTemperatureCurve&&!strictlyIncreasing(model.capacityTemperatureCurve.map(p=>p.temperatureC)))
    ctx.addIssue({code:'custom',path:['capacityTemperatureCurve'],message:'Capacity temperatures must increase strictly'});
  if(!model.source.license)ctx.addIssue({code:'custom',path:['source'],message:'Energy calibration requires recorded usage rights'});
});
export type EnergyModel=z.infer<typeof energyModelSchema>;
