import type {SocFeedback,FeedbackScope,FeedbackPolicy} from '@chargeroad/shared';
import {socFeedbackSchema} from '@chargeroad/shared';
import {learnConsumptionResidual,blendConsumption} from '../feedback/feedback-learner';
import type {LearningContext} from '../feedback/feedback-learner';
import {chargingFixture} from '../../charging/__tests__/fixtures';
const scope:FeedbackScope={vehicleVariantId:'synthetic-vehicle',configurationSha256:'a'.repeat(64),referenceProfileId:'energy-profile',referenceProfileVersion:'1',
  referenceAlgorithmVersion:'test-baseline/1',conditionBucketSha256:'b'.repeat(64),bucketPolicyVersion:'test-buckets/1'};
const policy:FeedbackPolicy={id:'synthetic-test-policy',version:'1',stage:'offline_validation',minTrips:3,minContributors:3,minDistanceKm:10,minSocDropPercent:5,
  maxRelativeSocUncertainty:.25,minManualSocUncertaintyPercent:1,minGpsCoverage:.9,maxAgeDays:90,halfLifeDays:30,acceptedRatio:{min:.5,max:1.5},maxPersonalWeight:.5,maxCohortWeight:.2,shrinkageCount:5,maxEvents:1000,maxTripWeightKm:100};
function event(index:number,ratio=1.2,owner='owner'):SocFeedback{
  const at=new Date(Date.parse('2026-11-01T08:00:00Z')+index*86400000).toISOString(),end=new Date(Date.parse(at)+3600000).toISOString();
  return {schemaVersion:'soc-feedback/1.0.0',id:'e'+index+'-'+owner,tripId:'trip'+index+'-'+owner,ownerId:owner,drivingProfileId:'driver',personalVehicleId:'car',consentRevisionId:'consent-'+owner,
    scope:{...scope},kind:'driving_interval',start:{value:80,observedAt:at,origin:'user_input',uncertaintyPercent:1},end:{value:60,observedAt:end,origin:'user_input',uncertaintyPercent:1},receivedAt:end,
    distanceKm:100,gpsCoverageRatio:1,chargingOccurred:false,baseline:{planRevisionId:'plan-'+index,inputChecksumSha256:'c'.repeat(64),netBatteryEnergyKwh:16/ratio,personalWeight:0,cohortWeight:0},
    capacity:chargingFixture().capacity,split:'training'};
}
function context():LearningContext{return {scope,now:'2026-11-11T12:00:00Z',policy,activeConsents:[{ownerId:'owner',revisionId:'consent-owner',personalization:true,aggregateContribution:false}],
  holdoutTripIds:[],holdoutOwnerIds:[],target:{kind:'personal',ownerId:'owner',drivingProfileId:'driver',personalVehicleId:'car'}};}
