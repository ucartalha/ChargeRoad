import {z} from 'zod';
import {coordinateSchema,timestampSchema,sourceReferenceSchema} from './common.js';
export const locationSearchRequestSchema=z.object({query:z.string().trim().min(3).max(120)}).strict();
export const locationResultSchema=z.object({id:z.string().min(1).max(200),label:z.string().min(1).max(500),coordinate:coordinateSchema}).strict();
export const locationSearchResponseSchema=z.object({schemaVersion:z.literal('1.0.0'),providerId:z.string().min(1),
  attribution:z.string().min(1),attributionUrl:z.string().url(),retrievedAt:timestampSchema,results:z.array(locationResultSchema).max(6)}).strict();
export const roadPreviewRequestSchema=z.object({origin:coordinateSchema,destination:coordinateSchema,departureAt:timestampSchema,
  avoidTolls:z.boolean(),avoidFerries:z.boolean()}).strict();
export const roadPreviewResponseSchema=z.object({schemaVersion:z.literal('1.0.0'),status:z.enum(['available','not_found']),
  route:z.object({distanceMeters:z.number().finite().positive(),drivingDurationSeconds:z.number().finite().positive(),
    geometry:z.array(coordinateSchema).min(2).max(8000).optional(),
    originSnapMeters:z.number().finite().nonnegative().max(1000),destinationSnapMeters:z.number().finite().nonnegative().max(1000),
    traffic:z.enum(['none','historical','live','unknown']),source:sourceReferenceSchema,
    attributions:z.array(z.object({text:z.string(),url:z.string().url(),license:z.string()})),warnings:z.array(z.string())}).strict().nullable(),
}).strict().refine(r=>(r.status==='available')===(r.route!==null));
export type LocationResult=z.infer<typeof locationResultSchema>;
export type LocationSearchResponse=z.infer<typeof locationSearchResponseSchema>;
export type RoadPreviewRequest=z.infer<typeof roadPreviewRequestSchema>;
export type RoadPreviewResponse=z.infer<typeof roadPreviewResponseSchema>;
