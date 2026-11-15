import {classifyCandidate,type EligibilityInput} from '../candidate-eligibility';
import {eligibilityWorld} from '../validation/eligibility-fixtures';
function input():EligibilityInput{const w=eligibilityWorld('normal');return {candidate:w.candidates.candidates[0],metadata:w.candidates.metadata,vehicle:w.vehicle,policy:w.request.policy,evaluatedAt:w.now,staticMaxAgeSeconds:86400};}
describe('Conservative pure eligibility classification',()=>{
 it('passes only coarse known checks, does not mutate inputs or promise charging feasibility',()=>{
  const data=input(),before=JSON.stringify(data);expect(classifyCandidate(data)).toEqual({status:'eligible',reason:'static_checks_passed'});expect(JSON.stringify(data)).toBe(before);
 });
 it.each(['private','membership'] as const)('requires field-specific current evidence for %s',kind=>{
  const w=eligibilityWorld(kind),data={...input(),candidate:w.candidates.candidates[0]};
  expect(classifyCandidate(data).status).toBe('provably_ineligible');data.candidate.fieldEvidence={};expect(classifyCandidate(data).status).toBe('uncertain');
 });
 it.each(['unknown','stale','missing_observed','occupied','future_observed','public_unknown','membership_unknown','missing_evse','no_dc','wrong_standard','shared_pool','catalogue_membership','catalogue_claims'] as const)('does not turn %s into a station rejection',kind=>{
  const w=eligibilityWorld(kind);expect(classifyCandidate({...input(),candidate:w.candidates.candidates[0],policy:w.request.policy}).status).toBe('uncertain');
 });
 it('keeps a station with a usable alternative EVSE even if the first is blocked',()=>{
  const w=eligibilityWorld('mixed_evse');expect(classifyCandidate({...input(),candidate:w.candidates.candidates[0]}).status).toBe('eligible');
 });
 it.each(['planned','removed','temporarily_closed'] as const)('recognizes only the existing lifecycle exclusion: %s',lifecycle=>{
  const d=input();d.candidate!.lifecycle=lifecycle;expect(classifyCandidate(d).reason).toBe('lifecycle_excluded');
  d.candidate!.fieldEvidence={};expect(classifyCandidate(d).status).toBe('uncertain');
 });
 it.each(['coverage','truncated','stale_source','no_license','no_publish','old_publish','future_publish','missing_context'] as const)('fails uncertain with incomplete evidence: %s',kind=>{
  const d=input();d.candidate!.station.access.publicAccess=false;
  switch(kind){case 'coverage':d.metadata!.coverage.completeForQuery=false;break;case 'truncated':d.metadata!.search.truncated=true;break;
   case 'stale_source':d.metadata!.coverage.sources[0].stale=true;break;case 'no_license':d.candidate!.fieldEvidence!['access.publicAccess'].license=null;break;
   case 'no_publish':d.candidate!.fieldEvidence!['access.publicAccess'].publishedAt=null;break;
   case 'old_publish':d.candidate!.fieldEvidence!['access.publicAccess'].publishedAt=new Date(Date.parse(d.evaluatedAt)-86401000).toISOString();break;
   case 'future_publish':d.candidate!.fieldEvidence!['access.publicAccess'].publishedAt=new Date(Date.parse(d.evaluatedAt)+1000).toISOString();break;
   case 'missing_context':d.candidate=null;break;}
  expect(classifyCandidate(d).status).toBe('uncertain');
 });
 it('never evaluates opening hours or filters by requested SOC/curve range',()=>{
  const w=eligibilityWorld('opening_hours'),d={...input(),candidate:w.candidates.candidates[0]};
  expect(classifyCandidate(d).status).not.toBe('provably_ineligible');d.vehicle!.dcChargingCurves=[];expect(classifyCandidate(d).status).toBe('uncertain');
 });
});
