import {z} from 'zod';
import {idSchema,positiveSchema,finiteSchema} from './common.js';
export const usableCapacitySnapshotSchema=z.object({
  vehicleProfileId:idSchema,vehicleProfileVersion:idSchema,vehicleVariantId:idSchema,
  referenceUsableKwh:positiveSchema,referenceSohPercent:positiveSchema.max(100),sohPercent:positiveSchema.max(100),
  temperatureFactor:positiveSchema.max(1),temperatureAtAssessmentC:finiteSchema.nullable(),
  temperatureModelId:idSchema.nullable(),temperatureModelVersion:idSchema.nullable(),effectiveKwh:positiveSchema,
  assumptions:z.array(z.string()),
}).strict().refine(s=>Math.abs(s.effectiveKwh-s.referenceUsableKwh*s.sohPercent/s.referenceSohPercent*s.temperatureFactor)<1e-8,
  'Effective capacity must apply SOH and temperature factors exactly once');
export type UsableCapacitySnapshot=z.infer<typeof usableCapacitySnapshotSchema>;
