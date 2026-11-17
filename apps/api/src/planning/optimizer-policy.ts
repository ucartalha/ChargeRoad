import type {OptimizerOptions} from '@chargeroad/shared';
// Bounded development policy; explicit version/assumptions, not a production latency SLA.
export const DEFAULT_OPTIMIZER_OPTIONS:OptimizerOptions={id:'bounded-ev-search',version:'1.3.0',maxStates:256,maxTransitions:4000,
  maxFrontier:2048,
  maxStations:16,maxStops:6,maxRoadQueries:64,maxWeatherQueries:10000,socStepPercent:5,connectionSeconds:120,
  corridorMeters:[2000,5000,10000],queueScenarioSeconds:0};
// 1.3.0 (2026-11-17): seed fallback tries stations inside the reach shown by depleted seed legs (seedFallbackCandidates).
/** User rule (2026-11-17): no charging stop while arriving at or above this SOC (EV comfort band 10-80 %).
 *  If no plan exists under the rule, the search is repeated once without it and the plan carries a warning. */
export const SOC_STOP_RULES={version:'soc-stop-rules/1.0.0',noChargeAtOrAboveArrivalPercent:50} as const;
// 1.4.0 (2026-11-17): numerically identical charged states (one per EVSE/connector) are expanded once (distinctChargedStates).
// 1.5.0 (2026-11-17): two seed reach strategies (each chain improved separately) and SOC_STOP_RULES.
export const OPTIMIZER_VERSION='chargeroad-optimizer/1.5.0';
