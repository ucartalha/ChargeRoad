import {createHash} from 'node:crypto';
import {socFeedbackSchema,feedbackPolicySchema,feedbackScopeSchema} from '@chargeroad/shared';
import type {SocFeedback,FeedbackPolicy,FeedbackScope} from '@chargeroad/shared';
import {canonicalJson} from '../../vehicles/knowledge/knowledge-package';

interface Consent {ownerId:string;revisionId:string;personalization:boolean;aggregateContribution:boolean;}
export interface LearningContext {
  scope:FeedbackScope;now:string;policy:FeedbackPolicy;activeConsents:Consent[];
  // This exclusion is independent of the record's own label: do not trust a client-provided split.
  holdoutTripIds:string[];
  holdoutOwnerIds:string[];
  target:{kind:'personal';ownerId:string;drivingProfileId:string;personalVehicleId:string}|{kind:'cohort'};
}
export interface LearnedResidual {
  schemaVersion:'consumption-residual/1.0.0';status:'ready'|'insufficient_data';kind:'personal'|'cohort';
  scope:FeedbackScope;policyId:string;policyVersion:string;cutoffAt:string;expiresAt:string;inputChecksumSha256:string;
  target:LearningContext['target'];rawRatio:number;weight:number;independentTrips:number;contributors:number;
  trainingTripIds:string[];contributorOwnerIds:string[];consentRevisionIds:string[];rejected:{id:string;reason:string}[];
}
const digest=(v:unknown)=>createHash('sha256').update(canonicalJson(v)).digest('hex');
function median(points:{value:number;weight:number}[]){
  const sorted=[...points].sort((a,b)=>a.value-b.value),half=sorted.reduce((n,p)=>n+p.weight,0)/2;
  let sum=0;for(const p of sorted){sum+=p.weight;if(sum>=half)return p.value;}return sorted.at(-1)!.value;
}

/** Offline, deterministic, bounded conditional residual learning; no auth/storage/automatic publication. */
export function learnConsumptionResidual(raw:unknown[],context:LearningContext):LearnedResidual{
  const policy=feedbackPolicySchema.parse(context.policy),scope=feedbackScopeSchema.parse(context.scope),now=Date.parse(context.now);
  if(!Number.isFinite(now))throw new Error('Invalid learning cutoff');
  if(raw.length>policy.maxEvents)throw new Error('FEEDBACK_EVENT_BUDGET');
  if(new Set(context.activeConsents.map(c=>c.ownerId)).size!==context.activeConsents.length)throw new Error('Conflicting consent snapshot');
  const consent=new Map(context.activeConsents.map(c=>[c.ownerId,c])),holdouts=new Set(context.holdoutTripIds),holdoutOwners=new Set(context.holdoutOwnerIds);
  const scopeDigest=digest(scope);
  const events=raw.map(r=>socFeedbackSchema.parse(r)).sort((a,b)=>Date.parse(a.start.observedAt)-Date.parse(b.start.observedAt)||(a.id<b.id?-1:a.id>b.id?1:0));
  const rejected:LearnedResidual['rejected']=[],seen=new Map<string,string>(),unique:SocFeedback[]=[],collisions=new Set<string>();
  for(const e of events){const checksum=digest(e),prior=seen.get(e.id);
    if(prior&&prior!==checksum)collisions.add(e.id);if(!prior){seen.set(e.id,checksum);unique.push(e);}}
  const trips=new Map<string,{ownerId:string;consentRevisionId:string;from:number;to:number;observed:number;predicted:number;distance:number;last:number}>();
  const occupiedUntil=new Map<string,number>();
  // Scope must include the exact baseline model and bucket revision. No cross-car/season/source averaging.
  for(const e of unique){
    let reason:string|null=null;const from=Date.parse(e.start.observedAt),to=Date.parse(e.end.observedAt),age=(now-to)/86400000,drop=e.start.value-e.end.value;
    const uncertainty=(observation:SocFeedback['start'])=>Math.max(observation.uncertaintyPercent,observation.origin==='user_input'?policy.minManualSocUncertaintyPercent:0);
    const permission=consent.get(e.ownerId),target=context.target;
    if(collisions.has(e.id))reason='EVENT_ID_COLLISION';
    else if(digest(e.scope)!==scopeDigest)reason='SCOPE_OR_BASELINE_MISMATCH';
    else if(target.kind==='personal'&&(e.ownerId!==target.ownerId||e.drivingProfileId!==target.drivingProfileId||e.personalVehicleId!==target.personalVehicleId))reason='PERSONAL_OWNERSHIP_MISMATCH';
    else if(!permission?.personalization||permission.revisionId!==e.consentRevisionId||target.kind==='cohort'&&!permission.aggregateContribution)reason='CONSENT_NOT_CURRENT';
    else if(e.split==='holdout'||holdouts.has(e.tripId)||holdoutOwners.has(e.ownerId))reason='HOLDOUT_EXCLUDED';
    else if(e.kind!=='driving_interval'||e.chargingOccurred)reason='CHARGE_OR_ANCHOR_RESET_NOT_CONSUMPTION';
    else if(age<0||Date.parse(e.receivedAt)>now)reason='FUTURE_OBSERVATION';
    else if(age>policy.maxAgeDays)reason='OBSERVATION_EXPIRED';
    else if(e.distanceKm<policy.minDistanceKm||e.gpsCoverageRatio<policy.minGpsCoverage)reason='OBSERVATION_COVERAGE_LOW';
    else if(drop<policy.minSocDropPercent)reason='SOC_DROP_TOO_SMALL_OR_REGENERATIVE';
    else if((uncertainty(e.start)+uncertainty(e.end))/drop>policy.maxRelativeSocUncertainty)reason='SOC_UNCERTAINTY_TOO_HIGH';
    const observed=e.capacity.effectiveKwh*drop/100,ratio=observed/e.baseline.netBatteryEnergyKwh;
    if(!reason&&(ratio<policy.acceptedRatio.min||ratio>policy.acceptedRatio.max))reason='RESIDUAL_OUTLIER_REQUIRES_REVIEW';
    const key=e.ownerId+'\u0000'+e.tripId,prior=trips.get(key);
    const vehicleKey=e.ownerId+'\u0000'+e.personalVehicleId;
    if(!reason&&from<(occupiedUntil.get(vehicleKey)??-Infinity))reason='OVERLAPPING_TRIP_WINDOW';
    if(reason){rejected.push({id:e.id,reason});continue;}
    occupiedUntil.set(vehicleKey,to);
    if(prior){prior.to=to;prior.observed+=observed;prior.predicted+=e.baseline.netBatteryEnergyKwh;prior.distance+=e.distanceKm;prior.last=to;}
    else trips.set(key,{ownerId:e.ownerId,consentRevisionId:e.consentRevisionId,from,to,observed,predicted:e.baseline.netBatteryEnergyKwh,distance:e.distanceKm,last:to});
  }
  const tripPoints=[...trips.values()].map(t=>({value:t.observed/t.predicted,weight:Math.min(t.distance,policy.maxTripWeightKm)*2**(-(now-t.last)/86400000/policy.halfLifeDays)}));
  const owners=new Map<string,{value:number;weight:number}[]>();
  [...trips.values()].forEach((t,i)=>{const group=owners.get(t.ownerId)??[];group.push(tripPoints[i]);owners.set(t.ownerId,group);});
  const contributors=owners.size,cohort=context.target.kind==='cohort';
  // Each owner gets one vote in a cohort, regardless of kilometres or uploaded window count.
  const points=cohort?[...owners.values()].map(group=>({value:median(group),weight:Math.max(...group.map(p=>p.weight))/policy.maxTripWeightKm})):tripPoints;
  const effectiveCount=points.reduce((sum,p)=>sum+p.weight/(cohort?1:policy.maxTripWeightKm),0),ready=trips.size>=policy.minTrips&&(!cohort||contributors>=policy.minContributors);
  const weight=ready?(cohort?policy.maxCohortWeight:policy.maxPersonalWeight)*effectiveCount/(effectiveCount+policy.shrinkageCount):0;
  return {schemaVersion:'consumption-residual/1.0.0',status:ready?'ready':'insufficient_data',kind:context.target.kind,scope,policyId:policy.id,policyVersion:policy.version,
    cutoffAt:context.now,expiresAt:new Date([...trips.values()].reduce((min,t)=>Math.min(min,t.last+policy.maxAgeDays*86400000),now+policy.maxAgeDays*86400000)).toISOString(),
    inputChecksumSha256:digest({events:unique,context}),target:context.target,rawRatio:ready?median(points):1,weight,
    independentTrips:trips.size,contributors,trainingTripIds:[...new Set([...trips.keys()].map(k=>k.split('\u0000')[1]))].sort(),
    contributorOwnerIds:[...owners.keys()].sort(),consentRevisionIds:[...new Set([...trips.values()].map(t=>t.consentRevisionId))].sort(),rejected};
}

