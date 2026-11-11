import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { knowledgePackageSchema } from '@chargeroad/shared';
import type { KnowledgePackage, KnowledgeRecord } from '@chargeroad/shared';

export function parseKnowledgePackage(bytes: Buffer) {
  if (bytes.length > 16*1024*1024) throw new Error('Knowledge package exceeds 16 MiB');
  const data = knowledgePackageSchema.parse(JSON.parse(bytes.toString('utf8')));
  if (data.source.key === 'open-ev-data') throw new Error('Supplemental packages cannot impersonate the legacy source');
  for (const record of data.records) validateProfiles(record);
  return { data, checksum: createHash('sha256').update(bytes).digest('hex') };
}
export function validateProfiles(r:KnowledgeRecord) {
  for (const e of [...r.consumption.map(c=>c.reference), ...r.charging.map(c=>c.curve)]) {
    if (e.vehicleVariantId!==r.externalId) throw new Error('Reference vehicle differs from source record');
  }
  for (const entry of r.profiles) {
    const p = entry.profile;
    if (p.vehicleVariantId!==r.externalId || (!p.consumptionReferences.length&&p.energyModel?.mode!=='physics'))
      throw new Error('Published profile needs the same vehicle and consumption evidence');
    if(p.energyModel?.mode==='physics'&&[p.physics.curbMassKg,p.physics.dragAreaSquareMeters,p.physics.rollingResistanceCoefficient,p.physics.drivetrainEfficiency].some(v=>v===null))
      throw new Error('A physical profile requires complete road-load parameters');
    if(p.energyModel?.quality==='engineering_estimate'&&(entry.policy==='verified_only'||entry.evidence.quality!=='engineering_estimate'))
      throw new Error('Estimated energy calibration cannot be published as verified');
    const used = [entry.evidence];
    const capacity = r.facts.find(f=>f.field==='usableBatteryKwh' && f.value===p.capacity.referenceUsableBatteryKwh &&
      isDeepStrictEqual(f.evidence.source,p.capacity.source));
    if (!capacity) throw new Error('Profile lacks usable-capacity evidence');
    used.push(capacity.evidence);
    for (const ref of p.consumptionReferences) {
      const e = r.consumption.find(e=>isDeepStrictEqual(e.reference,ref));
      if (!e || !(ref.energyBoundary==='battery_dc'||ref.energyBoundary==='ac_grid'&&ref.batteryDcConversion?.source.license))
        throw new Error('Profile lacks battery-DC consumption evidence or licensed AC-to-DC conversion');
      used.push(e.evidence);
    }
    for (const curve of p.dcChargingCurves) {
      const e = r.charging.find(e=>isDeepStrictEqual(e.curve,curve));
      if (!e) throw new Error('Profile lacks charging evidence');
      used.push(e.evidence);
    }
    if (used.some(e=>['quarantined','source_reported'].includes(e.quality))) throw new Error('Unreviewed evidence cannot be published');
    if (used.some(e=>!e.source.license || e.derivation?.inputReferences.some(input=>!input.license)))
      throw new Error('Published evidence and derivation inputs require recorded usage terms');
    if (used.some(e=>e.quality==='engineering_estimate') && entry.evidence.quality!=='engineering_estimate')
      throw new Error('A profile using estimates must itself be labeled an engineering estimate');
    if (entry.policy==='verified_only' && used.some(e=>e.quality!=='verified')) throw new Error('Verified-only policy rejects estimates');
  }
}
export function recordSummary(record:KnowledgeRecord) {
  return { externalId:record.externalId, missing:record.missing,
    facts:record.facts.length, consumption:record.consumption.length, observations:record.observations.length,charging:record.charging.length,
    publishedPolicies:record.profiles.map(p=>p.policy),
    quarantined:[...record.facts.map(f=>({id:f.id,evidence:f.evidence})),
      ...record.consumption.map(c=>({id:c.reference.id,evidence:c.evidence})),
      ...record.charging.map(c=>({id:c.curve.id,evidence:c.evidence}))]
      .filter(e=>e.evidence.quality==='quarantined').map(e=>({id:e.id,reason:e.evidence.verificationNote})) };
}
export type ParsedKnowledgePackage = { data:KnowledgePackage; checksum:string };

export function canonicalJson(value:unknown):string {
  if (Array.isArray(value)) return '['+value.map(canonicalJson).join(',')+']';
  if (value!==null && typeof value==='object') return '{'+Object.keys(value).sort()
    .map(key=>JSON.stringify(key)+':'+canonicalJson((value as Record<string,unknown>)[key])).join(',')+'}';
  return JSON.stringify(value);
}
