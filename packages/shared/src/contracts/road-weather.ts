import { z } from 'zod';
import {
  contractVersionSchema, coordinateSchema, finiteSchema, idSchema, nonnegativeSchema,
  percentSchema, positiveSchema, sourceReferenceSchema, strictlyIncreasing, timestampSchema,
} from './common.js';

export const segmentationPolicySchema = z.object({
  id: idSchema,
  version: idSchema,
  maxDistanceMeters: positiveSchema,
  maxDurationSeconds: positiveSchema,
  splitAtSpeedChangeKph: positiveSchema,
  splitAtGradeChangePercent: positiveSchema,
  splitAtBearingChangeDegrees: positiveSchema.max(180),
  maxWeatherTimeStepSeconds: positiveSchema,
  splitAtRoadClassChanges: z.literal(true),
  splitAtChargingAccess: z.literal(true),
}).strict();

export const roadSegmentSchema = z.object({
  id: idSchema,
  sourceEdgeIds: z.array(idSchema).min(1),
  startDistanceMeters: nonnegativeSchema,
  endDistanceMeters: positiveSchema,
  distanceMeters: positiveSchema,
  drivingDurationSeconds: positiveSchema,
  geometry: z.array(coordinateSchema).min(2),
  roadClass: z.enum(['motorway', 'primary', 'secondary', 'local', 'ferry', 'unknown']),
  bearingDegrees: nonnegativeSchema.lt(360),
  expectedSpeedKph: positiveSchema,
  speedLimitKph: positiveSchema.nullable(),
  elevationProfile: z.array(z.object({
    distanceFromStartMeters: nonnegativeSchema,
    elevationMeters: finiteSchema,
  }).strict()).min(2).nullable(),
  elevationGainMeters: nonnegativeSchema.nullable(),
  elevationLossMeters: nonnegativeSchema.nullable(),
  startsAtChargingAccess: z.boolean(),
  endsAtChargingAccess: z.boolean(),
}).strict().superRefine((segment, ctx) => {
  if (Math.abs(segment.endDistanceMeters - segment.startDistanceMeters - segment.distanceMeters) > 0.001)
    ctx.addIssue({ code: 'custom', path: ['distanceMeters'], message: 'Segment distance does not match its route offsets' });
  const expectedSpeed = segment.distanceMeters / segment.drivingDurationSeconds * 3.6;
  if (Math.abs(expectedSpeed - segment.expectedSpeedKph) > 0.1)
    ctx.addIssue({ code: 'custom', path: ['expectedSpeedKph'], message: 'Speed must agree with road distance and driving duration' });
  const elevations = segment.elevationProfile;
  if (elevations) {
    if (elevations[0].distanceFromStartMeters !== 0 ||
        Math.abs(elevations[elevations.length - 1].distanceFromStartMeters - segment.distanceMeters) > 0.001 ||
        !strictlyIncreasing(elevations.map((point) => point.distanceFromStartMeters)))
      ctx.addIssue({ code: 'custom', path: ['elevationProfile'], message: 'Elevation samples must cover the segment and increase in distance' });
    const gain = elevations.slice(1).reduce((sum, point, index) =>
      sum + Math.max(0, point.elevationMeters - elevations[index].elevationMeters), 0);
    const loss = elevations.slice(1).reduce((sum, point, index) =>
      sum + Math.max(0, elevations[index].elevationMeters - point.elevationMeters), 0);
    if (segment.elevationGainMeters === null || segment.elevationLossMeters === null ||
        Math.abs(gain - segment.elevationGainMeters) > 0.01 || Math.abs(loss - segment.elevationLossMeters) > 0.01)
      ctx.addIssue({ code: 'custom', path: ['elevationGainMeters'], message: 'Ascent/descent must match the supplied elevation profile' });
  }
});