export function blendConsumption(referenceNetKwh:number,scope:FeedbackScope,context:{ownerId:string;drivingProfileId:string;personalVehicleId:string;now:string;activeConsentRevisionIds:string[]},
  personal:LearnedResidual|null,cohort:LearnedResidual|null){
  if(!Number.isFinite(referenceNetKwh)||referenceNetKwh<0)throw new Error('Residual blending is only defined for nonnegative net consumption; never scale regeneration or charging power');
  const usable=(model:LearnedResidual|null,kind:'personal'|'cohort')=>{
    if(!model||model.status!=='ready'||model.kind!==kind||digest(model.scope)!==digest(scope))return false;
    if(!Number.isFinite(Date.parse(context.now))||!Number.isFinite(Date.parse(model.cutoffAt))||!Number.isFinite(Date.parse(model.expiresAt))||
      Date.parse(model.cutoffAt)>Date.parse(context.now)||Date.parse(model.expiresAt)<Date.parse(context.now))return false;
    if(model.consentRevisionIds.some(id=>!context.activeConsentRevisionIds.includes(id)))return false;
    if(kind==='cohort'&&model.contributorOwnerIds.includes(context.ownerId))return false;
    if(model.target.kind==='personal'&&(model.target.ownerId!==context.ownerId||model.target.drivingProfileId!==context.drivingProfileId||model.target.personalVehicleId!==context.personalVehicleId))return false;
    return model.weight>=0&&model.weight<1&&Number.isFinite(model.rawRatio)&&model.rawRatio>0;
  };
  const wp=usable(personal,'personal')?personal!.weight:0,wg=usable(cohort,'cohort')?cohort!.weight:0;
  const weights={reference:(1-wp)*(1-wg),cohort:(1-wp)*wg,personal:wp};
  const factor=weights.reference+weights.cohort*(wg?cohort!.rawRatio:1)+weights.personal*(wp?personal!.rawRatio:1);
  return {netBatteryEnergyKwh:referenceNetKwh*factor,factor,weights,personalRevision:wp?personal!.inputChecksumSha256:null,cohortRevision:wg?cohort!.inputChecksumSha256:null};
}
