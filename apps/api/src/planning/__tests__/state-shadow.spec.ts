import {createStateShadow,STATE_SHADOW_LIMITS} from '../state-dominance-shadow';
import {withPlanningMetrics,type PlanningMetricSnapshot} from '../../observability/planning-metrics';
import type {OptimizerState} from '../optimizer-types';
const id='11111111-1111-4111-8111-111111111111';
function state():OptimizerState{return {nodeId:'synthetic',soc:50,at:'2026-11-15T09:00:00Z',temperature:{origin:'unknown',value:null},capacity:null,legs:[],stops:[],visited:['origin','synthetic'],netKwh:1,seconds:60,distance:1000};}
describe('Bounded state observation, no search effects',()=>{
 it('does no state getters/copies/serialization without metrics, including inside a disabled root',async()=>{
  const trap=new Proxy({} as OptimizerState,{get(){throw new Error('getter');},ownKeys(){throw new Error('keys');}});
  expect(()=>createStateShadow()(trap)).not.toThrow();const sink=jest.fn();await withPlanningMetrics(id,async()=>createStateShadow()(trap),{enabled:false,sink});expect(sink).not.toHaveBeenCalled();
 });
 it('never opens route/weather/history payloads or serializes them',async()=>{
  const a=state(),trap=new Proxy({},{get(){throw new Error('Do not inspect history');}});a.legs=[trap as never];let record!:PlanningMetricSnapshot;
  await withPlanningMetrics(id,async()=>{const observe=createStateShadow();observe(a);observe({...a});},{enabled:true,sink:s=>record=s});
  expect(record.counters.exact_duplicate_candidates).toBe(1);expect(record.counters.actual_pruned_states).toBe(0);expect(record.counters.state_shadow_capture_failures).toBe(0);
  expect(JSON.stringify(record)).not.toMatch(/nodeId|visited|temperature|latitude|longitude|synthetic/);
 });
 it('copies bounded scalar provenance so later scalar mutation cannot look identical',async()=>{
  const a=state();let record!:PlanningMetricSnapshot;
  await withPlanningMetrics(id,async()=>{const observe=createStateShadow();observe(a);a.temperature={origin:'user_input',value:30,observedAt:a.at};observe(a);},{enabled:true,sink:s=>record=s});
  expect(record.counters.not_equivalent_pairs).toBe(1);expect(record.counters.exact_duplicate_candidates).toBe(0);
 });
 it('caps observations/retention/pairs and reads no getters after the budget is consumed',async()=>{
  let record!:PlanningMetricSnapshot;
  await withPlanningMetrics(id,async()=>{const observe=createStateShadow();for(let i=0;i<STATE_SHADOW_LIMITS.observations;i++)observe(state());
   observe(new Proxy({} as OptimizerState,{get(){throw new Error('Budget must skip');},ownKeys(){throw new Error('Budget must skip');}}));
  },{enabled:true,sink:s=>record=s});
  expect(record.counters.states_seen).toBe(257);expect(record.counters.state_shadow_observations).toBe(256);expect(record.counters.state_shadow_budget_skipped).toBe(1);
  expect(record.counters.state_shadow_entries_peak).toBe(64);expect(record.counters.state_shadow_pairs).toBeLessThanOrEqual(256*4);expect(record.counters.state_shadow_capture_failures).toBe(0);
 });
 it('contains observation failures and rejects unexpected state fields/oversize visits',async()=>{
  let record!:PlanningMetricSnapshot;
  await withPlanningMetrics(id,async()=>{const observe=createStateShadow();observe(new Proxy({} as OptimizerState,{ownKeys(){throw new Error('private');}}));
   observe({...state(),unexpected:true} as OptimizerState);observe({...state(),visited:Array(33).fill('x')});
  },{enabled:true,sink:s=>record=s});expect(record.counters.state_shadow_capture_failures).toBe(3);expect(record.counters.actual_pruned_states).toBe(0);
 });
 it('does not treat identical-looking separately allocated history roots as proved duplicates',async()=>{
  let record!:PlanningMetricSnapshot;await withPlanningMetrics(id,async()=>{const observe=createStateShadow();observe(state());observe(state());},{enabled:true,sink:s=>record=s});
  expect(record.counters.unsafe_or_unproven_pairs).toBe(1);expect(record.counters.exact_duplicate_candidates).toBe(0);
 });
 it('exposes the immutability limitation: same-root nested source mutation is not a pruning proof',async()=>{
  const a=state(),history={route:{source:{version:'v1'}},weather:[{source:{version:'v1'}}]};a.legs=[history as never];let record!:PlanningMetricSnapshot;
  await withPlanningMetrics(id,async()=>{const observe=createStateShadow();observe(a);history.route.source.version='v2';history.weather[0].source.version='v2';observe({...a});},{enabled:true,sink:s=>record=s});
  expect(record.counters.exact_duplicate_candidates).toBe(1);expect(record.counters.actual_pruned_states).toBe(0);
 });
});
