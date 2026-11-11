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
  speedLimitKind:z.enum(['unknown','posted','unlimited','conditional_unresolved','provider_derived']).optional(),
  speedLimitSource:sourceReferenceSchema.nullable().optional(),
  speedLimitRaw:z.string().nullable().optional(),
  expectedSpeedBasis:z.literal('travel_time_average').optional(),
  elevationQuality:z.enum(['verified','modelled','unknown']).optional(),
  speedProfile:z.array(z.object({elapsedSeconds:nonnegativeSchema,speedKph:nonnegativeSchema}).strict()).min(2).max(1000).optional(),
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
  const speeds=segment.speedProfile;
  if(speeds){
    const seconds=speeds.at(-1)!.elapsedSeconds;
    const distance=speeds.slice(1).reduce((sum,p,i)=>sum+(p.speedKph+speeds[i].speedKph)/7.2*(p.elapsedSeconds-speeds[i].elapsedSeconds),0);
    if(speeds[0].elapsedSeconds!==0||Math.abs(seconds-segment.drivingDurationSeconds)>0.001||
      !strictlyIncreasing(speeds.map(p=>p.elapsedSeconds))||Math.abs(distance-segment.distanceMeters)>0.1)
      ctx.addIssue({code:'custom',path:['speedProfile'],message:'Speed trace must cover time and integrate to segment distance'});
  }
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
  metadata:z.object({
    providerId:idSchema,traffic:z.enum(['none','historical','live','unknown']),
    departureUsedAt:timestampSchema,originTimeZone:z.string(),
    warnings:z.array(z.string()),
    attributions:z.array(z.object({text:z.string(),url:z.string().url(),license:z.string()}).strict()),
    maneuvers:z.array(z.object({instruction:z.string(),type:z.number().int(),
      startDistanceMeters:nonnegativeSchema,endDistanceMeters:nonnegativeSchema}).strict()),
    speedLimitKnownMeters:nonnegativeSchema,speedLimitUnknownMeters:nonnegativeSchema,
    durationAllocation:z.literal('maneuver_weighted'),
    usage:z.enum(['development_pilot','configured_service']),
  }).strict().optional(),
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
  originTimeZone:z.string().min(1).optional(),
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
  sampleLocation: coordinateSchema.optional(),
}).strict();

export const weatherForecastSchema = z.object({
  queryId: idSchema,
  segmentId: idSchema,
  location: coordinateSchema,
  validAt: timestampSchema,
  // True model issue time, not the API download or dataset update time.
  forecastIssuedAt: timestampSchema.nullable(),
  sourceUpdatedAt: timestampSchema.nullable().optional(),
  status: z.enum(['available','partial','stale','outside_horizon','provider_unavailable','budget_exhausted']).optional(),
  fetchedAt: timestampSchema,
  temperatureCelsius: finiteSchema.nullable(),
  windSpeedKph: nonnegativeSchema.nullable(),
  windFromDegrees: nonnegativeSchema.lt(360).nullable(),
  precipitationProbabilityPercent: percentSchema.nullable(),
  precipitationMmPerHour: nonnegativeSchema.nullable(),
  snowDepthCm: nonnegativeSchema.nullable(),
  airPressureHpa: positiveSchema.nullable(),
  metadata: z.object({
    sampledLocation: coordinateSchema, sampledElevationMeters:finiteSchema.nullable(), sampleDistanceMeters:nonnegativeSchema,
    coverageStart:timestampSchema, coverageEnd:timestampSchema, lastValidatedAt:timestampSchema,
    intervalStart:timestampSchema, intervalEnd:timestampSchema, timeStepSeconds:nonnegativeSchema,
    method:z.enum(['exact','linear_temperature_vector_wind']),
    pressureKind:z.enum(['sea_level','surface','unknown']),
    precipitationPeriod:z.object({start:timestampSchema,end:timestampSchema,totalMm:nonnegativeSchema.nullable(),
      probabilityPercent:percentSchema.nullable()}).strict().nullable(),
    warnings:z.array(z.string()), license:z.string(), attribution:z.string(),
  }).strict().optional(),
  source: sourceReferenceSchema,
}).strict();

export type SegmentationPolicy = z.infer<typeof segmentationPolicySchema>;
export type RoadSegment = z.infer<typeof roadSegmentSchema>;
export type RoadRoute = z.infer<typeof roadRouteSchema>;
export type RoadRoutingRequest = z.infer<typeof roadRoutingRequestSchema>;
export type RoadRoutingResult = z.infer<typeof roadRoutingResultSchema>;
export type WeatherQuery = z.infer<typeof weatherQuerySchema>;
export type WeatherForecast = z.infer<typeof weatherForecastSchema>;

export function weatherForecastIsUsable(forecast:WeatherForecast,now:number,maxAgeSeconds:number):boolean{
  const time=forecast.sourceUpdatedAt??forecast.forecastIssuedAt;
  return (!forecast.status||['available','partial'].includes(forecast.status))&&forecast.temperatureCelsius!==null&&forecast.windSpeedKph!==null&&
    (forecast.windSpeedKph===0||forecast.windFromDegrees!==null)&&time!==null&&now>=Date.parse(time)&&now-Date.parse(time)<=maxAgeSeconds*1000;
}
