import { z } from 'zod';
import { idSchema } from './common.js';
import { roadSegmentObject, checkRoadSegmentTiming, roadRouteObject, checkRoadRoute } from './road-weather.js';
import { energySegmentObject, checkEnergySegment, routePlanObject, checkRoutePlan } from './planning.js';
import { planningResponseMetadataSchema, type PlanningApiResponse } from './planning-http.js';

/**
 * Mobile plan view (planning-mobile-view/1.0.0, 2026-11-19): GET /v1/planning-jobs/:id/result?view=mobile.
 * A projection of an already validated full plan for the app. It drops only fields the app never reads; on the
 * İstanbul→Kelkit reference plan these were ~3.6 MB of 5.8 MB (elevation profiles alone 2.7 MB). Kept: geometry,
 * distances, durations, SOC, charging stops, scenario, quality labels (elevationQuality, speedLimitKind), ascent/descent
 * totals and every plan consistency rule. The full response stays the default; `view: 'mobile'` marks the projection so
 * it is never mistaken for, stored as, or replayed as the full plan.
 */
export const PLANNING_MOBILE_VIEW = { version: 'planning-mobile-view/1.0.0' } as const;

const droppedSegmentFields = { elevationProfile: true, sourceEdgeIds: true, speedLimitSource: true, speedLimitRaw: true, speedProfile: true } as const;
const droppedEnergyFields = { breakdown: true, batteryTemperatureAtEndC: true, consumptionReferenceIds: true, weatherQueryIds: true } as const;

export const mobileRoadSegmentSchema = roadSegmentObject.omit(droppedSegmentFields).strict().superRefine(checkRoadSegmentTiming);
export const mobileRoadRouteSchema = roadRouteObject.extend({ segments: z.array(mobileRoadSegmentSchema).min(1) }).strict().superRefine(checkRoadRoute);
export const mobileEnergySegmentSchema = energySegmentObject.omit(droppedEnergyFields).strict().superRefine(checkEnergySegment);
export const mobileRoutePlanSchema = routePlanObject.extend({
  roadRoute: mobileRoadRouteSchema,
  energySegments: z.array(mobileEnergySegmentSchema).min(1),
}).strict().superRefine(checkRoutePlan);

export const planningMobileResponseSchema = z.discriminatedUnion('status', [
  z.object({ schemaVersion: z.literal('1.0.0'), view: z.literal('mobile'), requestId: z.string().uuid(), status: z.literal('planned'),
    plan: mobileRoutePlanSchema, metadata: planningResponseMetadataSchema }).strict(),
  z.object({ schemaVersion: z.literal('1.0.0'), view: z.literal('mobile'), requestId: z.string().uuid(),
    status: z.enum(['infeasible', 'insufficient_data', 'provider_error', 'computation_limit']),
    reasons: z.array(z.object({ code: idSchema, explanation: z.string().min(1).max(1000) }).strict()).min(1).max(100),
    metadata: planningResponseMetadataSchema }).strict(),
]).superRefine((r, ctx) => {
  if (r.status === 'planned' && r.requestId !== r.plan.requestId) ctx.addIssue({ code: 'custom', message: 'Plan and API request IDs must agree' });
});
export type PlanningMobileResponse = z.infer<typeof planningMobileResponseSchema>;
export type MobileRoutePlan = z.infer<typeof mobileRoutePlanSchema>;

/** Pure projection of a validated full response; never mutates its input. */
export function toMobilePlanningResponse(response: PlanningApiResponse): PlanningMobileResponse {
  if (response.status !== 'planned') return { ...response, view: 'mobile' };
  const { plan } = response;
  return {
    ...response, view: 'mobile',
    plan: {
      ...plan,
      roadRoute: { ...plan.roadRoute, segments: plan.roadRoute.segments.map(({ elevationProfile, sourceEdgeIds, speedLimitSource, speedLimitRaw, speedProfile, ...kept }) => kept) },
      energySegments: plan.energySegments.map(({ breakdown, batteryTemperatureAtEndC, consumptionReferenceIds, weatherQueryIds, ...kept }) => kept),
    },
  };
}
