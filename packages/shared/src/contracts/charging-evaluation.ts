import {z} from 'zod';
import {idSchema,nonnegativeSchema,numericObservationSchema,percentSchema,positiveSchema,timestampSchema,finiteSchema} from './common.js';
import {vehicleEnergyProfileSchema} from './vehicle-energy.js';
import {chargingStationSchema} from './stations.js';
import {usableCapacitySnapshotSchema} from './capacity.js';

export const chargingEvaluationRequestSchema=z.object({
  vehicle:vehicleEnergyProfileSchema,station:chargingStationSchema,capacity:usableCapacitySnapshotSchema,
  evseId:idSchema,connectorId:idSchema,curveId:idSchema,arrivalSocPercent:percentSchema,targetSocPercent:percentSchema,
  qualityPolicy:z.enum(['verified_only','allow_engineering_estimates']),evaluatedAt:timestampSchema,
  hardwarePolicy:z.enum(['verified_hardware','catalogue_power_scenario']).optional(),
  batteryTemperatureAtStartC:numericObservationSchema,ambientTemperatureC:finiteSchema.nullable(),
  preconditioning:z.enum(['completed','active','not_used','unknown']),
  sharedPowerAllocation:z.object({poolId:idSchema,powerKw:nonnegativeSchema,observedAt:timestampSchema,sourceId:idSchema}).strict().nullable(),
  timing:z.object({arrivalAt:timestampSchema.nullable(),connectionSeconds:nonnegativeSchema,waitingSeconds:nonnegativeSchema.nullable(),
    blockingPreconditioningSeconds:z.literal(0)}).strict(),
}).strict().refine(r=>r.targetSocPercent>=r.arrivalSocPercent,'Charging target cannot be below arrival SOC');
export const chargingIntervalSchema=z.object({fromSocPercent:percentSchema,toSocPercent:percentSchema,
  seconds:nonnegativeSchema,storedKwh:nonnegativeSchema,inletKwh:nonnegativeSchema,auxiliaryKwh:nonnegativeSchema,lossKwh:nonnegativeSchema,
  minInletKw:nonnegativeSchema,maxInletKw:nonnegativeSchema,limiter:idSchema}).strict().superRefine((r,ctx)=>{
    if(r.toSocPercent<=r.fromSocPercent||r.seconds<=0||r.minInletKw>r.maxInletKw||Math.abs(r.inletKwh-r.storedKwh-r.auxiliaryKwh-r.lossKwh)>1e-6)
      ctx.addIssue({code:'custom',message:'Charging interval must progress and conserve energy'});
  });
export const chargingEvaluationResultSchema=z.object({
  status:z.enum(['estimated','no_charge_required','incompatible','unreachable','insufficient_data','computation_limit']),
  dataQuality:z.enum(['verified','engineering_estimate','unknown']),
  algorithmVersion:idSchema,inputChecksumSha256:z.string().regex(/^[a-f0-9]{64}$/),
  vehicleProfileId:idSchema,vehicleProfileVersion:idSchema,modelId:idSchema.nullable(),modelVersion:idSchema.nullable(),
  stationId:idSchema,evseId:idSchema,connectorId:idSchema,curveId:idSchema,curveVersion:idSchema.nullable(),chargingPathId:idSchema.nullable(),
  arrivalSocPercent:percentSchema,targetSocPercent:percentSchema,effectiveBatteryCapacityKwh:positiveSchema,
  chargingSeconds:nonnegativeSchema.nullable(),energyStoredKwh:nonnegativeSchema.nullable(),energyDeliveredAtInletKwh:nonnegativeSchema.nullable(),
  auxiliaryEnergyKwh:nonnegativeSchema.nullable(),conversionLossKwh:nonnegativeSchema.nullable(),
  totalStopSeconds:nonnegativeSchema.nullable(),departureAt:timestampSchema.nullable(),
  batteryTemperatureAtDepartureC:numericObservationSchema,intervals:z.array(chargingIntervalSchema),
  evaluations:z.number().int().nonnegative(),assumptions:z.array(z.string()),warnings:z.array(z.string()),reasons:z.array(z.string()),
}).strict().superRefine((r,ctx)=>{
  const issue=(message:string)=>ctx.addIssue({code:'custom',message});
  if(r.status==='estimated'||r.status==='no_charge_required'){
    if([r.chargingSeconds,r.energyStoredKwh,r.energyDeliveredAtInletKwh,r.auxiliaryEnergyKwh,r.conversionLossKwh].some(v=>v===null))issue('Successful estimates require all energy/time totals');
    if(Math.abs(r.energyStoredKwh!-r.effectiveBatteryCapacityKwh*(r.targetSocPercent-r.arrivalSocPercent)/100)>1e-6)issue('Stored energy must match SOC and capacity');
    if(Math.abs(r.energyDeliveredAtInletKwh!-r.energyStoredKwh!-r.auxiliaryEnergyKwh!-r.conversionLossKwh!)>1e-6)issue('Inlet energy must balance');
    if(Math.abs(r.intervals.reduce((n,p)=>n+p.seconds,0)-r.chargingSeconds!)>.001)issue('Charging intervals must sum to elapsed time');
    for(const [key,total] of [['storedKwh',r.energyStoredKwh],['inletKwh',r.energyDeliveredAtInletKwh],['auxiliaryKwh',r.auxiliaryEnergyKwh],['lossKwh',r.conversionLossKwh]] as const)
      if(Math.abs(r.intervals.reduce((sum,p)=>sum+p[key],0)-total!)>1e-6)issue('Charging interval energies must sum to totals');
    if(r.status==='no_charge_required'&&(r.arrivalSocPercent!==r.targetSocPercent||r.chargingSeconds!==0||r.intervals.length))issue('No-charge result cannot change SOC');
    if(r.status==='estimated'&&(r.targetSocPercent<=r.arrivalSocPercent||!r.intervals.length))issue('Estimated charge must progress');
    if(r.intervals.length&&(Math.abs(r.intervals[0].fromSocPercent-r.arrivalSocPercent)>1e-8||Math.abs(r.intervals.at(-1)!.toSocPercent-r.targetSocPercent)>1e-8||
      r.intervals.some((p,i)=>i>0&&Math.abs(p.fromSocPercent-r.intervals[i-1].toSocPercent)>1e-8)))issue('Charging intervals must cover the complete SOC interval without gaps');
  }else if([r.chargingSeconds,r.energyStoredKwh,r.energyDeliveredAtInletKwh,r.auxiliaryEnergyKwh,r.conversionLossKwh,r.totalStopSeconds,r.departureAt].some(v=>v!==null))
    issue('Incomplete estimates cannot publish complete totals');
});
export type ChargingEvaluationRequest=z.infer<typeof chargingEvaluationRequestSchema>;
export type ChargingEvaluationResult=z.infer<typeof chargingEvaluationResultSchema>;
export type ChargingInterval=z.infer<typeof chargingIntervalSchema>;
