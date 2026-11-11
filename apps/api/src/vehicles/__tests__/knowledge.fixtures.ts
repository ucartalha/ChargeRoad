import type { KnowledgePackage } from '@chargeroad/shared';
import { fixture, source } from '../../planning/__tests__/fixtures';

export function knowledgeFixture(estimated=false):KnowledgePackage {
  const profile=structuredClone(fixture().vehicle);
  const id='synthetic-test-vehicle';
  profile.vehicleVariantId=id;
  profile.capacity.referenceUsableBatteryKwh=60;
  profile.consumptionReferences=[60,90,120].map((speed,i)=>({
    ...structuredClone(profile.consumptionReferences[0]),id:'speed-'+speed,vehicleVariantId:id,
    valueKwhPer100Km:[15,20,28][i],conditions:{...profile.consumptionReferences[0].conditions,meanSpeedKph:speed},
  }));
  const evidence={quality:estimated?'engineering_estimate' as const:'verified' as const,source:source('vehicles'),
    verificationNote:'Synthetic test evidence, never real vehicle performance.',
    derivation:estimated?{methodId:'synthetic-test-method',version:'1',inputReferences:[source('vehicles')],
      assumptions:['Synthetic values for publication tests only.'],applicability:'Synthetic test vehicle only',uncertainty:null}:null};
  return {schemaVersion:'vehicle-knowledge/1.0.0',source:{key:'synthetic-test-source',name:'Synthetic test evidence',
    homepageUrl:'https://example.invalid',license:'TEST-ONLY',permission:'own_data',permissionReference:'Test fixtures only'},
    version:'1',generatedAt:'2026-01-02T00:00:00Z',retrievedAt:'2026-01-02T01:00:00Z',coverage:'supplemental',records:[{
      externalId:id,matchedLegacyId:null,matchBasis:'Synthetic identity and configuration established solely for integration testing.',
      configuration:{make:'Test Make',makeSlug:'test_make',model:'Test EV',modelSlug:'test_ev',modelYear:2025,
        trim:'Standard',trimSlug:'standard',variant:'RWD',variantSlug:'rwd',vehicleType:'car',markets:['TR'],
        marketedBatteryKwh:null,usableBatteryKwh:60,grossBatteryKwh:64,drivetrain:'rwd',wheelInches:18,
        motorPowerKw:null,maxAcChargeKw:11,maxDcChargeKw:150,connectorTypes:['ccs2']},
      facts:[{id:'usable-capacity',field:'usableBatteryKwh',value:60,evidence}],
      consumption:profile.consumptionReferences.map((reference,i)=>({reference:structuredClone(reference),evidence:structuredClone(evidence),speedKind:'constant_speed',
        season:i===0?'winter':'summer',seasonBasis:'Synthetic fixed test condition, not a real season observation',
        distanceKm:100,durationSeconds:100/reference.conditions.meanSpeedKph!*3600})),
      charging:[],observations:[],profiles:[{policy:estimated?'allow_engineering_estimates':'verified_only',evidence,profile}],missing:['dc_curve'],
    }]};
}
export const knowledgeBytes=(data:unknown)=>Buffer.from(JSON.stringify(data));
