import {z} from 'zod';
import {roadRouteSchema,weatherQuerySchema} from './road-weather.js';
import {timestampSchema,nonnegativeSchema,idSchema} from './common.js';

export const routeWeatherRequestSchema=z.object({route:roadRouteSchema,departureAt:timestampSchema,
  stops:z.array(z.object({segmentId:idSchema,delaySeconds:nonnegativeSchema.nullable()}).strict()).max(100).default([]),
}).strict();
export type RouteWeatherRequest=z.infer<typeof routeWeatherRequestSchema>;
// The HTTP pilot exchanges bounded queries; large road geometry stays in the server-side planner.
export const weatherBatchRequestSchema=z.object({departureAt:timestampSchema,queries:z.array(weatherQuerySchema).min(1).max(64)}).strict();
