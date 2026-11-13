import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {knowledgePackageSchema} from '@chargeroad/shared';
import {reviewJourneyObservation} from '../observation-review';

describe('Reported journey evidence stays separate from calibration',()=>{
  function packet(){return knowledgePackageSchema.parse(JSON.parse(readFileSync(resolve(__dirname,'../../../../..','data/vehicle-knowledge/pilots-v4-istanbul-ankara-observation.json'),'utf8')));}
  it('retains all earlier observations and does not promote a conditional capacity to a fact or profile',()=>{
    const p=packet(),r=p.records.find(r=>r.externalId==='ioniq6-2023-53-rwd-18')!;
    expect(r.observations).toHaveLength(4);expect(r.profiles).toHaveLength(0);expect(r.consumption).toHaveLength(0);
    const observation=r.observations.find(o=>o.reportedJourneyContext)!;
    expect(observation.speedKph).toBeNull();expect(observation.speedKind).toBe('unknown');expect(observation.energyBoundary).toBe('unknown');
    const review=reviewJourneyObservation(observation)!;
    expect(review.displayAverageDerivedEnergyKwh?.min).toBeCloseTo(67.65);expect(review.chargedSocPoints).toBe(76);
    expect(review.dischargedSocPoints).toBe(152);expect(review.conditionalCapacityKwh?.min).toBeCloseTo(44.5065789474);
    expect(review.calibrationEligibility).toBe('context_only_not_independent_accuracy');
  });
  it('does not infer a missing starting SOC from consumption or nominal battery capacity',()=>{
    const observation=packet().records[0].observations.find(o=>o.reportedJourneyContext)!;
    observation.reportedJourneyContext!.startingChargePercent=null;
    expect(reviewJourneyObservation(observation)!.conditionalCapacityKwh).toBeNull();
  });
});
