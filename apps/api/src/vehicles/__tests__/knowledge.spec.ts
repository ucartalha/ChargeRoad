import { knowledgePackageSchema, drivingWindowSchema, personalizedModelRevisionSchema } from '@chargeroad/shared';
import { canonicalJson, parseKnowledgePackage } from '../knowledge/knowledge-package';
import { knowledgeFixture, knowledgeBytes } from './knowledge.fixtures';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Vehicle knowledge boundaries',()=>{
  it('retains multiple speeds and seasons for the same vehicle',()=>{
    const parsed=parseKnowledgePackage(knowledgeBytes(knowledgeFixture())).data.records[0];
    expect(parsed.consumption.map(c=>c.reference.conditions.meanSpeedKph)).toEqual([60,90,120]);
    expect(parsed.consumption.map(c=>c.season)).toEqual(['winter','summer','summer']);
  });
  it('accepts an explicit versioned engineering profile in its own policy',()=>{
    expect(parseKnowledgePackage(knowledgeBytes(knowledgeFixture(true))).data.records[0].profiles[0].policy).toBe('allow_engineering_estimates');
  });
  it('prevents estimates being published under verified-only policy',()=>{
    const p=knowledgeFixture(true);p.records[0].profiles[0].policy='verified_only';
    expect(()=>parseKnowledgePackage(knowledgeBytes(p))).toThrow('Verified-only');
  });
  it.each(['source_reported','quarantined'] as const)('does not promote %s evidence',quality=>{
    const p=knowledgeFixture();p.records[0].consumption[0].evidence.quality=quality;
    expect(()=>parseKnowledgePackage(knowledgeBytes(p))).toThrow('Unreviewed');
  });
  it('rejects a forged profile without the referenced consumption',()=>{
    const p=knowledgeFixture();p.records[0].profiles[0].profile.consumptionReferences[0].valueKwhPer100Km=1;
    expect(()=>parseKnowledgePackage(knowledgeBytes(p))).toThrow('evidence');
  });
  it('requires usable capacity evidence, not a gross-capacity substitution',()=>{
    const p=knowledgeFixture();p.records[0].facts=[];
    expect(()=>parseKnowledgePackage(knowledgeBytes(p))).toThrow('usable-capacity');
  });
  it('rejects unconverted AC-grid consumption in a published profile',()=>{
    const p=knowledgeFixture();p.records[0].profiles[0].profile.consumptionReferences[0].energyBoundary='ac_grid';
    expect(()=>parseKnowledgePackage(knowledgeBytes(p))).toThrow('battery-DC');
  });
  it('requires method and conditions for an estimate',()=>{
    const p=knowledgeFixture(true);p.records[0].profiles[0].evidence.derivation=null;
    expect(knowledgePackageSchema.safeParse(p).success).toBe(false);
  });
  it('does not accept a reference from a different vehicle or repeated source identity',()=>{
    const p=knowledgeFixture();p.records[0].consumption[0].reference.vehicleVariantId='other';
    expect(()=>parseKnowledgePackage(knowledgeBytes(p))).toThrow('vehicle');
    const duplicate=knowledgeFixture();duplicate.records.push(duplicate.records[0]);
    expect(knowledgePackageSchema.safeParse(duplicate).success).toBe(false);
  });
  it('canonicalizes JSONB key ordering for immutable profile checksums',()=>{
    expect(canonicalJson({z:[{b:1,a:2}],a:1})).toBe(canonicalJson({a:1,z:[{a:2,b:1}]}));
  });
  it('retains confirmed owner consumption ranges without inventing speed or midpoint measurements',()=>{
    const bytes=readFileSync(resolve(__dirname,'../../../../../data/vehicle-knowledge/pilots-v2-user-observations.json'));
    const p=parseKnowledgePackage(bytes).data;
    const observations=p.records[0].observations;
    expect(observations.map(o=>o.consumptionKwhPer100Km)).toEqual([{min:11,max:12},{min:17,max:20},{min:18,max:22}]);
    expect(observations[0].speedKph).toBeNull();
    expect(observations[1].speedKind).toBe('cruise_target');
    expect(observations[1].hvac).toBe('unknown');
    expect(observations[2].ambientTemperatureC).toEqual({min:25,max:null,minInclusive:false});
    expect(p.records[1].observations).toEqual([]);
    expect(p.records[0].profiles).toEqual([]);
  });
});

describe('Personalization design contracts without public collection endpoints',()=>{
  const window=()=>({schemaVersion:'driving-window/1.0.0',id:'window-1',tripId:'trip-1',profileId:'profile-1',
    windowPolicyVersion:'15m-v1',startsAt:'2026-11-10T08:00:00Z',endsAt:'2026-11-10T08:15:00Z',
    elapsedSeconds:900,validSeconds:900,distanceMeters:15000,stoppedSeconds:0,partial:false,gpsCoverageRatio:1,
    speedBins:[{minKph:50,maxKph:70,seconds:900,distanceMeters:15000}],
    conditions:{ambientTemperatureC:10,hvac:'on',season:'winter'},energy:{origin:'unknown'}});
  it('allows speed-only observations while keeping energy unknown',()=>{
    expect(drivingWindowSchema.parse(window()).energy.origin).toBe('unknown');
  });
  it('does not accept GPS-derived energy relabeled measured without energy evidence',()=>{
    expect(drivingWindowSchema.safeParse({...window(),energy:{origin:'measured',batteryDcKwh:2}}).success).toBe(false);
  });
  it('rejects invalid coverage and double-counted speed bins',()=>{
    expect(drivingWindowSchema.safeParse({...window(),validSeconds:901}).success).toBe(false);
    const w=window();w.speedBins.push(w.speedBins[0]);
    expect(drivingWindowSchema.safeParse(w).success).toBe(false);
  });
  it('keeps observed speed separate from legal and planned speed',()=>{
    const context={segmentId:'segment',routeSnapshotSha256:'a'.repeat(64),legalSpeedLimitKph:90,
      expectedTrafficSpeedKph:80,plannedSpeedKph:80,observedMeanSpeedKph:100,
      source:knowledgeFixture().records[0].facts[0].evidence.source,validAt:null};
    expect(drivingWindowSchema.safeParse({...window(),roadSpeedContext:[context]}).success).toBe(true);
    expect(drivingWindowSchema.safeParse({...window(),roadSpeedContext:[{...context,plannedSpeedKph:100}]}).success).toBe(false);
  });
  it('rejects training/holdout leakage and excess personal weight',()=>{
    const model={schemaVersion:'personal-energy/1.0.0',id:'revision',profileId:'profile',referenceProfileRevision:'reference',
      modelVersion:'1',policyVersion:'1',trainingTripIds:['trip-1'],holdoutTripIds:['trip-1'],
      independentTripCount:1,distanceKm:100,dataCutoffAt:'2026-11-10T10:00:00Z',conditions:{},referenceWeight:.8,personalWeight:.2};
    expect(personalizedModelRevisionSchema.safeParse(model).success).toBe(false);
    model.holdoutTripIds=['trip-2'];
    expect(personalizedModelRevisionSchema.safeParse(model).success).toBe(true);
    expect(personalizedModelRevisionSchema.safeParse({...model,personalWeight:1,referenceWeight:0}).success).toBe(false);
  });
});
