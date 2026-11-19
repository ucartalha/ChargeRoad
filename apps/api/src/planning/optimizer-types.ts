import type {RoutePlanRequest,VehicleEnergyProfile,OptimizerOptions,NumericObservation,UsableCapacitySnapshot,StationCandidateSet,
  RoadRoute,WeatherForecast,PlannedChargingStop,Coordinate,PlanningResult,PlanningInput} from '@chargeroad/shared';
import type {PlanningWeather} from '../weather/planning-weather-policy';
import type {SearchEnergyEvaluationResult} from '../energy/energy-engine';
export interface PlanningNode {id:string;location:Coordinate;stationId:string|null;}
export interface DriveLeg {from:string;to:string;route:RoadRoute;energy:SearchEnergyEvaluationResult;weather:WeatherForecast[];departureAt:string;arrivalAt:string;}
export interface OptimizerState {nodeId:string;soc:number;temperature:NumericObservation;capacity:UsableCapacitySnapshot|null;at:string;
  legs:DriveLeg[];stops:{stop:PlannedChargingStop;arrivalAt:string;departureAt:string}[];visited:string[];netKwh:number;seconds:number;distance:number;}
export interface PlanningContext {
  /** Origin heading (2026-11-19): travel direction at the trip origin, for road legs starting there. */
  originHeading?:{degrees:number;toleranceDegrees:number};request:RoutePlanRequest;vehicle:VehicleEnergyProfile;evaluatedAt:string;options:OptimizerOptions;
  candidates:StationCandidateSet;nodes:PlanningNode[];baseRoutes?:RoadRoute[];weatherSampling?:PlanningWeather;
  /** Measured access detour per station id (station-access/1.0.0); null = could not be measured. */
  stationAccess?:Record<string,{additionalMeters:number;additionalSeconds:number}|null>;}
export interface TransitionPort {
  drive(state:OptimizerState,to:PlanningNode,preview:boolean,signal:AbortSignal):Promise<DriveLeg[]>;
  charge(state:OptimizerState,target:number,signal:AbortSignal):Promise<OptimizerState[]>;
  readonly issues:Set<string>;readonly counters:{roadQueries:number;weatherQueries:number};
  remainingMilliseconds?():number;
  /** Optimizer 1.8.0: weather projections used and allowed in this search (limit Infinity when not enforced). */
  weatherBudget?():{used:number;limit:number};
  /** Optimizer 1.9.0: fresh road/weather budgets for the relaxed stop-rule search. */
  resetSearchBudgets?():void;
  /** Development-only trace (observability/planning-debug); null/absent unless PLANNING_DEBUG_TRACE is on. */
  readonly debug?:import('../observability/planning-debug').PlanningDebugTrace|null;
}
export class PlanningDataLimit extends Error {}
export class PlanningProviderFailure extends Error {constructor(message:string,readonly retryAfterSeconds=0){super(message);}}
export interface OptimizerOutcome {result:PlanningResult;validationInput?:PlanningInput;replay?:unknown;search?:import('@chargeroad/shared').OptimizerSearch;retryAfterSeconds?:number;}
