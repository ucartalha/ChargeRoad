import { z } from 'zod';
import { chargingStationSchema } from './stations.js';
import { connectorStandardSchema,idSchema,nonnegativeSchema,positiveSchema,sourceReferenceSchema,timestampSchema } from './common.js';

export const connectorClaimSchema=z.object({
  sourceConnectorId:idSchema,standard:connectorStandardSchema,powerType:z.enum(['ac','dc','unknown']),
  maxPowerKw:positiveSchema.nullable(),rawType:z.string(),
  granularity:z.enum(['physical_connector','equipment_summary']).optional(),
  quantity:z.number().int().positive().nullable().optional(),
  maxCurrentA:positiveSchema.nullable().optional(),
  nominalVoltageV:positiveSchema.nullable().optional(),
  operatorReference:z.string().max(500).nullable().optional(),
}).strict();
export const stationLicenseEvidenceSchema=z.object({
  sourceId:idSchema,dataProviderId:idSchema,license:idSchema,licenseUrl:z.string().url(),
  attribution:z.string().min(1),recordUrl:z.string().url(),
}).strict();
const stationEvidenceMetadata={
  licenseEvidence:z.array(stationLicenseEvidenceSchema).optional(),
  recordUpdatedAt:timestampSchema.nullable().optional(),
};
export const stationCatalogueRecordSchema=z.object({
  ...stationEvidenceMetadata,
  externalId:idSchema,partyId:idSchema,countryCode:z.string().regex(/^[A-Z]{2}$/),
  matchCanonicalId:z.string().uuid().nullable(),matchRationale:z.string().min(1).nullable(),
  lifecycle:z.enum(['operating','temporarily_closed','planned','removed','unknown']),
  station:chargingStationSchema,connectorClaims:z.array(connectorClaimSchema).max(1000),
  warnings:z.array(z.string().min(1)),raw:z.record(z.string(),z.unknown()),
}).strict().superRefine((r,ctx)=>{
  if(new Set(r.connectorClaims.map(c=>c.sourceConnectorId)).size!==r.connectorClaims.length)
    ctx.addIssue({code:'custom',message:'Duplicate connector claim identity'});
  if(r.matchCanonicalId && !r.matchRationale)ctx.addIssue({code:'custom',message:'Cross-source matching requires review rationale'});
});
export const stationImportPackageSchema=z.object({
  schemaVersion:z.literal('station-catalogue/1.0.0'),
  source:z.object({key:idSchema,name:idSchema,homepageUrl:z.string().url(),
    permission:z.enum(['public_service','open_license','explicit_permission','own_data']),
    permissionReference:z.string().min(1),attribution:z.string().min(1),license:z.string().min(1).nullable(),
    priority:z.number().int().min(1).max(1000)}).strict(),
  scope:z.object({countryCode:z.string().regex(/^[A-Z]{2}$/),key:idSchema,
    completeSourceSnapshot:z.boolean(),geographicCoverageVerified:z.boolean(),
    coverageBounds:z.object({minLatitude:z.number().min(-90).max(90),maxLatitude:z.number().min(-90).max(90),
      minLongitude:z.number().min(-180).max(180),maxLongitude:z.number().min(-180).max(180)}).strict()
      .refine(b=>b.minLatitude<=b.maxLatitude&&b.minLongitude<=b.maxLongitude).nullable().optional().default(null)}).strict(),
  version:idSchema,retrievedAt:timestampSchema,sourceUpdatedAt:timestampSchema.nullable(),
  rawSha256:z.string().regex(/^[a-f0-9]{64}$/),sourceRowCount:z.number().int().nonnegative(),
  quarantine:z.array(z.object({externalId:z.string().nullable(),reason:z.string(),raw:z.unknown()}).strict()),
  records:z.array(stationCatalogueRecordSchema).max(100000),
}).strict().superRefine((p,ctx)=>{
  const keys=p.records.map(r=>JSON.stringify([r.countryCode,r.partyId,r.externalId]));
  if(new Set(keys).size!==keys.length)ctx.addIssue({code:'custom',message:'Duplicate source location identity'});
  if(p.sourceRowCount!==p.records.length+p.quarantine.length)ctx.addIssue({code:'custom',message:'Unaccounted source records'});
  if(p.records.some(r=>r.countryCode!==p.scope.countryCode))ctx.addIssue({code:'custom',message:'Record exceeds source scope'});
  if(!p.records.length && p.scope.completeSourceSnapshot)ctx.addIssue({code:'custom',message:'Empty complete snapshot requires explicit removal review'});
  if(p.scope.geographicCoverageVerified && !p.scope.coverageBounds)ctx.addIssue({code:'custom',message:'Verified coverage needs explicit bounds'});
});
export const stationSearchMetadataSchema=z.object({
  schemaVersion:z.literal('station-search/1.0.0'),
  coverage:z.object({completeForQuery:z.boolean(),sources:z.array(z.object({
    sourceId:idSchema,scopeKey:idSchema,countryCode:z.string(),snapshotId:z.string().uuid(),
    sourceSnapshotComplete:z.boolean(),geographicCoverageVerified:z.boolean(),
    retrievedAt:timestampSchema,sourceUpdatedAt:timestampSchema.nullable(),
    stale:z.boolean(),qualityExclusions:z.number().int().nonnegative(),
  }).strict()),notes:z.array(z.string())}).strict(),
  search:z.object({policyVersion:idSchema,corridorMeters:positiveSchema,maxCandidates:z.number().int().positive(),
    truncated:z.boolean(),nextCorridorMeters:positiveSchema.nullable(),
    emptyReason:z.enum(['none','no_matches_in_known_data','coverage_missing','search_limited'])}).strict(),
  revisions:z.array(z.object({snapshotId:z.string().uuid(),checksumSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()),
}).strict().superRefine((m,ctx)=>{
  if(m.coverage.completeForQuery && (m.search.truncated || !m.coverage.sources.length ||
      m.coverage.sources.some(s=>!s.sourceSnapshotComplete||!s.geographicCoverageVerified||s.stale||s.qualityExclusions>0)))
    ctx.addIssue({code:'custom',message:'Incomplete source/search cannot claim complete query coverage'});
});
export const stationCandidateSetSchema=z.object({
  metadata:stationSearchMetadataSchema,
  candidates:z.array(z.object({
    ...stationEvidenceMetadata,
    station:chargingStationSchema,lifecycle:stationCatalogueRecordSchema.shape.lifecycle,
    connectorClaims:z.array(connectorClaimSchema),warnings:z.array(z.string()),
    fieldEvidence:z.record(z.string(),sourceReferenceSchema).optional(),
    routeMatches:z.array(z.object({routeId:idSchema,segmentId:idSchema,distanceMeters:nonnegativeSchema,
      segmentProgress:nonnegativeSchema.max(1)}).strict()).min(1),
  }).strict()).max(500),
}).strict().superRefine((r,ctx)=>{
  if(new Set(r.candidates.map(c=>c.station.id)).size!==r.candidates.length)
    ctx.addIssue({code:'custom',message:'Duplicate canonical station candidate'});
  if(r.candidates.length>r.metadata.search.maxCandidates)ctx.addIssue({code:'custom',message:'Candidate budget exceeded'});
});
export type StationImportPackage=z.infer<typeof stationImportPackageSchema>;
export type StationCatalogueRecord=z.infer<typeof stationCatalogueRecordSchema>;
export type StationCandidateSet=z.infer<typeof stationCandidateSetSchema>;
export type StationSearchMetadata=z.infer<typeof stationSearchMetadataSchema>;
