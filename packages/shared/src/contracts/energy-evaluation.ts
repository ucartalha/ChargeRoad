import {z} from 'zod';
import {timestampSchema,idSchema,nonnegativeSchema,positiveSchema,finiteSchema,percentSchema} from './common.js';
import {roadRouteSchema,weatherForecastSchema} from './road-weather.js';
import {vehicleEnergyProfileSchema} from './vehicle-energy.js';
import {routePlanRequestSchema} from './request.js';
import {energySegmentSchema} from './planning.js';

export const energyEvaluationRequestSchema=z.object({request:routePlanRequestSchema,vehicle:vehicleEnergyProfileSchema,
  route:roadRouteSchema,weather:z.array(weatherForecastSchema).max(10000),evaluatedAt:timestampSchema}).strict();
export const energyAuditSchema=z.object({segmentId:idSchema,mode:z.enum(['physics','reference_corrected']),
  referenceKwh:nonnegativeSchema,referenceRoadLoadKwh:nonnegativeSchema,referenceIncludedAuxiliaryKwh:nonnegativeSchema,
  roadLoadDrawKwh:nonnegativeSchema,referenceResidualKwh:nonnegativeSchema,
  baseAuxiliaryKwh:nonnegativeSchema,cabinKwh:nonnegativeSchema,batteryThermalKwh:nonnegativeSchema,
  availableBrakingKwh:nonnegativeSchema,regeneratedKwh:nonnegativeSchema,frictionBrakingKwh:nonnegativeSchema,
  wheelPositiveKwh:nonnegativeSchema,driveLossKwh:nonnegativeSchema,
  recoveryLossKwh:nonnegativeSchema,discardedRecoveryKwh:nonnegativeSchema,
  meanSpeedKph:nonnegativeSchema,airDensityKgPerM3:positiveSchema.nullable(),
  integrationSteps:z.number().int().nonnegative(),referenceIds:z.array(idSchema)}).strict();
export const energyEvaluationResultSchema=z.object({
  status:z.enum(['estimated','charge_required','insufficient_data','computation_limit']),
  requestId:z.string().uuid(),routeId:idSchema,algorithmVersion:idSchema,inputChecksumSha256:z.string().regex(/^[a-f0-9]{64}$/),
  vehicleProfileId:idSchema,vehicleProfileVersion:idSchema,modelId:idSchema.nullable(),modelVersion:idSchema.nullable(),
  capacityKwh:positiveSchema.nullable(),segments:z.array(energySegmentSchema),audit:z.array(energyAuditSchema),
  netBatteryEnergyKwh:finiteSchema,finalChargePercent:percentSchema.nullable(),minimumChargePercent:percentSchema.nullable(),
  completedDistanceMeters:nonnegativeSchema,referenceIds:z.array(idSchema),
  partialSegmentId:idSchema.nullable(),
  reasons:z.array(z.object({code:idSchema,segmentId:idSchema.nullable()}).strict()),
  assumptions:z.array(z.string()),warnings:z.array(z.string()),
}).strict().superRefine((result,ctx)=>{
  const issue=(message:string)=>ctx.addIssue({code:'custom',message});
  if(result.segments.length!==result.audit.length||result.segments.some((s,i)=>s.segmentId!==result.audit[i]?.segmentId))issue('Audit must align with energy segments');
  if(Math.abs(result.segments.reduce((sum,s)=>sum+s.netBatteryEnergyKwh,0)-result.netBatteryEnergyKwh)>1e-8)issue('Total battery energy must equal the segment sum');
  for(const [i,s]of result.segments.entries()){
    const a=result.audit[i];if(!a)continue;
    if(Math.abs(a.roadLoadDrawKwh+a.referenceResidualKwh+a.baseAuxiliaryKwh+a.cabinKwh+a.batteryThermalKwh-a.regeneratedKwh-s.netBatteryEnergyKwh)>1e-8)
      issue('Audited energy must balance');
    if(Math.abs(a.availableBrakingKwh-a.frictionBrakingKwh-a.regeneratedKwh-a.recoveryLossKwh)>1e-8)issue('Braking energy must be conserved');
    if(result.capacityKwh&&Math.abs((s.startChargePercent-s.endChargePercent)*result.capacityKwh/100-s.netBatteryEnergyKwh)>1e-8)issue('SOC must balance against the effective capacity');
    if(i&&Math.abs(result.segments[i-1].endChargePercent-s.startChargePercent)>1e-8)issue('SOC timeline must be continuous');
  }
  if(result.segments.length&&Math.abs(result.segments.at(-1)!.endChargePercent-result.finalChargePercent!)>1e-8)issue('Final SOC must match the last segment');
  if(result.status==='estimated'&&result.partialSegmentId!==null)issue('An estimated full route cannot contain a partial segment');
});
export type EnergyEvaluationRequest=z.infer<typeof energyEvaluationRequestSchema>;
export type EnergyEvaluationResult=z.infer<typeof energyEvaluationResultSchema>;
export type EnergyAudit=z.infer<typeof energyAuditSchema>;
