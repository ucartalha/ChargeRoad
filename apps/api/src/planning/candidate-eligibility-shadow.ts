import type {PlanningContext} from './optimizer-types';
import {classifyCandidate,type Candidate,type CandidateEligibility} from './candidate-eligibility';
import {STATION_POLICY} from '../stations/station-policy';
import {planningMetricsActive,measureSync,countMetric} from '../observability/planning-metrics';

function classify(candidate:Candidate,context:PlanningContext):CandidateEligibility {
 // Observation must not turn unexpected metadata into a plan failure.
 try{return classifyCandidate({candidate,metadata:context.candidates.metadata,vehicle:context.vehicle,policy:context.request.policy,
  evaluatedAt:context.evaluatedAt,staticMaxAgeSeconds:STATION_POLICY.staticSoftAgeSeconds});}
 catch{return {status:'uncertain',reason:'context_missing'};}
}
/** Counts occurrences per corridor, after existing pinning/catalogue transformation.
 * Selection, ordering and query metadata are never changed or annotated.
 */
export function observeCandidateEligibility(candidates:Candidate[],context:PlanningContext){
 if(!planningMetricsActive())return;
 measureSync('candidate_eligibility',()=>{
  countMetric('candidate_eligibility_total',candidates.length);countMetric('candidate_selected_total',context.candidates.candidates.length);
  for(const candidate of candidates){const decision=classify(candidate,context);
   if(decision.status==='eligible')countMetric('candidate_eligibility_eligible');
   else if(decision.status==='uncertain')countMetric('candidate_eligibility_uncertain');
   else {countMetric('candidate_eligibility_provably_ineligible');
    if(decision.reason==='public_access_denied')countMetric('candidate_reject_public_access');
    if(decision.reason==='membership_not_authorized')countMetric('candidate_reject_membership');
    if(decision.reason==='lifecycle_excluded')countMetric('candidate_reject_lifecycle');
   }
  }
 });
}
/** Hypothetical rejected-target session entries, NOT saved provider/engine calls.
 * Existing early returns/cache hits may already avoid downstream work.
 */
export function observeCandidateCall(context:PlanningContext,stationId:string,role:'drive'|'charge'){
 if(!planningMetricsActive())return;
 const candidate=context.candidates.candidates.find(c=>c.station.id===stationId);if(!candidate)return;
 const decision=measureSync('candidate_call_shadow',()=>classify(candidate,context));
 if(decision.status==='provably_ineligible')countMetric(role==='drive'?'candidate_potential_drive_calls':'candidate_potential_charge_calls');
}
