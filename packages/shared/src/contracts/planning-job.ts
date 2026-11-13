import {z} from 'zod';
import {timestampSchema} from './common.js';
export const planningJobStatusSchema=z.object({id:z.string().uuid(),status:z.enum(['queued','running','completed','failed','cancelled']),
 createdAt:timestampSchema,startedAt:timestampSchema.nullable(),expiresAt:timestampSchema,
 errorCode:z.string().nullable(),pollAfterMilliseconds:z.number().int().min(250).max(10000)}).strict();
export type PlanningJobStatus=z.infer<typeof planningJobStatusSchema>;
