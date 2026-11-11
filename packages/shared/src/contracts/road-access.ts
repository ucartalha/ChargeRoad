import { z } from 'zod';
import { coordinateSchema,idSchema,nonnegativeSchema,positiveSchema,timestampSchema } from './common.js';
import { roadRouteSchema,roadRoutingRequestSchema } from './road-weather.js';

export const stationRoadAccessRequestSchema=z.object({
  roadRequest:roadRoutingRequestSchema,routeIndex:z.number().int().min(0).max(2).optional().default(0),
  stationIds:z.array(z.string().uuid()).min(1).max(3),
}).strict().refine(r=>new Set(r.stationIds).size===r.stationIds.length,'Duplicate station ID');
export const stationRoadAccessSchema=z.object({
  stationId:z.string().uuid(),baseRouteId:idSchema,
  status:z.enum(['routed_to_catalogue_coordinate','no_route','not_in_candidate_set','snap_too_far','provider_unavailable','budget_exhausted']),
  entryDistanceMeters:nonnegativeSchema.nullable(),exitDistanceMeters:nonnegativeSchema.nullable(),
  anchorEntry:coordinateSchema.nullable(),anchorExit:coordinateSchema.nullable(),
  departureAt:timestampSchema.nullable(),
  replacementRoute:roadRouteSchema.nullable(),
  replacedDistanceMeters:nonnegativeSchema.nullable(),replacedDurationSeconds:nonnegativeSchema.nullable(),
  additionalDistanceMeters:z.number().finite().nullable(),additionalDurationSeconds:z.number().finite().nullable(),
  stationSnapDistanceMeters:nonnegativeSchema.nullable(),
  physicalAccessVerified:z.literal(false),warnings:z.array(z.string()),
}).strict();
export type StationRoadAccessRequest=z.infer<typeof stationRoadAccessRequestSchema>;
export type StationRoadAccess=z.infer<typeof stationRoadAccessSchema>;
