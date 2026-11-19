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
/** User rule (2026-11-17): when no plan reaches the requested arrival SOC and a destination leg met the reserve but not the
 *  target, plan again with the target lowered in stepPercent steps (never below the reserve). The plan carries
 *  the arrival_target_lowered warning; the evaluation accepts a lower target only with it. */
export const ARRIVAL_TARGET_FALLBACK={version:'arrival-target-fallback/1.0.0',stepPercent:5} as const;
/** Requested target first, then lower multiples of stepPercent above the reserve, then the reserve itself. */
export function arrivalTargetSteps(target:number,reserve:number,step:number=ARRIVAL_TARGET_FALLBACK.stepPercent):number[]{
  const steps=[target];if(target<=reserve)return steps;
  for(let next=Math.ceil(target/step)*step-step;next>reserve;next-=step)if(next<target)steps.push(next);
  steps.push(reserve);return steps;
}
// 1.5.0 (2026-11-17): two seed reach strategies (each chain improved separately) and SOC_STOP_RULES.
// 1.6.0 (2026-11-17): ARRIVAL_TARGET_FALLBACK (planning service; search itself unchanged).
/** Optimizer 1.7.0 (user report 2026-11-19): under time/energy objectives the seed re-charges a stop that went above the
 *  fast band (seedChargeTargets' 80 %) only to what the next validated leg needs, plus marginPercent, and re-validates
 *  that leg. Long routes exhaust the budget before improveFixedStopTargets runs, which left 100 % stops in plans. */
/** Optimizer 1.7.0: weather projections (segments x drives, the unit that tracks drive cost) the broad search may spend
 *  after a validated plan exists. On the reference routes (İstanbul→Kelkit x3, Ankara, İzmir) an unbounded broad search
 *  after the seed found no better plan but cost 2-3 s; small graphs still reach their exhaustive optimum (~100 cheap drives). */
export const BROAD_SEARCH_POLICY={version:'broad-search/1.0.0',maxWeatherProjectionsWithIncumbent:3000 as number};
export const SEED_TRIM_POLICY={version:'seed-charge-trim/1.0.0',marginPercent:.05,minGainPercent:1} as const;
// 1.6.1 (2026-11-19): station/charging weather reuses a sampled series only inside the 10 km provenance bound (planning-session).
// 1.7.0 (2026-11-19): seed charge-to-need (SEED_TRIM_POLICY), one corridor per search (planning service), BROAD_SEARCH_POLICY.
// 1.7.1 (2026-11-19): station road endpoints within ROAD_ENDPOINT_POLICY.stationMeters (planning-session) and the self-hosted
//   weather provider's own per-plan call budget (weather-policy); search source unchanged.
export const OPTIMIZER_VERSION='chargeroad-optimizer/1.7.1';