const serving={ownerId:'owner',drivingProfileId:'driver',personalVehicleId:'car',now:'2026-11-11T12:00:00Z',activeConsentRevisionIds:['consent-owner']};
describe('Bounded, independent, conditional SOC residual learning',()=>{
  it('uses actual SOC depletion rather than the ratio of remaining SOC levels',()=>{
    const model=learnConsumptionResidual([event(1),event(2),event(3)],context());expect(model.status).toBe('ready');expect(model.rawRatio).toBeCloseTo(1.2,10);
    const blended=blendConsumption(10,scope,serving,model,null);
    expect(blended.factor).toBeGreaterThan(1);expect(blended.factor).toBeLessThan(1.1);expect(blended.weights.reference).toBeGreaterThan(.5);
    expect(blended.weights.personal+blended.weights.cohort+blended.weights.reference).toBeCloseTo(1,12);
  });
  it('uses reference-only for a new user and never treats one correction as a permanent model',()=>{
    const m=learnConsumptionResidual([event(1)],context());expect(m.status).toBe('insufficient_data');expect(m.weight).toBe(0);
    expect(blendConsumption(10,scope,serving,m,null).netBatteryEnergyKwh).toBe(10);
    expect(blendConsumption(10,scope,serving,null,null).netBatteryEnergyKwh).toBe(10);
  });
  it('also learns lower consumption while resisting a single noisy trip',()=>{
    const low=learnConsumptionResidual([event(1,.8),event(2,.8),event(3,.8)],context());
    expect(blendConsumption(10,scope,serving,low,null).factor).toBeLessThan(1);
    const stable=learnConsumptionResidual([event(1,1),event(2,1),event(3,1.4)],context());expect(stable.rawRatio).toBe(1);
  });
  it('treats repeated uploads idempotently and rejects conflicting event identities',()=>{
    const events=[event(1),event(2),event(3)],m=learnConsumptionResidual(events,context());
    expect(learnConsumptionResidual([...events,event(1)],context())).toEqual(m);
    const conflict=event(1);conflict.end.value=59;
    expect(learnConsumptionResidual([...events,conflict],context()).rejected).toContainEqual({id:event(1).id,reason:'EVENT_ID_COLLISION'});
  });
  it('does not count overlapping windows as independent evidence, even with different trip IDs',()=>{
    const first=event(1),copy={...structuredClone(first),id:'second',tripId:'different'};
    const m=learnConsumptionResidual([first,copy,event(2),event(3)],context());expect(m.independentTrips).toBe(3);
    expect(m.rejected[0].reason).toBe('OVERLAPPING_TRIP_WINDOW');
  });
  it('combines disjoint windows of a trip into one independent training unit',()=>{
    const a=event(1),b=structuredClone(a);b.id='later';b.start.observedAt=a.end.observedAt;b.end.observedAt=new Date(Date.parse(a.end.observedAt)+3600000).toISOString();b.receivedAt=b.end.observedAt;
    const m=learnConsumptionResidual([a,b],context());expect(m.independentTrips).toBe(1);expect(m.weight).toBe(0);
  });
  it.each(['charging','post_charge','regeneration','uncertainty','low_coverage','small_distance','expired','future','outlier','holdout','external_holdout','owner_holdout','consent','vehicle','season','baseline','ownership'] as const)('excludes ineligible corrections: %s',kind=>{
    const e=event(1),c=context();
    switch(kind){
      case 'charging':e.chargingOccurred=true;break;
      case 'post_charge':e.kind='post_charge';break;
      case 'regeneration':e.end.value=90;break;
      case 'uncertainty':e.end.uncertaintyPercent=8;break;
      case 'low_coverage':e.gpsCoverageRatio=.5;break;
      case 'small_distance':e.distanceKm=1;break;
      case 'expired':c.now='2027-11-11T12:00:00Z';break;
      case 'future':c.now='2026-10-01T12:00:00Z';break;
      case 'outlier':e.baseline.netBatteryEnergyKwh=1;break;
      case 'holdout':e.split='holdout';break;
      case 'external_holdout':c.holdoutTripIds=[e.tripId];break;
      case 'owner_holdout':c.holdoutOwnerIds=[e.ownerId];break;
      case 'consent':c.activeConsents=[];break;
      case 'vehicle':e.scope.configurationSha256='c'.repeat(64);break;
      case 'season':e.scope.conditionBucketSha256='d'.repeat(64);break;
      case 'baseline':e.scope.referenceAlgorithmVersion='other-version';break;
      case 'ownership':e.personalVehicleId='another-car';break;
    }
    const m=learnConsumptionResidual([e],c);expect(m.independentTrips).toBe(0);expect(m.rejected).toHaveLength(1);expect(m.weight).toBe(0);
  });
  it('rejects training labels produced by an already personalized model',()=>{
    const e=event(1);expect(()=>socFeedbackSchema.parse({...e,baseline:{...e.baseline,personalWeight:.5}})).toThrow();
  });
  it('does not let zero stated manual uncertainty bypass the policy floor',()=>{
    const e=event(1);e.start.uncertaintyPercent=e.end.uncertaintyPercent=0;e.end.value=75;e.baseline.netBatteryEnergyKwh=4;
    expect(learnConsumptionResidual([e],context()).rejected[0].reason).toBe('SOC_UNCERTAINTY_TOO_HIGH');
  });
  it('needs multiple consenting owners and does not let one prolific driver dominate the cohort',()=>{
    const c=context();c.target={kind:'cohort'};
    c.activeConsents=['owner','other','third'].map(ownerId=>({ownerId,revisionId:'consent-'+ownerId,personalization:true,aggregateContribution:true}));
    const many=Array.from({length:9},(_,i)=>event(i,1.4));
    expect(learnConsumptionResidual(many,c).weight).toBe(0);
    const cohort=learnConsumptionResidual([...many,event(1,1,'other'),event(1,1,'third')],c);
    expect(cohort.contributors).toBe(3);expect(cohort.rawRatio).toBe(1);
    expect(blendConsumption(10,scope,serving,null,cohort).weights.cohort).toBe(0); // avoid counting own data twice
    const newUser={...serving,ownerId:'new-owner',activeConsentRevisionIds:c.activeConsents.map(p=>p.revisionId)};
    expect(blendConsumption(10,scope,newUser,null,cohort).weights.cohort).toBeGreaterThan(0);
  });
  it('drops revoked, expired, cross-season and cross-owner models at serving time',()=>{
    const m=learnConsumptionResidual([event(1),event(2),event(3)],context());
    expect(blendConsumption(10,scope,{...serving,activeConsentRevisionIds:[]},m,null).factor).toBe(1);
    expect(blendConsumption(10,scope,{...serving,now:'2027-01-31T12:00:00Z'},m,null).factor).toBe(1);
    expect(blendConsumption(10,{...scope,conditionBucketSha256:'d'.repeat(64)},serving,m,null).factor).toBe(1);
    expect(blendConsumption(10,scope,{...serving,ownerId:'other'},m,null).factor).toBe(1);
    expect(()=>blendConsumption(-1,scope,serving,m,null)).toThrow('regeneration');
  });
  it('decays confidence for old data without changing the underlying reference',()=>{
    const events=[event(1),event(2),event(3)],fresh=learnConsumptionResidual(events,context());
    const older=learnConsumptionResidual(events,{...context(),now:'2026-12-11T12:00:00Z'});expect(older.weight).toBeLessThan(fresh.weight);expect(older.rawRatio).toBe(fresh.rawRatio);
  });
});