export const roadRouteSchema = z.object({
  id: idSchema,
  distanceMeters: positiveSchema,
  drivingDurationSeconds: positiveSchema,
  segments: z.array(roadSegmentSchema).min(1),
  segmentationPolicy: segmentationPolicySchema,
  source: sourceReferenceSchema,
}).strict().superRefine((route, ctx) => {
  if (new Set(route.segments.map((segment) => segment.id)).size !== route.segments.length)
    ctx.addIssue({ code: 'custom', path: ['segments'], message: 'Duplicate route segment ID' });
  let end = 0;
  let seconds = 0;
  for (const [index, segment] of route.segments.entries()) {
    if (Math.abs(segment.startDistanceMeters - end) > 0.001)
      ctx.addIssue({ code: 'custom', path: ['segments', index], message: 'Road segments must be contiguous and start at zero' });
    if (segment.distanceMeters > route.segmentationPolicy.maxDistanceMeters ||
        segment.drivingDurationSeconds > route.segmentationPolicy.maxDurationSeconds)
      ctx.addIssue({ code: 'custom', path: ['segments', index], message: 'Segment exceeds the explicit segmentation policy' });
    if (index > 0) {
      const previous = route.segments[index - 1].geometry;
      const a = previous[previous.length - 1];
      const b = segment.geometry[0];
      if (Math.abs(a.latitude - b.latitude) > 0.000001 || Math.abs(a.longitude - b.longitude) > 0.000001)
        ctx.addIssue({ code: 'custom', path: ['segments', index, 'geometry'], message: 'Adjacent road geometries are disconnected' });
    }
    end = segment.endDistanceMeters;
    seconds += segment.drivingDurationSeconds;
  }
  if (Math.abs(end - route.distanceMeters) > 0.001 || Math.abs(seconds - route.drivingDurationSeconds) > 0.001)
    ctx.addIssue({ code: 'custom', message: 'Route totals do not match the segments' });
});

export const roadRoutingRequestSchema = z.object({
  schemaVersion: contractVersionSchema,
  origin: coordinateSchema,
  destination: coordinateSchema,
  departureAt: timestampSchema,
  alternatives: z.number().int().min(1).max(10),
  avoidTolls: z.boolean(),
  avoidFerries: z.boolean(),
  segmentationPolicy: segmentationPolicySchema,
}).strict();

export const roadRoutingResultSchema = z.object({
  schemaVersion: contractVersionSchema,
  routes: z.array(roadRouteSchema).min(1),
}).strict();

export const weatherQuerySchema = z.object({
  id: idSchema,
  segmentId: idSchema,
  location: coordinateSchema,
  validAt: timestampSchema,
}).strict();

export const weatherForecastSchema = z.object({
  queryId: idSchema,
  segmentId: idSchema,
  location: coordinateSchema,
  validAt: timestampSchema,
  forecastIssuedAt: timestampSchema,
  fetchedAt: timestampSchema,
  temperatureCelsius: finiteSchema.nullable(),
  windSpeedKph: nonnegativeSchema.nullable(),
  windFromDegrees: nonnegativeSchema.lt(360).nullable(),
  precipitationProbabilityPercent: percentSchema.nullable(),
  precipitationMmPerHour: nonnegativeSchema.nullable(),
  snowDepthCm: nonnegativeSchema.nullable(),
  airPressureHpa: positiveSchema.nullable(),
  source: sourceReferenceSchema,
}).strict();

export type SegmentationPolicy = z.infer<typeof segmentationPolicySchema>;
export type RoadSegment = z.infer<typeof roadSegmentSchema>;
export type RoadRoute = z.infer<typeof roadRouteSchema>;
export type RoadRoutingRequest = z.infer<typeof roadRoutingRequestSchema>;
export type RoadRoutingResult = z.infer<typeof roadRoutingResultSchema>;
export type WeatherQuery = z.infer<typeof weatherQuerySchema>;
export type WeatherForecast = z.infer<typeof weatherForecastSchema>;
