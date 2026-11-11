import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { dataQualityPolicySchema, vehicleEnergyProfileSchema } from '@chargeroad/shared';
import type { DataQualityPolicy, VehicleEnergyProfile } from '@chargeroad/shared';
import { DatabaseService } from '../../database/database.service';
import { VehicleEnergyProvider } from '../../providers/vehicle-energy-provider';
import { canonicalJson } from './knowledge-package';
import type { QueryResultRow } from 'pg';

@Injectable()
export class DbVehicleEnergyProvider extends VehicleEnergyProvider {
  constructor(private readonly database:DatabaseService) { super(); }
  async resolveId(id:string, signal:AbortSignal) {
    signal.throwIfAborted();
    if (/^[0-9a-f-]{36}$/.test(id)) return id;
    const result=await this.read<{entity_id:string}>('SELECT entity_id FROM catalogue_bindings WHERE legacy_id=$1',[id],signal);
    signal.throwIfAborted();
    return result.rows[0]?.entity_id ?? id;
  }
  async profile(id:string,signal:AbortSignal,policy:DataQualityPolicy='verified_only') {
    signal.throwIfAborted();
    dataQualityPolicySchema.parse(policy);
    const entityId=await this.resolveId(id,signal);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(entityId))
      return {data:null,source:{sourceId:'chargeroad-vehicle-profiles',recordId:entityId,version:null,url:null,
        retrievedAt:new Date().toISOString(),publishedAt:null,license:null}};
    const result=await this.read<{payload:VehicleEnergyProfile;checksum_sha256:string;id:string;version:string;retrieved_at:Date}>(
      `SELECT r.payload,r.checksum_sha256,r.id,b.version,b.retrieved_at FROM vehicle_profile_publications pub
       JOIN vehicle_profile_revisions r ON r.id=pub.revision_id JOIN vehicle_knowledge_batches b ON b.id=r.batch_id
       WHERE pub.entity_id=$1 AND pub.policy=ANY($2::text[])
       ORDER BY (pub.policy='verified_only') DESC LIMIT 1`,[entityId,
        policy==='verified_only'?['verified_only']:['verified_only','allow_engineering_estimates']],signal);
    signal.throwIfAborted();
    const row=result.rows[0];
    if (row && createHash('sha256').update(canonicalJson(row.payload)).digest('hex')!==row.checksum_sha256)
      throw new Error('Published vehicle profile checksum mismatch');
    const data=row?vehicleEnergyProfileSchema.parse(row.payload):null;
    if (data && data.vehicleVariantId!==entityId) throw new Error('Published vehicle identity mismatch');
    return {data,source:{sourceId:'chargeroad-vehicle-profiles',recordId:row?.id ?? entityId,
      version:row?.version ?? null,url:null,retrievedAt:row?row.retrieved_at.toISOString():new Date().toISOString(),
      publishedAt:null,license:null}};
  }
  private async read<T extends QueryResultRow>(text:string,values:unknown[],signal:AbortSignal) {
    const client=await this.database.pool.connect();
    try {
      signal.throwIfAborted();
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout='2s'");
      const result=await client.query<T>(text,values);
      signal.throwIfAborted();
      await client.query('COMMIT');
      return result;
    } catch(error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
