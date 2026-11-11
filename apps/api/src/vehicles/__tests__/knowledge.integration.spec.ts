import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { migrate } from '../../database/migrate';
import { DatabaseService } from '../../database/database.service';
import { VehiclesRepository } from '../vehicles.repository';
import { VehicleKnowledgeRepository } from '../knowledge/knowledge.repository';
import { DbVehicleEnergyProvider } from '../knowledge/db-vehicle-energy.provider';
import { VehicleImportRepository } from '../import/vehicle-import.repository';
import { parseSnapshot,stableId,OPEN_EV_SOURCE } from '../import/vehicle-snapshot';
import { fixtureBytes,fixtureDataset,fixtureVehicle } from './fixtures';
import { knowledgeFixture,knowledgeBytes } from './knowledge.fixtures';
import { stageKilowattSnapshot } from '../knowledge/kilowatt-staging';
import { createHash } from 'node:crypto';

const integration=process.env.TEST_DATABASE_URL?describe:describe.skip;
integration('Canonical catalogue and knowledge publication with PostgreSQL',()=>{
  let admin:Pool,pool:Pool,db:DatabaseService,knowledge:VehicleKnowledgeRepository,vehicles:VehiclesRepository,energy:DbVehicleEnergyProvider;
  const schema='knowledge_test_'+randomBytes(8).toString('hex');
  const signal=new AbortController().signal;
  beforeAll(async()=>{
    admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
    await admin.query('CREATE SCHEMA '+schema);
    pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+schema,max:5});
    await migrate(pool);
    db={pool} as DatabaseService;knowledge=new VehicleKnowledgeRepository(db);vehicles=new VehiclesRepository(db);energy=new DbVehicleEnergyProvider(db);
  });
  afterAll(async()=>{
    if(pool)await pool.end();
    if(admin){if(!/^knowledge_test_[a-f0-9]{16}$/.test(schema))throw new Error('Unsafe schema');
      await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
  });
  const clear=async()=>{
    // Use isolated source identities per test; immutable evidence is never rewritten by cleanup.
    const p=knowledgeFixture();p.source.key='source-'+randomBytes(4).toString('hex');return p;
  };
  it('publishes multiple speed/season references atomically and only reads DB',async()=>{
    const p=await clear();const result=await knowledge.publish(knowledgeBytes(p));
    const id=(await pool.query('SELECT entity_id FROM catalogue_bindings WHERE source_key=$1',[p.source.key])).rows[0].entity_id;
    const fetch=jest.spyOn(global,'fetch');
    try{
      expect((await vehicles.findById(id))?.id).toBe(id);
      expect((await vehicles.references(id))?.items.filter((r:{kind:string})=>r.kind==='consumption')).toHaveLength(3);
      const profile=await energy.profile(id,signal);
      expect(profile.data?.consumptionReferences.map(c=>c.conditions.meanSpeedKph)).toEqual([60,90,120]);
      expect(profile.data?.vehicleVariantId).toBe(id);
      expect(fetch).not.toHaveBeenCalled();
    }finally{fetch.mockRestore();}
    expect(result.unchanged).toBe(false);
  });
  it('deduplicates concurrent identical snapshots without creating extra identities',async()=>{
    const p=await clear();const results=await Promise.all([knowledge.publish(knowledgeBytes(p)),knowledge.publish(knowledgeBytes(p))]);
    expect(results.filter(r=>r.unchanged)).toHaveLength(1);
    expect(new Set(results.map(r=>r.batchId)).size).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM catalogue_bindings WHERE source_key=$1',[p.source.key])).rows[0].n).toBe(1);
  });
  it('keeps estimates out of verified-only reads',async()=>{
    const p=knowledgeFixture(true);p.source.key='estimated-'+randomBytes(4).toString('hex');
    await knowledge.publish(knowledgeBytes(p));
    const id=(await pool.query('SELECT entity_id FROM catalogue_bindings WHERE source_key=$1',[p.source.key])).rows[0].entity_id;
    expect((await energy.profile(id,signal,'verified_only')).data).toBeNull();
    expect((await energy.profile(id,signal,'allow_engineering_estimates')).data?.dataQuality?.quality).toBe('engineering_estimate');
  });
  it('rejects stale snapshots and preserves the previously published immutable revision',async()=>{
    const p=await clear();await knowledge.publish(knowledgeBytes(p));
    const row=(await pool.query('SELECT r.id,r.entity_id FROM vehicle_profile_revisions r JOIN vehicle_knowledge_batches b ON b.id=r.batch_id WHERE b.source_key=$1',[p.source.key])).rows[0];
    const old=(await energy.profile(row.entity_id,signal)).data;
    await expect(pool.query("UPDATE vehicle_profile_revisions SET profile_version='changed' WHERE id=$1",[row.id])).rejects.toThrow('immutable');
    p.version='older';p.generatedAt='2025-01-01T00:00:00Z';
    await expect(knowledge.publish(knowledgeBytes(p))).rejects.toThrow('older');
    expect((await energy.profile(row.entity_id,signal)).data).toEqual(old);
    expect((await pool.query("SELECT count(*)::int AS n FROM vehicle_knowledge_attempts WHERE source_key=$1 AND status='failed'",[p.source.key])).rows[0].n).toBe(1);
  });
  it('rolls back every record if a later explicit match fails',async()=>{
    const p=await clear();const second=structuredClone(p.records[0]);second.externalId='second';second.profiles=[];second.consumption=[];
    second.matchedLegacyId='0'.repeat(64);p.records.push(second);
    await expect(knowledge.publish(knowledgeBytes(p))).rejects.toThrow('not found');
    expect((await pool.query('SELECT count(*)::int AS n FROM catalogue_bindings WHERE source_key=$1',[p.source.key])).rows[0].n).toBe(0);
  });
  it('keeps old mobile IDs valid and protects matched supplemental data from OpenEV refresh',async()=>{
    const importer=new VehicleImportRepository(db);
    const snapshot=parseSnapshot(fixtureBytes(fixtureDataset()),'v1.0.0','https://example.invalid/data');
    await importer.save(snapshot);
    const legacyId=stableId(OPEN_EV_SOURCE.key,fixtureVehicle().unique_code);
    const canonical=(await vehicles.findById(legacyId))!.id;
    const p=await clear();p.records[0].matchedLegacyId=legacyId;
    await knowledge.publish(knowledgeBytes(p));
    await importer.save(snapshot);
    expect((await vehicles.findById(legacyId))!.source.key).toBe(p.source.key);
    expect((await vehicles.findById(legacyId))!.id).toBe(canonical);
    expect((await energy.profile(legacyId,signal)).data?.vehicleVariantId).toBe(canonical);
  });
  it('keeps omitted supplemental records published, and retracts only a revised record profile',async()=>{
    const p=await clear();await knowledge.publish(knowledgeBytes(p));
    const id=(await pool.query('SELECT entity_id FROM catalogue_bindings WHERE source_key=$1',[p.source.key])).rows[0].entity_id;
    const additional=structuredClone(p);additional.version='2';additional.generatedAt='2026-01-03T00:00:00Z';
    additional.records[0].externalId='additional';additional.records[0].profiles=[];additional.records[0].consumption=[];
    await knowledge.publish(knowledgeBytes(additional));
    expect((await energy.profile(id,signal)).data).not.toBeNull();
    p.version='3';p.generatedAt='2026-01-04T00:00:00Z';p.records[0].profiles=[];
    await knowledge.publish(knowledgeBytes(p));
    expect((await energy.profile(id,signal)).data).toBeNull();
    expect((await pool.query('SELECT count(*)::int AS n FROM vehicle_profile_revisions WHERE entity_id=$1',[id])).rows[0].n).toBe(1);
  });
  it('leaves current readers on a complete committed view while a publication is pending',async()=>{
    const p=await clear();await knowledge.publish(knowledgeBytes(p));
    const id=(await pool.query('SELECT entity_id FROM catalogue_bindings WHERE source_key=$1',[p.source.key])).rows[0].entity_id;
    const writer=await pool.connect();
    try{
      await writer.query('BEGIN');await writer.query("UPDATE catalogue_entries SET detail=detail || '{\"trim\":\"pending\"}'::jsonb WHERE entity_id=$1",[id]);
      expect((await vehicles.findById(id))!.trim).toBe('Standard');
    }finally{await writer.query('ROLLBACK');writer.release();}
  });
  it('rejects a source identity being silently reused for a different model year',async()=>{
    const p=await clear();await knowledge.publish(knowledgeBytes(p));
    p.version='2';p.generatedAt='2026-01-03T00:00:00Z';p.records[0].configuration.modelYear=2026;
    await expect(knowledge.publish(knowledgeBytes(p))).rejects.toThrow('Conflicting explicit match');
  });
  it('stages a whole source snapshot without publishing unreviewed vehicles or curves',async()=>{
    const before=(await vehicles.list({limit:1,offset:0})).total;
    const bytes=Buffer.from(JSON.stringify({meta:{updated_at:'2026-01-01T00:00:00Z',overall_count:1},brands:[],
      data:[{id:'test-car',brand:'Synthetic',model:'Test EV',release_year:2025,
        energy_consumption:{average_consumption:20},dc_charger:{is_default_charging_curve:true}}]}));
    const manifest={commit:'a'.repeat(40),url:`https://raw.githubusercontent.com/KilowattApp/open-ev-data/${'a'.repeat(40)}/data/ev-data.json`,
      sha256:createHash('sha256').update(bytes).digest('hex'),retrievedAt:'2026-01-02T00:00:00Z'};
    const first=await stageKilowattSnapshot(db,bytes,manifest);
    const second=await stageKilowattSnapshot(db,bytes,manifest);
    expect(first.unchanged).toBe(false);expect(second.unchanged).toBe(true);
    expect((await vehicles.list({limit:1,offset:0})).total).toBe(before);
    expect((await pool.query('SELECT count(*)::int AS n FROM vehicle_source_candidates')).rows[0].n).toBe(1);
  });
});
