import type {RoutePlanRequest,VehicleEnergyProfile,OptimizerOptions,NumericObservation,UsableCapacitySnapshot,StationCandidateSet,
  RoadRoute,EnergyEvaluationResult,WeatherForecast,PlannedChargingStop,Coordinate,PlanningResult,PlanningInput} from '@chargeroad/shared';
export interface PlanningNode {id:string;location:Coordinate;stationId:string|null;}
export interface DriveLeg {from:string;to:string;route:RoadRoute;energy:EnergyEvaluationResult;weather:WeatherForecast[];departureAt:string;arrivalAt:string;}
export interface OptimizerState {nodeId:string;soc:number;temperature:NumericObservation;capacity:UsableCapacitySnapshot|null;at:string;
  legs:DriveLeg[];stops:{stop:PlannedChargingStop;arrivalAt:string;departureAt:string}[];visited:string[];netKwh:number;seconds:number;distance:number;}
export interface PlanningContext {request:RoutePlanRequest;vehicle:VehicleEnergyProfile;evaluatedAt:string;options:OptimizerOptions;
  candidates:StationCandidateSet;nodes:PlanningNode[];baseRoutes?:RoadRoute[];}
export interface TransitionPort {
  drive(state:OptimizerState,to:PlanningNode,preview:boolean,signal:AbortSignal):Promise<DriveLeg[]>;
  charge(state:OptimizerState,target:number,signal:AbortSignal):Promise<OptimizerState[]>;
  readonly issues:Set<string>;readonly counters:{roadQueries:number;weatherQueries:number};
  remainingMilliseconds?():number;
}
export class PlanningDataLimit extends Error {}
export class PlanningProviderFailure extends Error {constructor(message:string,readonly retryAfterSeconds=0){super(message);}}
export interface OptimizerOutcome {result:PlanningResult;validationInput?:PlanningInput;replay?:unknown;search?:import('@chargeroad/shared').OptimizerSearch;retryAfterSeconds?:number;}
