import { z } from 'zod';
import { idSchema, timestampSchema, finiteSchema, nonnegativeSchema, positiveSchema, sourceReferenceSchema,percentSchema } from './common.js';
import { consumptionReferenceSchema, dcChargingCurveSchema, vehicleEnergyProfileSchema } from './vehicle-energy.js';

export const dataQualityPolicySchema = z.enum(['verified_only', 'allow_engineering_estimates']);
export const evidenceQualitySchema = z.enum(['verified', 'source_reported', 'engineering_estimate', 'quarantined']);
export const evidenceMetadataSchema = z.object({
  quality: evidenceQualitySchema,
  source: sourceReferenceSchema,
  verificationNote: z.string().min(1).max(4000),
  derivation: z.object({ methodId: idSchema, version: idSchema,
    inputReferences: z.array(sourceReferenceSchema).min(1), assumptions: z.array(z.string().min(1)).min(1),
    applicability: z.string().min(1), uncertainty: z.string().min(1).nullable(),
  }).strict().nullable(),
}).strict().superRefine((e, ctx) => {
  if (e.quality === 'engineering_estimate' && !e.derivation)
    ctx.addIssue({ code: 'custom', message: 'Engineering estimates require a versioned derivation' });
  if (e.quality === 'verified' && e.derivation)
    ctx.addIssue({ code: 'custom', message: 'A modeled estimate cannot be relabeled verified' });
});
export const consumptionEvidenceSchema = z.object({
  reference: consumptionReferenceSchema, evidence: evidenceMetadataSchema,
  speedKind: z.enum(['constant_speed', 'cruise_target', 'moving_average', 'trip_average', 'unknown']),
  season: z.enum(['summer', 'winter', 'spring', 'autumn', 'unknown']),
  seasonBasis: z.string().min(1).nullable(), distanceKm: positiveSchema.nullable(), durationSeconds: positiveSchema.nullable(),
}).strict().superRefine((r, ctx) => {
  if (r.speedKind === 'constant_speed' && r.reference.testCycle !== 'constant_speed')
    ctx.addIssue({ code: 'custom', message: 'Constant speed must have a matching test protocol' });
  if (r.season !== 'unknown' && !r.seasonBasis)
    ctx.addIssue({ code: 'custom', message: 'Season requires contextual basis' });
});
export const chargingEvidenceSchema = z.object({ curve: dcChargingCurveSchema, evidence: evidenceMetadataSchema }).strict();
export const consumptionObservationSchema=z.object({
  id:idSchema,evidence:evidenceMetadataSchema,
  consumptionKwhPer100Km:z.object({min:positiveSchema,max:positiveSchema}).strict().refine(r=>r.min<=r.max),
  speedKph:nonnegativeSchema.nullable(),speedKind:z.enum(['constant_speed','cruise_target','trip_average','unknown']),
  drivingProfile:z.enum(['city','highway','mixed','unknown']),
  ambientTemperatureC:z.object({min:finiteSchema.nullable(),max:finiteSchema.nullable(),minInclusive:z.boolean()}).strict()
    .refine(r=>r.min===null||r.max===null||r.min<=r.max),
  hvac:z.enum(['on','off','unknown']),distanceKm:positiveSchema.nullable(),
  energyBoundary:z.enum(['battery_dc','ac_grid','unknown']),rawReport:z.string().min(1),
  reportedJourneyContext:z.object({
    originLabel:z.string().min(1),destinationLabel:z.string().min(1),observedDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    approximate:z.literal(true),startingChargePercent:percentSchema.nullable(),arrivalChargePercent:percentSchema.nullable(),
    cabinTargetC:finiteSchema.nullable(),hvacActiveSharePercent:percentSchema.nullable(),hvacShareBasis:z.enum(['time','distance','unspecified']),
    cityDistanceSharePercent:percentSchema.nullable(),typicalCruisingKph:nonnegativeSchema.nullable(),otherReportedCruisingSpeedsKph:z.array(nonnegativeSchema).max(20),
    chargingStops:z.array(z.object({label:z.string().min(1),arrivalChargePercent:percentSchema.nullable(),departureChargePercent:percentSchema.nullable(),
      distanceFromOriginKm:nonnegativeSchema.nullable(),chargedEnergyKwh:nonnegativeSchema.nullable(),durationSeconds:nonnegativeSchema.nullable()}).strict()).max(20),
    notes:z.array(z.string()),
  }).strict().optional(),
}).strict().refine(r=>r.speedKind!=='constant_speed'||(r.speedKph!==null&&r.speedKph>0),'Constant-speed observation requires a speed');
export const factEvidenceSchema = z.object({
  id: idSchema, field: z.enum(['usableBatteryKwh','grossBatteryKwh','marketedBatteryKwh','motorPowerKw',
    'wheelInches','drivetrain','voltageArchitecture','modelYear','consumptionClaim','chargingCurveClaim']),
  value: z.union([finiteSchema,z.string().min(1),z.record(z.string(),z.unknown())]),
  evidence: evidenceMetadataSchema,
}).strict();
const nullablePositive = positiveSchema.nullable();
export const configurationSchema = z.object({
  make: idSchema, makeSlug: idSchema, model: idSchema, modelSlug: idSchema,
  modelYear: z.number().int().min(1900).max(2100), trim: idSchema, trimSlug: idSchema,
  variant: idSchema.nullable(), variantSlug: idSchema.nullable(), vehicleType: idSchema,
  markets: z.array(z.string().regex(/^[A-Z]{2}$/)),
  marketedBatteryKwh: nullablePositive, usableBatteryKwh: nullablePositive, grossBatteryKwh: nullablePositive,
  drivetrain: z.enum(['rwd','awd','fwd','unknown']), wheelInches: nullablePositive, motorPowerKw: nullablePositive,
  maxAcChargeKw: nullablePositive, maxDcChargeKw: nullablePositive,
  connectorTypes: z.array(idSchema),
}).strict().refine((c) => c.usableBatteryKwh === null || c.grossBatteryKwh === null || c.usableBatteryKwh <= c.grossBatteryKwh,
  'Usable capacity cannot exceed gross capacity');
