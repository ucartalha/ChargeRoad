import {z} from 'zod';
import {idSchema,nonnegativeSchema,positiveSchema,sourceReferenceSchema,finiteSchema,numberRangeSchema} from './common.js';
export const chargingModelSchema=z.object({id:idSchema,version:idSchema,vehicleVariantId:idSchema,
  quality:z.enum(['verified','engineering_estimate']),source:sourceReferenceSchema,verificationNote:z.string().min(1),assumptions:z.array(z.string()),
  terminalToStoredEfficiency:positiveSchema.max(1),auxiliaryPackKw:nonnegativeSchema,
  connectionModel:z.object({batteryKw:nonnegativeSchema,ambientRangeC:numberRangeSchema,source:sourceReferenceSchema}).strict().optional(),
  temperatureEvolution:z.object({kind:z.literal('isothermal_conditioned'),version:idSchema,temperatureC:finiteSchema,
    ambientRangeC:numberRangeSchema,source:sourceReferenceSchema}).strict().optional(),
}).strict().refine(m=>!!m.source.license,'Charging model usage rights must be recorded');
export type ChargingModel=z.infer<typeof chargingModelSchema>;
