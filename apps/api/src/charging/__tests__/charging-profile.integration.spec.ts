import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {DatabaseService} from '../../database/database.service';
import {migrate} from '../../database/migrate';
import {VehicleKnowledgeRepository} from '../../vehicles/knowledge/knowledge.repository';
import {DbVehicleEnergyProvider} from '../../vehicles/knowledge/db-vehicle-energy.provider';
import {knowledgeFixture,knowledgeBytes} from '../../vehicles/__tests__/knowledge.fixtures';
import {chargingFixture} from './fixtures';
import {ChargingCurveEngine} from '../charging-engine';
const integration=process.env.TEST_DATABASE_URL?describe:describe.skip;
integration('Immutable stored DC calibration',()=>{
  const schema='charging_test_'+randomBytes(8).toString('hex'),signal=new AbortController().signal;
  let admin:Pool,pool:Pool,db:DatabaseService;
  beforeAll(async()=>{admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});await admin.query('CREATE SCHEMA '+schema);
    pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+schema,max:5});await migrate(pool);db={pool} as DatabaseService;},30000);
  afterAll(async()=>{await pool.end();if(!/^charging_test_[a-f0-9]{16}$/.test(schema))throw new Error('Unsafe test schema');await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();});
  function packet(){
    const p=knowledgeFixture(true),record=p.records[0],v=chargingFixture().vehicle;
    p.source.key='charging-fixture-'+randomBytes(4).toString('hex');v.vehicleVariantId=record.externalId;
    v.chargingModel!.vehicleVariantId=record.externalId;v.capacity.referenceUsableBatteryKwh=60;
    v.dcChargingCurves.forEach(c=>c.vehicleVariantId=record.externalId);v.consumptionReferences=[];
    record.consumption=[];record.profiles[0].profile=v;record.charging=v.dcChargingCurves.map(curve=>({curve:structuredClone(curve),evidence:structuredClone(record.profiles[0].evidence)}));
    return p;
  }
  it('publishes a charge-only profile, normalizes identities and replays after a replacement',async()=>{
    const p=packet(),repo=new VehicleKnowledgeRepository(db);await repo.publish(knowledgeBytes(p));
    const id=(await pool.query('SELECT entity_id FROM catalogue_bindings WHERE source_key=$1',[p.source.key])).rows[0].entity_id;
    const provider=new DbVehicleEnergyProvider(db),old=(await provider.profile(id,signal,'allow_engineering_estimates')).data!;
    expect(old.chargingModel!.vehicleVariantId).toBe(id);expect(old.dcChargingCurves[0].vehicleVariantId).toBe(id);
    const input=chargingFixture();input.vehicle=old;input.capacity={...input.capacity,vehicleVariantId:id,vehicleProfileId:old.id,vehicleProfileVersion:old.version,referenceUsableKwh:60,effectiveKwh:60};
    const engine=new ChargingCurveEngine(),before=await engine.evaluate(input,signal);expect(before.status).toBe('estimated');expect(before.chargingSeconds).toBeCloseTo(1296,7);
    p.version='2';p.generatedAt='2026-01-03T00:00:00Z';p.records[0].profiles[0].profile.chargingModel!.version='2';p.records[0].profiles[0].profile.chargingModel!.auxiliaryPackKw=10;
    await repo.publish(knowledgeBytes(p));const fresh=(await provider.profile(id,signal,'allow_engineering_estimates')).data!;
    expect(fresh.id).not.toBe(old.id);expect(fresh.chargingModel!.version).toBe('2');expect(await engine.evaluate(input,signal)).toEqual(before);
    expect((await engine.evaluate({...input,vehicle:fresh},signal)).reasons).toContain('CAPACITY_SNAPSHOT_PROFILE_MISMATCH');
    const after=await engine.evaluate({...input,vehicle:fresh,capacity:{...input.capacity,vehicleProfileId:fresh.id}},signal);
    expect(after.chargingSeconds!).toBeGreaterThan(before.chargingSeconds!);
    await expect(pool.query("UPDATE vehicle_profile_revisions SET payload=payload || '{\"tampered\":true}'::jsonb WHERE entity_id=$1",[id])).rejects.toThrow();
  });
  it('rejects estimated calibration published under a verified policy atomically',async()=>{
    const p=packet();p.records[0].profiles[0].policy='verified_only';
    await expect(new VehicleKnowledgeRepository(db).publish(knowledgeBytes(p))).rejects.toThrow();
    expect((await pool.query('SELECT count(*)::int AS n FROM vehicle_knowledge_batches WHERE source_key=$1',[p.source.key])).rows[0].n).toBe(0);
  });
});