export const knowledgeRecordSchema = z.object({
  matchedEntityId:z.string().uuid().optional(),
  externalId: idSchema, matchedLegacyId: idSchema.nullable(), matchBasis: z.string().min(1),
  configuration: configurationSchema,
  facts: z.array(factEvidenceSchema).max(100),
  consumption: z.array(consumptionEvidenceSchema).max(1000), charging: z.array(chargingEvidenceSchema).max(100),
  observations:z.array(consumptionObservationSchema).max(1000).optional().default([]),
  profiles: z.array(z.object({
    policy: dataQualityPolicySchema, evidence: evidenceMetadataSchema,
    profile: vehicleEnergyProfileSchema,
  }).strict()).max(2),
  missing: z.array(z.string().min(1)).max(100),
}).strict().superRefine((r, ctx) => {
  const ids = [...r.facts.map((f) => f.id), ...r.consumption.map((c) => c.reference.id), ...r.charging.map((c) => c.curve.id),...r.observations.map(o=>o.id)];
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Duplicate evidence ID' });
  if (new Set(r.profiles.map((p) => p.policy)).size !== r.profiles.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate profile policy' });
});
export const knowledgePackageSchema = z.object({
  schemaVersion: z.literal('vehicle-knowledge/1.0.0'),
  source: z.object({ key: idSchema, name: idSchema, homepageUrl: z.string().url(), license: idSchema,
    permission: z.enum(['open_license','explicit_permission','own_data']), permissionReference: z.string().min(1),
  }).strict(),
  version: idSchema, generatedAt: timestampSchema, retrievedAt: timestampSchema,
  coverage: z.literal('supplemental'), records: z.array(knowledgeRecordSchema).min(1).max(5000),
}).strict().refine((p) => new Set(p.records.map((r) => r.externalId)).size === p.records.length, 'Duplicate source identity');

// Design contracts only. Personal storage/ingestion requires ownership and consent implementation.
export const personalDrivingProfileSchema = z.object({
  schemaVersion: z.literal('personal-driving/1.0.0'), id: idSchema, ownerId: idSchema,
  vehicleEntityId: z.string().uuid(), personalVehicleId: idSchema,
  configurationSnapshotSha256: z.string().regex(/^[a-f0-9]{64}$/), consentRevisionId: idSchema,
}).strict();
export const drivingWindowSchema = z.object({
  schemaVersion: z.literal('driving-window/1.0.0'), id: idSchema, tripId: idSchema, profileId: idSchema,
  windowPolicyVersion: idSchema, startsAt: timestampSchema, endsAt: timestampSchema,
  validSeconds: nonnegativeSchema, elapsedSeconds: positiveSchema, distanceMeters: nonnegativeSchema,
  stoppedSeconds: nonnegativeSchema, partial: z.boolean(), gpsCoverageRatio: finiteSchema.min(0).max(1),
  speedBins: z.array(z.object({ minKph: nonnegativeSchema, maxKph: positiveSchema,
    seconds: nonnegativeSchema, distanceMeters: nonnegativeSchema }).strict()).max(100),
  conditions: z.object({ ambientTemperatureC: finiteSchema.nullable(), hvac: z.enum(['on','off','unknown']),
    season: z.enum(['summer','winter','spring','autumn','unknown']) }).strict(),
  roadSpeedContext:z.array(z.object({
    segmentId:idSchema,routeSnapshotSha256:z.string().regex(/^[a-f0-9]{64}$/),
    legalSpeedLimitKph:nonnegativeSchema.nullable(),expectedTrafficSpeedKph:nonnegativeSchema.nullable(),
    plannedSpeedKph:nonnegativeSchema.nullable(),observedMeanSpeedKph:nonnegativeSchema.nullable(),
    source:sourceReferenceSchema,validAt:timestampSchema.nullable(),
  }).strict().refine(c=>c.plannedSpeedKph===null || c.legalSpeedLimitKph===null || c.plannedSpeedKph<=c.legalSpeedLimitKph,
    'Planned speed cannot exceed a known legal limit')).max(1000).optional(),
  energy: z.discriminatedUnion('origin', [
    z.object({ origin: z.literal('unknown') }).strict(),
    z.object({ origin: z.literal('measured'), batteryDcKwh: finiteSchema, evidenceId: idSchema }).strict(),
    z.object({ origin: z.literal('estimated'), batteryDcKwh: finiteSchema, modelVersion: idSchema }).strict(),
  ]),
}).strict().superRefine((w, ctx) => {
  const elapsed = (Date.parse(w.endsAt) - Date.parse(w.startsAt)) / 1000;
  if (Math.abs(elapsed-w.elapsedSeconds)>0.001 || w.validSeconds>w.elapsedSeconds || w.stoppedSeconds>w.validSeconds)
    ctx.addIssue({ code:'custom', message:'Invalid window durations' });
  let end = 0;
  for (const b of w.speedBins) {
    if (b.minKph < end || b.maxKph <= b.minKph) ctx.addIssue({code:'custom',message:'Invalid/overlapping speed bins'});
    end = b.maxKph;
  }
  if (w.speedBins.reduce((n,b)=>n+b.seconds,0)>w.validSeconds+0.001 ||
      w.speedBins.reduce((n,b)=>n+b.distanceMeters,0)>w.distanceMeters+0.001)
    ctx.addIssue({code:'custom',message:'Speed bins exceed valid observation coverage'});
});
export const personalizedModelRevisionSchema = z.object({
  schemaVersion: z.literal('personal-energy/1.0.0'), id: idSchema, profileId: idSchema,
  referenceProfileRevision: idSchema, modelVersion: idSchema, policyVersion: idSchema,
  trainingTripIds: z.array(idSchema), holdoutTripIds: z.array(idSchema),
  independentTripCount: z.number().int().nonnegative(), distanceKm: nonnegativeSchema,
  dataCutoffAt: timestampSchema, conditions: z.record(z.string(),z.unknown()),
  referenceWeight: finiteSchema.gt(0).max(1), personalWeight: finiteSchema.min(0).lt(1),
}).strict().superRefine((r,ctx)=>{
  const train = new Set(r.trainingTripIds), holdout = new Set(r.holdoutTripIds);
  if (train.size!==r.trainingTripIds.length || holdout.size!==r.holdoutTripIds.length ||
      r.holdoutTripIds.some(id=>train.has(id)) || r.independentTripCount!==train.size)
    ctx.addIssue({code:'custom',message:'Independent trips and holdout must be disjoint and unique'});
  if (Math.abs(r.referenceWeight+r.personalWeight-1)>1e-9 || (!train.size && r.personalWeight!==0))
    ctx.addIssue({code:'custom',message:'Invalid reference/personal weights'});
});
export type DataQualityPolicy = z.infer<typeof dataQualityPolicySchema>;
export type KnowledgePackage = z.infer<typeof knowledgePackageSchema>;
export type KnowledgeRecord = z.infer<typeof knowledgeRecordSchema>;
