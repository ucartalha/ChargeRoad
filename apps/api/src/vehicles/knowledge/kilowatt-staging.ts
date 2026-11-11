import { createHash,randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DatabaseService } from '../../database/database.service';

const recordSchema=z.object({id:z.string().min(1),brand:z.string().min(1),model:z.string().min(1),
  release_year:z.number().int().min(1900).max(2100).optional(),
  energy_consumption:z.record(z.string(),z.unknown()).optional(),dc_charger:z.record(z.string(),z.unknown()).optional(),
}).passthrough();
const manifestSchema=z.object({commit:z.string().regex(/^[a-f0-9]{40}$/),sha256:z.string().regex(/^[a-f0-9]{64}$/),
  retrievedAt:z.iso.datetime(),url:z.string().url()}).strict();
export function parseKilowattSnapshot(bytes:Buffer,rawManifest:unknown){
  if(bytes.length>16*1024*1024)throw new Error('Source snapshot exceeds 16 MiB');
  const manifest=manifestSchema.parse(rawManifest);
  if(manifest.url!==`https://raw.githubusercontent.com/KilowattApp/open-ev-data/${manifest.commit}/data/ev-data.json`)
    throw new Error('Source manifest URL/commit mismatch');
  const checksum=createHash('sha256').update(bytes).digest('hex');
  if(checksum!==manifest.sha256)throw new Error('Source snapshot checksum mismatch');
  const data=z.object({meta:z.object({updated_at:z.iso.datetime(),overall_count:z.number().int().positive().max(100000)}),
    brands:z.array(z.unknown()),data:z.array(recordSchema).min(1).max(100000)}).parse(JSON.parse(bytes.toString('utf8')));
  if(data.data.length!==data.meta.overall_count || new Set(data.data.map(r=>r.id)).size!==data.data.length)
    throw new Error('Source record count/identity mismatch');
  const candidates=data.data.map(r=>({external_id:r.id,make:r.brand,model:r.model,model_year:r.release_year??null,raw_record:r,
    review_flags:[...(!r.release_year?['missing_model_year']:[]),'exact_configuration_match_required',
      'speed_and_conditions_unverified','consumption_energy_boundary_unverified',
      ...(r.dc_charger?.is_default_charging_curve?['generic_charging_curve']:['charging_provenance_unverified'])]}));
  return {manifest,checksum,generatedAt:data.meta.updated_at,candidates,report:{source:'kilowatt-open-ev-data',
    version:manifest.commit,records:candidates.length,
    consumptionClaims:data.data.filter(r=>r.energy_consumption?.average_consumption!==undefined).length,
    genericChargingCurves:data.data.filter(r=>r.dc_charger?.is_default_charging_curve===true).length,
    acceptedSpeedTests:0,publication:'review_candidates_only'}};
}
export async function stageKilowattSnapshot(database:DatabaseService,bytes:Buffer,manifest:unknown){
  const parsed=parseKilowattSnapshot(bytes,manifest);
  const client=await database.pool.connect();
  try{
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('chargeroad:source:kilowatt'))");
    const existing=await client.query('SELECT id FROM vehicle_source_snapshots WHERE source_key=$1 AND checksum_sha256=$2',
      ['kilowatt-open-ev-data',parsed.checksum]);
    if(existing.rowCount){await client.query('COMMIT');return {snapshotId:existing.rows[0].id,unchanged:true,report:parsed.report};}
    const newer=await client.query("SELECT 1 FROM vehicle_source_snapshots WHERE source_key='kilowatt-open-ev-data' AND source_generated_at>$1 LIMIT 1",[parsed.generatedAt]);
    if(newer.rowCount)throw new Error('Refusing an older source snapshot');
    await client.query(`INSERT INTO vehicle_data_sources(key,name,homepage_url,license)
      VALUES('kilowatt-open-ev-data','Open EV Data (KilowattApp)','https://github.com/KilowattApp/open-ev-data','MIT-with-Attribution-Requirement')
      ON CONFLICT(key) DO NOTHING`);
    const id=randomUUID();
    await client.query(`INSERT INTO vehicle_source_snapshots(id,source_key,version,source_url,checksum_sha256,source_generated_at,retrieved_at,report)
      VALUES($1,'kilowatt-open-ev-data',$2,$3,$4,$5,$6,$7::jsonb)`,[id,parsed.manifest.commit,parsed.manifest.url,
      parsed.checksum,parsed.generatedAt,parsed.manifest.retrievedAt,JSON.stringify(parsed.report)]);
    for(let i=0;i<parsed.candidates.length;i+=250){
      await client.query(`INSERT INTO vehicle_source_candidates(snapshot_id,external_id,make,model,model_year,raw_record,review_flags)
        SELECT $1,external_id,make,model,model_year,raw_record,review_flags FROM jsonb_to_recordset($2::jsonb)
        AS x(external_id text,make text,model text,model_year integer,raw_record jsonb,review_flags jsonb)`,
        [id,JSON.stringify(parsed.candidates.slice(i,i+250))]);
    }
    await client.query('COMMIT');
    return {snapshotId:id,unchanged:false,report:parsed.report};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
