import type {OptimizerOptions} from '@chargeroad/shared';
// Bounded development policy; explicit version/assumptions, not a production latency SLA.
export const DEFAULT_OPTIMIZER_OPTIONS:OptimizerOptions={id:'bounded-ev-search',version:'1.1.0',maxStates:256,maxTransitions:4000,
  maxFrontier:2048,
  maxStations:16,maxStops:6,maxRoadQueries:64,maxWeatherQueries:10000,socStepPercent:5,connectionSeconds:120,
  corridorMeters:[2000,5000,10000],queueScenarioSeconds:0};
export const OPTIMIZER_VERSION='chargeroad-optimizer/1.0.0';
