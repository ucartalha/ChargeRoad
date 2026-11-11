import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {DatabaseService} from '../../database/database.service';
import {migrate} from '../../database/migrate';
import {VehicleKnowledgeRepository} from '../../vehicles/knowledge/knowledge.repository';
import {DbVehicleEnergyProvider} from '../../vehicles/knowledge/db-vehicle-energy.provider';
import {knowledgeFixture,knowledgeBytes} from '../../vehicles/__tests__/knowledge.fixtures';
import {energyFixture} from './fixtures';
import {EnergyConsumptionEngine} from '../energy-engine';

const integration=process.env.TEST_DATABASE_URL?describe:describe.skip;
integration('Immutable DB energy calibration profiles',()=>{
  const schema='energy_test_'+randomBytes(8).toString('hex'),signal=new AbortController().signal;
  let admin:Pool,pool:Pool,db:DatabaseService;
  beforeAll(async()=>{admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});await admin.query('CREATE SCHEMA '+schema);
    pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+schema,max:5});await migrate(pool);db={pool} as DatabaseService;},30000);
  afterAll(async()=>{await pool.end();if(!/^energy_test_[a-f0-9]{16}$/.test(schema))throw new Error('Unsafe schema');await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();});
  function packageFixture(){
    const p=knowledgeFixture(true),r=p.records[0],v=energyFixture().vehicle;
    p.source.key='energy-fixture-'+randomBytes(4).toString('hex');v.vehicleVariantId=r.externalId;v.capacity.referenceUsableBatteryKwh=60;
    v.consumptionReferences[0].vehicleVariantId=r.externalId;r.profiles[0].profile=v;
    r.consumption=[{...r.consumption[0],reference:structuredClone(v.consumptionReferences[0])}];return p;
  }
  it('publishes, reads and executes the same versioned model without upstream requests',async()=>{
    const p=packageFixture();await new VehicleKnowledgeRepository(db).publish(knowledgeBytes(p));
    const id=(await pool.query('SELECT entity_id FROM catalogue_bindings WHERE source_key=$1',[p.source.key])).rows[0].entity_id;
    const provider=new DbVehicleEnergyProvider(db),fetch=jest.spyOn(global,'fetch');
    try{
      expect((await provider.profile(id,signal,'verified_only')).data).toBeNull();
      const profile=(await provider.profile(id,signal,'allow_engineering_estimates')).data!;
      expect(profile.energyModel?.id).toBe('synthetic-model');
      const input=energyFixture();input.vehicle=profile;input.request.vehicleVariantId=id;
      const result=await new EnergyConsumptionEngine().evaluate(input,signal);
      expect(result.status).toBe('estimated');expect(result.capacityKwh).toBe(60);expect(fetch).not.toHaveBeenCalled();
      await expect(pool.query("UPDATE vehicle_profile_revisions SET payload=payload || '{\"tampered\":true}'::jsonb WHERE entity_id=$1",[id])).rejects.toThrow();
    }finally{fetch.mockRestore();}
  });
  it('keeps the previous replay unchanged after a new calibration is published',async()=>{
    const p=packageFixture(),repository=new VehicleKnowledgeRepository(db);await repository.publish(knowledgeBytes(p));
    const id=(await pool.query('SELECT entity_id FROM catalogue_bindings WHERE source_key=$1',[p.source.key])).rows[0].entity_id;
    const provider=new DbVehicleEnergyProvider(db),old=(await provider.profile(id,signal,'allow_engineering_estimates')).data!;
    const input=energyFixture();input.vehicle=old;input.request.vehicleVariantId=id;const engine=new EnergyConsumptionEngine(),before=await engine.evaluate(input,signal);
    p.version='2';p.generatedAt='2026-01-03T00:00:00Z';p.records[0].profiles[0].profile.energyModel!.version='2';
    p.records[0].profiles[0].profile.energyModel!.baseAuxiliaryKw=1;await repository.publish(knowledgeBytes(p));
    const fresh=(await provider.profile(id,signal,'allow_engineering_estimates')).data!;
    expect(fresh.energyModel?.version).toBe('2');expect(await engine.evaluate(input,signal)).toEqual(before);
    const after=await engine.evaluate({...input,vehicle:fresh},signal);expect(after.netBatteryEnergyKwh-before.netBatteryEnergyKwh).toBeCloseTo(1/60,10);
    expect(after.inputChecksumSha256).not.toBe(before.inputChecksumSha256);
  });
  it('rejects a supposed verified publication that contains an estimated calibration',async()=>{
    const p=packageFixture();p.records[0].profiles[0].policy='verified_only';
    await expect(new VehicleKnowledgeRepository(db).publish(knowledgeBytes(p))).rejects.toThrow();
    expect((await pool.query('SELECT count(*)::int AS n FROM vehicle_knowledge_batches WHERE source_key=$1',[p.source.key])).rows[0].n).toBe(0);
  });
});
