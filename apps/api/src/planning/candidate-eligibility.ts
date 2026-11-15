import type {StationCandidateSet,VehicleEnergyProfile,RoutePlanRequest,SourceReference} from '@chargeroad/shared';

export type Candidate=StationCandidateSet['candidates'][number];
export interface EligibilityInput {
 candidate:Candidate|null;metadata:StationCandidateSet['metadata']|null;vehicle:VehicleEnergyProfile|null;
 policy:RoutePlanRequest['policy']|null;evaluatedAt:string;staticMaxAgeSeconds:number;
}
export type EligibilityReason='context_missing'|'source_or_coverage_uncertain'|'hardware_unconfirmed'|'access_uncertain'|'state_dependent'|
 'public_access_denied'|'membership_not_authorized'|'lifecycle_excluded'|'static_checks_passed';
export interface CandidateEligibility {status:'eligible'|'provably_ineligible'|'uncertain';reason:EligibilityReason;}
const uncertain=(reason:EligibilityReason):CandidateEligibility=>({status:'uncertain',reason});

/** Coarse snapshot classification only. Never proves arrival-time/SOC/curve feasibility.
 * Missing inventory completeness cannot prove that a station has no compatible EVSE.
 */
export function classifyCandidate(input:EligibilityInput):CandidateEligibility {
 const {candidate:c,metadata:m,vehicle:v,policy:p}=input,now=Date.parse(input.evaluatedAt);
 if(!c?.station?.access||!Array.isArray(c.warnings)||!Array.isArray(c.station.evses)||!m?.coverage||!m.search||!v||!p||!Array.isArray(v.supportedConnectors)||!v.supportedConnectors.length||
  !Number.isFinite(now)||!Number.isFinite(input.staticMaxAgeSeconds)||input.staticMaxAgeSeconds<=0)return uncertain('context_missing');
 const sources=m.coverage.sources;
 if(m.coverage.completeForQuery!==true||m.search.truncated!==false||!Array.isArray(sources)||!sources.length||sources.some(s=>!s||
  s.sourceSnapshotComplete!==true||s.geographicCoverageVerified!==true||s.stale!==false||s.qualityExclusions!==0||
  !Number.isFinite(Date.parse(s.retrievedAt))||now<Date.parse(s.retrievedAt)||now-Date.parse(s.retrievedAt)>input.staticMaxAgeSeconds*1000))return uncertain('source_or_coverage_uncertain');
 const fresh=(source:SourceReference|undefined)=>{
  if(!source?.license||typeof source.publishedAt!=='string'||!sources.some(s=>s.sourceId===source.sourceId))return false;
  const age=(now-Date.parse(source.publishedAt))/1000,downloadAge=(now-Date.parse(source.retrievedAt))/1000;
  return Number.isFinite(age)&&Number.isFinite(downloadAge)&&downloadAge>=0&&age>=downloadAge&&age<=input.staticMaxAgeSeconds;
 };
 // Field-level evidence is essential after merging providers. Download time or another
 // field's recordUpdatedAt cannot establish freshness of an access/lifecycle claim.
 const evidence=(field:string)=>!c.warnings.includes('source_conflict:'+field)&&fresh(c.fieldEvidence?.[field]);
 if(c.station.access.publicAccess===false&&evidence('access.publicAccess'))return {status:'provably_ineligible',reason:'public_access_denied'};
 if(c.station.access.membershipRequired===true&&p.stationDataQuality!=='catalogue_power_scenario'&&evidence('access.membershipRequired'))
  return {status:'provably_ineligible',reason:'membership_not_authorized'};
 if(['planned','removed','temporarily_closed'].includes(c.lifecycle)&&evidence('lifecycle'))return {status:'provably_ineligible',reason:'lifecycle_excluded'};
 if(!evidence('access.publicAccess')||!evidence('access.membershipRequired')||!evidence('lifecycle'))return uncertain('source_or_coverage_uncertain');
 if(c.lifecycle!=='operating'||c.station.access.publicAccess!==true||c.station.access.membershipRequired!==false||c.station.access.openingHours===null)return uncertain('access_uncertain');
 if(!Array.isArray(c.station.evses)||!v.dcChargingCurves?.length)return uncertain('hardware_unconfirmed');
 const compatible=c.station.evses.filter(e=>e.identityBasis==='provider_evse'&&e.connectors.some(k=>k.powerType==='dc'&&v.supportedConnectors.includes(k.standard)&&
  fresh(k.source)&&k.maxCurrentA!==null&&k.outputVoltageRangeV!==null));
 if(!compatible.length)return uncertain('hardware_unconfirmed');
 const usable=compatible.some(e=>{
  const age=e.availability.sourceObservedAt===null?Infinity:(now-Date.parse(e.availability.sourceObservedAt))/1000;
  return Number.isFinite(age)&&age>=0&&age<=p.availabilityMaxAgeSeconds&&e.availability.reportedStatus==='available'&&e.sharedPowerPoolId===null;
 });
 if(!usable)return uncertain('state_dependent');
 // Opening hours, pool allocation, thermal state and charging curves are still
 // checked by PlanningSession/engines at each actual transition. No pruning here.
 return {status:'eligible',reason:'static_checks_passed'};
}
