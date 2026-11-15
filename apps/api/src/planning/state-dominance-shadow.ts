import type {OptimizerState} from './optimizer-types';
import {compareStateObservations,type StateObservation} from './state-dominance';
import {planningMetricsActive,countMetric,maxMetric,measureSync} from '../observability/planning-metrics';

export const STATE_SHADOW_LIMITS={observations:256,retained:64,pairsPerState:4,visited:32,text:256,historyRoots:768} as const;
const noop=(_state:OptimizerState)=>{};
const stateKeys=['nodeId','soc','temperature','capacity','at','legs','stops','visited','netKwh','seconds','distance'];
const text=(value:unknown):value is string=>typeof value==='string'&&value.length<=STATE_SHADOW_LIMITS.text;
const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value);

/** Per solve, discarded on return. Off path allocates no observer/map/snapshot.
 * WeakMap keys never keep road/weather/leg/stop/capacity graphs alive.
 */
export function createStateShadow():(state:OptimizerState)=>void {
 if(!planningMetricsActive())return noop;
 const scope=Object.freeze({}),entries:StateObservation[]=[],identities=new WeakMap<object,number>();let nextId=1,observed=0;
 const token=(value:object)=>{let id=identities.get(value);if(id===undefined){id=nextId++;identities.set(value,id);}return id;};
 const capture=(state:OptimizerState):StateObservation|null=>{
  if(Object.keys(state).length!==stateKeys.length||stateKeys.some(k=>!Object.hasOwn(state,k)))return null;
  if(!text(state.nodeId)||!text(state.at)||![state.soc,state.netKwh,state.seconds,state.distance].every(finite)||
   !Array.isArray(state.visited)||state.visited.length>STATE_SHADOW_LIMITS.visited||!state.visited.every(text)||
   !Array.isArray(state.legs)||!Array.isArray(state.stops)||state.legs.length>STATE_SHADOW_LIMITS.visited||state.stops.length>STATE_SHADOW_LIMITS.visited||
   state.capacity!==null&&typeof state.capacity!=='object')return null;
  const t=state.temperature;
  if(!t||Object.keys(t).some(k=>!['origin','value','observedAt','sourceId','estimatedAt','validAt','modelVersion'].includes(k)))return null;
  const fields=t as unknown as Record<string,unknown>,temperature=[t.origin,t.value,fields.observedAt??null,fields.sourceId??null,fields.estimatedAt??null,fields.validAt??null,fields.modelVersion??null];
  if(!['measured','user_input','estimated','unknown'].includes(t.origin)||temperature.some(v=>v!==null&&!text(v)&&!finite(v)))return null;
  return {scope,nodeId:state.nodeId,at:state.at,soc:state.soc,netKwh:state.netKwh,seconds:state.seconds,distance:state.distance,
   visited:[...state.visited],temperature:temperature as (string|number|null)[],capacityToken:state.capacity===null?0:token(state.capacity),legsToken:token(state.legs),stopsToken:token(state.stops)};
 };
 return state=>{
  if(!planningMetricsActive())return;
  countMetric('states_seen');
  if(observed>=STATE_SHADOW_LIMITS.observations){countMetric('state_shadow_budget_skipped');return;}observed++;
  try{measureSync('state_shadow',()=>{
   countMetric('state_shadow_observations');const snapshot=capture(state);
   if(!snapshot){countMetric('state_shadow_capture_failures');return;}
   let pairs=0;
   for(let i=entries.length-1;i>=0&&pairs<STATE_SHADOW_LIMITS.pairsPerState;i--){
    const previous=entries[i];if(previous.nodeId!==snapshot.nodeId)continue;pairs++;countMetric('state_shadow_pairs');
    const level=compareStateObservations(previous,snapshot).level;
    if(level==='exact_duplicate_candidate')countMetric('exact_duplicate_candidates');
    else if(level==='potential_dominance_only')countMetric('potential_dominance_pairs');
    else if(level==='not_equivalent')countMetric('not_equivalent_pairs');
    else countMetric('unsafe_or_unproven_pairs');
   }
   if(entries.length<STATE_SHADOW_LIMITS.retained)entries.push(snapshot);
   maxMetric('state_shadow_entries_peak',entries.length);
  });}catch{countMetric('state_shadow_capture_failures');}
 };
}
