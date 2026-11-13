import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { vehicleEnergyProfileSchema } from '@chargeroad/shared';
import type { KnowledgeRecord } from '@chargeroad/shared';
import { DatabaseService } from '../../database/database.service';
import { canonicalJson, parseKnowledgePackage, recordSummary } from './knowledge-package';

export class VehicleKnowledgeRepository {
  constructor(private readonly database:DatabaseService) {}
  async publish(bytes:Buffer) {
    // All CPU parsing and semantic checks precede the short, I/O-free publication transaction.
    const {data,checksum} = parseKnowledgePackage(bytes);
    const report = { schemaVersion:'knowledge-report/1',source:data.source.key,version:data.version,
      checksum, coverage:data.coverage, records:data.records.map(recordSummary) };
    const client = await this.database.pool.connect();
    const attemptId=randomUUID();
    try {
      await client.query(`INSERT INTO vehicle_knowledge_attempts(id,source_key,checksum_sha256,status) VALUES($1,$2,$3,'running')`,
        [attemptId,data.source.key,checksum]);
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='2s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('chargeroad:catalogue-publication'))");
      const previous = await client.query<{id:string}>(
        'SELECT id FROM vehicle_knowledge_batches WHERE source_key=$1 AND checksum_sha256=$2',[data.source.key,checksum]);
      if (previous.rowCount) {
        await client.query("UPDATE vehicle_knowledge_attempts SET status='unchanged',finished_at=now(),batch_id=$2 WHERE id=$1",[attemptId,previous.rows[0].id]);
        await client.query('COMMIT'); return {batchId:previous.rows[0].id,unchanged:true,report};
      }
      const newer = await client.query(
        'SELECT 1 FROM vehicle_knowledge_batches WHERE source_key=$1 AND generated_at>$2 LIMIT 1',[data.source.key,data.generatedAt]);
      if (newer.rowCount) throw new Error('Refusing an older knowledge snapshot');
      const source = await client.query<{license:string}>(
        `INSERT INTO vehicle_data_sources(key,name,homepage_url,license) VALUES($1,$2,$3,$4)
         ON CONFLICT(key) DO UPDATE SET key=EXCLUDED.key RETURNING license`,
        [data.source.key,data.source.name,data.source.homepageUrl,data.source.license]);
      if (source.rows[0].license!==data.source.license) throw new Error('Source license changed; explicit source review required');
      const batchId = randomUUID();
      await client.query(`INSERT INTO vehicle_knowledge_batches(id,source_key,version,generated_at,retrieved_at,checksum_sha256,status,report)
        VALUES($1,$2,$3,$4,$5,$6,'staging',$7::jsonb)`,
        [batchId,data.source.key,data.version,data.generatedAt,data.retrievedAt,checksum,JSON.stringify(report)]);
      for (const record of data.records) {
        const bound = await client.query<{entity_id:string}>(
          'SELECT entity_id FROM catalogue_bindings WHERE source_key=$1 AND external_id=$2',[data.source.key,record.externalId]);
        let entityId = bound.rows[0]?.entity_id;
        if(record.matchedEntityId){
          if(entityId&&entityId!==record.matchedEntityId)throw new Error('Existing source identity cannot be remapped');
          if(record.matchedLegacyId){const legacy=await client.query<{entity_id:string}>('SELECT entity_id FROM catalogue_bindings WHERE legacy_id=$1',[record.matchedLegacyId]);
            if(legacy.rows[0]?.entity_id!==record.matchedEntityId)throw new Error('Canonical and legacy match targets differ');}
          entityId=record.matchedEntityId;await this.validateMatch(client,entityId,record);
        }
        if (record.matchedLegacyId) {
          const match = await client.query<{entity_id:string}>(
            'SELECT entity_id FROM catalogue_bindings WHERE legacy_id=$1',[record.matchedLegacyId]);
          if (!match.rowCount) throw new Error('Explicit legacy match not found');
          if (entityId && entityId!==match.rows[0].entity_id) throw new Error('Existing source identity cannot be remapped');
          entityId = match.rows[0].entity_id;
          await this.validateMatch(client,entityId,record);
        }
        if (entityId && !record.matchedLegacyId) await this.validateMatch(client,entityId,record);
        if (!entityId) {
          entityId = randomUUID();
          await client.query('INSERT INTO catalogue_entities(id) VALUES($1)',[entityId]);
        }
        await client.query(`INSERT INTO catalogue_bindings(source_key,external_id,entity_id,match_basis) VALUES($1,$2,$3,$4)
          ON CONFLICT(source_key,external_id) DO NOTHING`,[data.source.key,record.externalId,entityId,record.matchBasis]);
        await client.query(`INSERT INTO vehicle_knowledge_records(batch_id,external_id,entity_id,record) VALUES($1,$2,$3,$4::jsonb)`,
          [batchId,record.externalId,entityId,JSON.stringify(record)]);
        const rows = [
          ...record.facts.map(f=>({id:f.id,kind:'fact',quality:f.evidence.quality,payload:f})),
          ...record.consumption.map(c=>({id:c.reference.id,kind:'consumption',quality:c.evidence.quality,payload:c})),
          ...record.charging.map(c=>({id:c.curve.id,kind:'charging',quality:c.evidence.quality,payload:c})),
          ...record.observations.map(o=>({id:o.id,kind:'consumption',quality:o.evidence.quality,payload:o})),
        ];
        await client.query(`INSERT INTO vehicle_reference_revisions(batch_id,entity_id,external_id,reference_id,kind,quality,payload)
          SELECT $1,$2,$3,id,kind,quality,payload FROM jsonb_to_recordset($4::jsonb)
          AS x(id text,kind text,quality text,payload jsonb)`,[batchId,entityId,record.externalId,JSON.stringify(rows)]);
        // A revised record retracts its own previously published profiles, never another source's.
        await client.query(`DELETE FROM vehicle_profile_publications pub USING vehicle_profile_revisions rev,vehicle_knowledge_batches b
          WHERE pub.revision_id=rev.id AND rev.batch_id=b.id AND pub.entity_id=$1 AND b.source_key=$2`,[entityId,data.source.key]);
        for (const profileEntry of record.profiles) {
          const revisionId=randomUUID();
          const profile = structuredClone(profileEntry.profile);
          profile.id=revisionId;
          profile.dataQuality={schemaVersion:'vehicle-quality/1.0.0',policy:profileEntry.policy,
            quality:profileEntry.evidence.quality as 'verified'|'engineering_estimate',
            verificationNote:profileEntry.evidence.verificationNote,
            assumptions:profileEntry.evidence.derivation?.assumptions ?? [],
            methodId:profileEntry.evidence.derivation?.methodId ?? null,methodVersion:profileEntry.evidence.derivation?.version ?? null};
          profile.vehicleVariantId=entityId;
          if(profile.energyModel)profile.energyModel.vehicleVariantId=entityId;
          if(profile.chargingModel)profile.chargingModel.vehicleVariantId=entityId;
          profile.consumptionReferences.forEach(r=>r.vehicleVariantId=entityId);
          profile.dcChargingCurves.forEach(c=>c.vehicleVariantId=entityId);
          const payload=canonicalJson(vehicleEnergyProfileSchema.parse(profile));
          await client.query(`INSERT INTO vehicle_profile_revisions(id,entity_id,batch_id,profile_version,policy,checksum_sha256,payload)
            VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,[revisionId,entityId,batchId,profile.version,profileEntry.policy,
            createHash('sha256').update(payload).digest('hex'),payload]);
          await client.query(`INSERT INTO vehicle_profile_publications(entity_id,policy,revision_id) VALUES($1,$2,$3)
            ON CONFLICT(entity_id,policy) DO UPDATE SET revision_id=EXCLUDED.revision_id`,[entityId,profileEntry.policy,revisionId]);
        }
        const c=record.configuration;
        const detail={...c,id:entityId,isActive:true,consumptionKwhPer100Km:null,consumptionBasis:null,
          chargePorts:c.connectorTypes.map(connector=>({kind:'declared',connector})),rangeRatings:[],dcChargeCurve:null,
          dataQuality:{missing:record.missing,profiles:record.profiles.map(p=>p.policy),sourceVersion:data.version},
          source:{key:data.source.key,name:data.source.name,license:data.source.license,homepageUrl:data.source.homepageUrl,
            vehicleId:record.externalId,version:data.version,schemaVersion:data.schemaVersion,generatedAt:data.generatedAt,
            fetchedAt:data.retrievedAt,sourceUpdatedAt:null}};
        await client.query(`INSERT INTO catalogue_entries(entity_id,primary_source,make_slug,model_slug,model_year,markets,search_text,is_active,detail)
          VALUES($1,$2,$3,$4,$5,$6,$7,true,$8::jsonb) ON CONFLICT(entity_id) DO UPDATE SET
          primary_source=EXCLUDED.primary_source,make_slug=EXCLUDED.make_slug,model_slug=EXCLUDED.model_slug,
          model_year=EXCLUDED.model_year,markets=EXCLUDED.markets,search_text=EXCLUDED.search_text,
          is_active=true,detail=EXCLUDED.detail,updated_at=now()`,
          [entityId,data.source.key,c.makeSlug,c.modelSlug,c.modelYear,c.markets,[c.make,c.model,c.trim,c.variant].join(' '),JSON.stringify(detail)]);
        await client.query(`INSERT INTO vehicle_knowledge_publications(source_key,external_id,batch_id) VALUES($1,$2,$3)
          ON CONFLICT(source_key,external_id) DO UPDATE SET batch_id=EXCLUDED.batch_id`,[data.source.key,record.externalId,batchId]);
      }
      await client.query("UPDATE vehicle_knowledge_batches SET status='published' WHERE id=$1",[batchId]);
      await client.query("UPDATE vehicle_knowledge_attempts SET status='published',finished_at=now(),batch_id=$2 WHERE id=$1",[attemptId,batchId]);
      await client.query('COMMIT');
      return {batchId,unchanged:false,report};
    } catch(error) {
      await client.query('ROLLBACK');
      await client.query("UPDATE vehicle_knowledge_attempts SET status='failed',finished_at=now(),error_code='PUBLICATION_REJECTED' WHERE id=$1",[attemptId]);
      throw error;
    }
    finally { client.release(); }
  }
  private async validateMatch(client:PoolClient,id:string,r:KnowledgeRecord) {
    const current=(await client.query<{detail:Record<string,unknown>}>('SELECT detail FROM catalogue_entries WHERE entity_id=$1',[id])).rows[0]?.detail;
    if (!current) throw new Error('Match target has no catalogue record');
    for (const field of ['makeSlug','modelSlug','modelYear','drivetrain','wheelInches','usableBatteryKwh','grossBatteryKwh','marketedBatteryKwh'] as const) {
      const previous=current[field], next=r.configuration[field];
      if (previous!==undefined && previous!==null && previous!=='unknown' && next!==null && previous!==next)
        throw new Error('Conflicting explicit match: '+field);
    }
    // Unknown legacy details are not proof of an exact match. Review rationale is retained.
    if (r.matchBasis.trim().length<20) throw new Error('Explicit matching requires a substantive review rationale');
  }
}
