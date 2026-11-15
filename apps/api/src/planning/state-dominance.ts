/** Observation records, NOT a future-state equivalence key or pruning permission.
 * History tokens mean shared object identity only; nested provenance/mutation and
 * session side effects are deliberately NOT certified by this bounded comparison.
 */
export interface StateObservation {
 readonly scope:object;readonly nodeId:string;readonly visited:readonly string[];
 readonly soc:number;readonly at:string;readonly temperature:readonly (string|number|null)[];
 readonly capacityToken:number;readonly legsToken:number;readonly stopsToken:number;
 readonly netKwh:number;readonly seconds:number;readonly distance:number;
}
export const STATE_SHADOW_COUNTERS=['states_seen','state_shadow_observations','state_shadow_pairs','exact_duplicate_candidates','potential_dominance_pairs','not_equivalent_pairs','unsafe_or_unproven_pairs',
 'state_shadow_budget_skipped','state_shadow_entries_peak','state_shadow_capture_failures','actual_pruned_states'] as const;
export type StateCandidateLevel='exact_duplicate_candidate'|'potential_dominance_only'|'not_equivalent'|'unproven';
export interface StateComparison {level:StateCandidateLevel;mayPrune:false;proof:'shallow_observation_only';}
const result=(level:StateCandidateLevel):StateComparison=>({level,mayPrune:false,proof:'shallow_observation_only'});
const same=(a:readonly unknown[],b:readonly unknown[])=>a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
export function compareStateObservations(a:StateObservation,b:StateObservation):StateComparison {
 if(a.scope!==b.scope)return result('unproven');
 if(a.nodeId!==b.nodeId||a.at!==b.at||!same(a.visited,b.visited)||!same(a.temperature,b.temperature))return result('not_equivalent');
 if(a.capacityToken!==b.capacityToken||a.legsToken!==b.legsToken||a.stopsToken!==b.stopsToken)return result('unproven');
 if(Object.is(a.soc,b.soc)&&Object.is(a.netKwh,b.netKwh)&&Object.is(a.seconds,b.seconds)&&Object.is(a.distance,b.distance))return result('exact_duplicate_candidate');
 // This numerical hint is unsafe with e.g. regeneration/taper and is NEVER used
 // by search. compareStates' energy rounding does not enter this comparison.
 const better=(x:StateObservation,y:StateObservation)=>x.soc>=y.soc&&x.netKwh<=y.netKwh&&x.seconds<=y.seconds&&x.distance<=y.distance;
 return result(better(a,b)||better(b,a)?'potential_dominance_only':'not_equivalent');
}
