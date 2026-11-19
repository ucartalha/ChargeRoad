import type {PlanningApiResponse,PlanningMobileResponse,MobileRoutePlan} from '@chargeroad/shared';
/** planning-mobile-view/1.0.0 (2026-11-19): plan jobs are read with ?view=mobile. The sync /plans fallback still returns the
 *  full response, a structural superset, so screens only rely on fields present in both. */
export type ClientPlanningResponse=PlanningApiResponse|PlanningMobileResponse;
export type ClientRoutePlan=MobileRoutePlan;
