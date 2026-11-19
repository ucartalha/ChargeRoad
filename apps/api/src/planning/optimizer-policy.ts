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
/** seed-charge-trim/1.1.0 (optimizer 1.8.0): when the re-driven leg misses its target at the tight margin (a shorter charge moves
 *  the ETA, weather and battery temperature), the trim is retried with retryMarginsPercent before giving up. */
export const SEED_TRIM_POLICY={version:'seed-charge-trim/1.1.0',marginPercent:.05,retryMarginsPercent:[2,5],minGainPercent:1} as const;
// 1.6.1 (2026-11-19): station/charging weather reuses a sampled series only inside the 10 km provenance bound (planning-session).
// 1.7.0 (2026-11-19): seed charge-to-need (SEED_TRIM_POLICY), one corridor per search (planning service), BROAD_SEARCH_POLICY.
// 1.7.1 (2026-11-19): station road endpoints within ROAD_ENDPOINT_POLICY.stationMeters (planning-session) and the self-hosted
//   weather provider's own per-plan call budget (weather-policy); search source unchanged.
/** Optimizer 1.8.0 (2026-11-19, phone İstanbul→Erzurum from ~40 % SOC failed with computation_limit). The fixed maxStops 6 made a
 *  7–8 stop trip impossible: the planning service raises the cap to ceil(route km / range km) + slack within [min, max]. The
 *  range is the planning weather range estimate (catalogue or capacity/consumption); unknown range uses unknownRange. */
export const STOP_LIMIT_POLICY={version:'stop-limit/1.0.0',min:6,max:12,slack:1,unknownRange:8} as const;
export function routeStopLimit(routeMeters:number,rangeKm:number|null|undefined):number{
  if(!(typeof rangeKm==='number'&&Number.isFinite(rangeKm)&&rangeKm>0))return STOP_LIMIT_POLICY.unknownRange;
  return Math.max(STOP_LIMIT_POLICY.min,Math.min(STOP_LIMIT_POLICY.max,Math.ceil(routeMeters/1000/rangeKm)+STOP_LIMIT_POLICY.slack));
}
/** Optimizer 1.8.0: seed chains used the whole weather projection budget (İstanbul→Kelkit: ~43 k of ~44 k) so stop targets were
 *  never improved (100 % stops, 35–62 % arrival). After the first plan, further seed attempts stop while less than fraction of
 *  the projection budget is left; the remainder goes to improveFixedStopTargets and the bounded broad search. */
export const IMPROVE_RESERVE_POLICY={version:'improve-reserve/1.0.0',fraction:.3} as const;
export function seedingAllowed(hasPlan:boolean,budget:{used:number;limit:number}|null|undefined):boolean{
  if(!hasPlan||!budget||!Number.isFinite(budget.limit))return true;
  return budget.limit-budget.used>=IMPROVE_RESERVE_POLICY.fraction*budget.limit;
}
// 1.7.1 (2026-11-19): station endpoint tolerance and self-hosted weather call budget.
/** Optimizer 1.9.0 P1 (user decision 2026-11-19): a stop costs more than its 2 min connection (leave the road, park, plug,
 *  pay). Shortest-time plans are RANKED with secondsPerStop extra per stop; displayed durations stay physical. */
/** tieSeconds (user decision 2026-11-19): within this penalized-time window the plan with fewer stops wins. */
export const STOP_PENALTY_POLICY={version:'stop-penalty/1.0.0',secondsPerStop:360,tieSeconds:60} as const;
/** Optimizer 1.9.0 P4: a leg is not driven when its corridor distance exceeds factor × the range share above the reserve +
 *  slackKm (range floor minRangeKm). The range estimate is conservative (İstanbul→Erzurum legs ≤ 231 km vs ~427 km bound at
 *  100 %), so only legs that cannot arrive are skipped; 79 % of the weather budget went to such legs before. */
export const REACH_PREFILTER_POLICY={version:'reach-prefilter/1.0.0',factor:2.5,minRangeKm:150,slackKm:25} as const;
export function reachPrefilterKm(rangeKm:number|null|undefined,soc:number,reserve:number){
  const range=Math.max(typeof rangeKm==='number'&&Number.isFinite(rangeKm)?rangeKm:0,REACH_PREFILTER_POLICY.minRangeKm);
  return Math.max(0,soc-reserve)/100*range*REACH_PREFILTER_POLICY.factor+REACH_PREFILTER_POLICY.slackKm;
}
/** Optimizer 1.9.0 P3: after improvement, each stop (cheapest charge first) is removed by charging the previous stop for both
 *  legs plus the required arrival and a margin; the rest of the trip is re-driven by the engine and kept only if better. */
export const STOP_ELIMINATION_POLICY={version:'stop-elimination/1.0.0',marginsPercent:[2,5,8],maxAttempts:8,maxRounds:3} as const;
export function eliminationTargets(previousTarget:number,arrivalAtRemoved:number,removedTarget:number,arrivalAtNext:number,required:number):number[]{
  const need=previousTarget-arrivalAtRemoved+removedTarget-arrivalAtNext+required;
  return [...new Set(STOP_ELIMINATION_POLICY.marginsPercent.map(m=>Math.min(100,Math.ceil((need+m)*100-1e-8)/100)))];
}
// 1.8.0 (2026-11-19): STOP_LIMIT_POLICY, IMPROVE_RESERVE_POLICY, fallback corridor route gets fresh search budgets.
// 1.9.0 (2026-11-19): STOP_PENALTY_POLICY, REACH_PREFILTER_POLICY, STOP_ELIMINATION_POLICY, relaxed stop-rule search gets its own budgets.
export const OPTIMIZER_VERSION='chargeroad-optimizer/1.9.0';
