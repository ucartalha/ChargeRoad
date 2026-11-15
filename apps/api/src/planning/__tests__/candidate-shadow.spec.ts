import {eligibilityWorld} from '../validation/eligibility-fixtures';
import {observeCandidateEligibility,observeCandidateCall} from '../candidate-eligibility-shadow';
import {withPlanningMetrics,type PlanningMetricSnapshot} from '../../observability/planning-metrics';
import type {PlanningContext} from '../optimizer-types';
function context(){const w=eligibilityWorld('private');return {w,c:{request:w.request,vehicle:w.vehicle,evaluatedAt:w.now,options:w.options,candidates:w.candidates,nodes:[]} as PlanningContext};}
describe('Shadow-only aggregate observation',()=>{
 it('does no candidate work outside an enabled metrics context',()=>{
  const trap=new Proxy({} as PlanningContext,{get(){throw new Error('Should not read');}});
  expect(()=>observeCandidateEligibility(null as never,trap)).not.toThrow();expect(()=>observeCandidateCall(trap,'opaque','drive')).not.toThrow();
 });
 it('counts hypothetical calls and fixed reasons without changing candidates or leaking payload',async()=>{
  const {w,c}=context(),before=JSON.stringify(c);let snapshot!:PlanningMetricSnapshot;
  await withPlanningMetrics(w.request.requestId,async()=>{observeCandidateEligibility(c.candidates.candidates,c);observeCandidateCall(c,'a','drive');observeCandidateCall(c,'a','charge');observeCandidateCall(c,'destination','drive');},{enabled:true,sink:s=>snapshot=s});
  expect(snapshot.counters).toMatchObject({candidate_eligibility_total:2,candidate_selected_total:2,candidate_eligibility_provably_ineligible:1,candidate_eligibility_eligible:1,
   candidate_reject_public_access:1,candidate_potential_drive_calls:1,candidate_potential_charge_calls:1});
  expect(JSON.stringify(c)).toBe(before);expect(JSON.stringify(snapshot)).not.toMatch(/latitude|longitude|startingChargePercent|Synthetic|synthetic-eligibility/);
 });
 it('makes incomplete data uncertain and never claims a saved HTTP call',async()=>{
  const {w,c}=context();c.candidates.metadata.coverage.completeForQuery=false;let snapshot!:PlanningMetricSnapshot;
  await withPlanningMetrics(w.request.requestId,async()=>{observeCandidateEligibility(c.candidates.candidates,c);observeCandidateCall(c,'a','drive');},{enabled:true,sink:s=>snapshot=s});
  expect(snapshot.counters.candidate_eligibility_uncertain).toBe(2);expect(snapshot.counters.candidate_potential_drive_calls).toBe(0);expect(snapshot.counters.road_http_acquisitions).toBe(0);
 });
 it('contains an unexpected observation getter failure',async()=>{
  const {w,c}=context();Object.defineProperty(c.candidates,'metadata',{get(){throw new Error('private');}});let snapshot!:PlanningMetricSnapshot;
  await expect(withPlanningMetrics(w.request.requestId,async()=>observeCandidateEligibility(c.candidates.candidates,c),{enabled:true,sink:s=>snapshot=s})).resolves.toBeUndefined();
  expect(snapshot.counters.candidate_eligibility_uncertain).toBe(2);
 });
});
