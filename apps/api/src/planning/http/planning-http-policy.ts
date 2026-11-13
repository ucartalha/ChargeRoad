import {z} from 'zod';
import {ROAD_SEGMENTATION} from '../../roads/road-policy';
import {DEFAULT_OPTIMIZER_OPTIONS} from '../optimizer-policy';
import {WEATHER_POLICY} from '../../weather/weather-policy';
import {CATALOGUE_SCENARIO_POLICY} from '../catalogue-station-scenario';
import type {PlanningApiRequest,RoutePlanRequest} from '@chargeroad/shared';
import type {PreparationOptions} from '../planning-coordinator';
export const PLANNING_HTTP_OPTIONS=Symbol('PLANNING_HTTP_OPTIONS');
export const PLANNING_HTTP_POLICY={id:'public-planning',version:'1.2.0',maxBodyBytes:16*1024,maxResponseBytes:16*1024*1024,
  maxWireResponseBytes:2*1024*1024,compressResponseAtBytes:32*1024,
  maxStraightLineMeters:2000000,availabilityMaxAgeSeconds:300,forecastMaxAgeSeconds:WEATHER_POLICY.maxAgeSeconds} as const;
export const planningHttpOptionsSchema=z.object({budgetMs:z.number().int().min(100).max(30000),localConcurrency:z.number().int().min(1).max(16)}).strict();
export type PlanningHttpOptions=z.infer<typeof planningHttpOptionsSchema>;
export function planningHttpOptions():PlanningHttpOptions{return planningHttpOptionsSchema.parse({
  budgetMs:Number(process.env.PLANNING_HTTP_BUDGET_MS??30000),localConcurrency:Number(process.env.PLANNING_LOCAL_CONCURRENCY??2)});}
export function toInternalRequest(r:PlanningApiRequest,budgetMs:number):RoutePlanRequest{return {
  schemaVersion:'1.0.0',requestId:r.requestId,origin:r.origin,destination:r.destination,vehicleVariantId:r.vehicleVariantId,departureAt:r.departureAt,
  startingChargePercent:r.startingChargePercent,startingChargeObservedAt:r.startingChargeObservedAt,startingChargeSource:r.startingChargeSource,
  ...(r.startingChargeEstimate?{startingChargeEstimate:r.startingChargeEstimate}:{}),
  initialBatteryTemperatureC:r.initialBatteryTemperatureC,stateOfHealthPercent:r.stateOfHealthPercent,operatingConditions:r.operatingConditions,constraints:r.constraints,
  policy:{id:PLANNING_HTTP_POLICY.id,version:PLANNING_HTTP_POLICY.version,vehicleDataQuality:r.vehicleDataQuality,stationDataQuality:r.stationDataQuality,objective:r.objective,
    availabilityMaxAgeSeconds:PLANNING_HTTP_POLICY.availabilityMaxAgeSeconds,forecastMaxAgeSeconds:PLANNING_HTTP_POLICY.forecastMaxAgeSeconds,
    unknownAvailability:'allow_with_documented_risk',unknownWeather:'reject',missingChargingCurve:'report_insufficient_data',maxIterations:3,maxComputationMilliseconds:budgetMs}};}
export function planningPreparation(r:PlanningApiRequest):PreparationOptions{return {road:{alternatives:2,avoidTolls:r.roadPreferences.avoidTolls,
  avoidFerries:r.roadPreferences.avoidFerries,segmentationPolicy:{...ROAD_SEGMENTATION}},stationCorridorMeters:2000,
  maxWeatherQueries:r.stationDataQuality==='catalogue_power_scenario'?CATALOGUE_SCENARIO_POLICY.maxWeatherQueries:DEFAULT_OPTIMIZER_OPTIONS.maxWeatherQueries};}
