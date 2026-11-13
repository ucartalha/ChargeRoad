import {z} from 'zod';
import {idSchema,percentSchema,positiveSchema,nonnegativeSchema,timestampSchema,finiteSchema} from './common.js';
import {usableCapacitySnapshotSchema} from './capacity.js';
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const feedbackScopeSchema=z.object({vehicleVariantId:idSchema,configurationSha256:sha,
  referenceProfileId:idSchema,referenceProfileVersion:idSchema,referenceAlgorithmVersion:idSchema,
  conditionBucketSha256:sha,bucketPolicyVersion:idSchema}).strict();
const observation=z.object({value:percentSchema,observedAt:timestampSchema,
  origin:z.enum(['user_input','measured']),uncertaintyPercent:nonnegativeSchema.max(10)}).strict();
/** Trusted worker input, NOT an authenticated public endpoint request. */
export const socFeedbackSchema=z.object({schemaVersion:z.literal('soc-feedback/1.0.0'),id:idSchema,tripId:idSchema,
  ownerId:idSchema,drivingProfileId:idSchema,personalVehicleId:idSchema,consentRevisionId:idSchema,
  scope:feedbackScopeSchema,kind:z.enum(['driving_interval','post_charge','anchor_reset']),
  start:observation,end:observation,receivedAt:timestampSchema,distanceKm:positiveSchema,gpsCoverageRatio:finiteSchema.min(0).max(1),
  chargingOccurred:z.boolean(),baseline:z.object({planRevisionId:idSchema,inputChecksumSha256:sha,netBatteryEnergyKwh:positiveSchema,
    personalWeight:z.literal(0),cohortWeight:z.literal(0)}).strict(),capacity:usableCapacitySnapshotSchema,
  split:z.enum(['training','holdout'])}).strict().superRefine((r,ctx)=>{
    if(Date.parse(r.end.observedAt)<=Date.parse(r.start.observedAt)||Date.parse(r.receivedAt)<Date.parse(r.end.observedAt))
      ctx.addIssue({code:'custom',message:'Feedback interval must precede receipt and have positive duration'});
    if(r.capacity.vehicleVariantId!==r.scope.vehicleVariantId||r.capacity.vehicleProfileId!==r.scope.referenceProfileId||r.capacity.vehicleProfileVersion!==r.scope.referenceProfileVersion)
      ctx.addIssue({code:'custom',message:'Feedback capacity and unpersonalized reference must share a profile revision'});
  });
export const feedbackPolicySchema=z.object({id:idSchema,version:idSchema,stage:z.literal('offline_validation'),
  minTrips:z.number().int().min(2),minContributors:z.number().int().min(2),minDistanceKm:positiveSchema,minSocDropPercent:positiveSchema.max(100),
  maxRelativeSocUncertainty:positiveSchema.max(1),minGpsCoverage:finiteSchema.min(0).max(1),maxAgeDays:positiveSchema,halfLifeDays:positiveSchema,
  minManualSocUncertaintyPercent:positiveSchema.max(10),
  acceptedRatio:z.object({min:positiveSchema,max:positiveSchema}).strict().refine(r=>r.min<1&&r.max>1),
  maxPersonalWeight:finiteSchema.min(0).lt(1),maxCohortWeight:finiteSchema.min(0).lt(1),shrinkageCount:positiveSchema,
  maxEvents:z.number().int().positive().max(100000),maxTripWeightKm:positiveSchema}).strict();
export type FeedbackScope=z.infer<typeof feedbackScopeSchema>;
export type SocFeedback=z.infer<typeof socFeedbackSchema>;
export type FeedbackPolicy=z.infer<typeof feedbackPolicySchema>;
