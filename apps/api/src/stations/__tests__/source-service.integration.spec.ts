import { randomBytes,randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { migrate } from '../../database/migrate';
import { StationSourceService } from '../sources/source-service';
import { StationSourceRegistry } from '../sources/catalogue-source';
import type { StationCatalogueSource } from '../sources/catalogue-source';
import { StationImportRepository } from '../station-import.repository';
import { ocmPackage } from './ocm.fixtures';
import { stationPackage } from './fixtures';
import { DbStationDataProvider } from '../db-station.provider';
import { fixture } from '../../planning/__tests__/fixtures';

const integration=process.env.TEST_DATABASE_URL?describe:describe.skip;
integration('Shared provider execution, fencing and policy materialization',()=>{
  const schema='source_test_'+randomBytes(8).toString('hex');
  let admin:Pool,pool:Pool,db:DatabaseService;
  beforeAll(async()=>{admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});await admin.query('CREATE SCHEMA '+schema);
    pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+schema,max:5});await migrate(pool);db={pool} as DatabaseService;},30000);
  beforeEach(async()=>{await pool.query('TRUNCATE station_data_sources,charging_locations,station_import_runs,station_source_fetch_gates,station_provider_jobs,station_catalogue_materializations CASCADE');});
  afterAll(async()=>{await pool.end();if(!/^source_test_[a-f0-9]{16}$/.test(schema))throw new Error('Unsafe schema');await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();});
  function service(transport:ConstructorParameters<typeof StationSourceService>[2]){
    const p=stationPackage();
    const source:StationCatalogueSource={key:p.data.source.key,countries:['TR'],fields:['station'],liveAvailability:false,
      async collect(_,context){await context.request({url:'https://example.invalid/data',requestClass:'test',minIntervalMs:1,maxBytes:100,timeoutMs:1000});return {package:p.data,rawBytes:p.bytes};}};
    return new StationSourceService(db,new StationSourceRegistry([source],{version:'test',providers:{[source.key]:{enabled:true,priority:10,costRank:0}},fields:{}}),transport);
  }
  it('deduplicates two workers and never holds a transaction while awaiting HTTP',async()=>{
    let release!:()=>void,started!:()=>void;const waiting=new Promise<void>(r=>{release=r;});const entered=new Promise<void>(r=>{started=r;});
    const transport=jest.fn(async()=>{started();await waiting;return {bytes:Buffer.from('{}'),retrievedAt:new Date().toISOString()};});
    const one=service(transport).sync('synthetic-stations');await entered;
    await expect(service(transport).sync('synthetic-stations')).rejects.toThrow('busy');
    const active=await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE state='idle in transaction' AND query LIKE '%station_provider%'");
    expect(active.rows[0].n).toBe(0);release();await one;expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects a stale worker before publication and does not clear the new owner',async()=>{
    const successor=randomUUID();
    const svc=service(async()=>{await pool.query(`UPDATE station_provider_jobs SET token=$1,generation=generation+1,lease_until=now()+interval '1 hour'`,[successor]);
      return {bytes:Buffer.from('{}'),retrievedAt:new Date().toISOString()};});
    await expect(svc.sync('synthetic-stations')).rejects.toThrow('stale worker');
    expect((await pool.query('SELECT count(*)::int AS n FROM station_catalogue_heads')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT token FROM station_provider_jobs')).rows[0].token).toBe(successor);
  });
  it('shares 429 backoff across workers without retrying or overwriting the catalogue',async()=>{
    const transport=jest.fn(async()=>{throw Object.assign(new Error('HTTP 429'),{status:429,retryAfter:'120'});});
    await expect(service(transport).sync('synthetic-stations')).rejects.toThrow('429');
    await expect(service(transport).sync('synthetic-stations')).rejects.toThrow('backoff');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('publishes OCM summaries with licensing, preserves canonical IDs and rebuilds field priorities without HTTP',async()=>{
    const importer=new StationImportRepository(db),primary=stationPackage();await importer.publish(primary.data,primary.bytes);
    const canonical=(await pool.query('SELECT location_id FROM station_catalogue_heads')).rows[0].location_id;
    const secondary=ocmPackage();secondary.data.retrievedAt=new Date().toISOString();
    secondary.data.records[0].matchCanonicalId=canonical;secondary.data.records[0].matchRationale='Explicit synthetic crosswalk for integration test';
    await importer.publish(secondary.data,secondary.bytes);
    const adapter:StationCatalogueSource={key:'open-charge-map',countries:['TR'],fields:['connectorClaims'],liveAvailability:false,collect:jest.fn()};
    const registry=new StationSourceRegistry([adapter],{version:'prefer-ocm',providers:{'open-charge-map':{enabled:true,priority:20,costRank:0}},fields:{connectorClaims:['open-charge-map']}});
    const transport=jest.fn();await new StationSourceService(db,registry,transport).rebuild();
    const result=await new DbStationDataProvider(db).findAlongRoutes([fixture().road],100,new AbortController().signal);
    expect(result.data.candidates).toHaveLength(1);const station=result.data.candidates[0];
    expect(station.station.id).toBe(canonical);expect(station.connectorClaims[0].quantity).toBe(4);
    expect(station.licenseEvidence?.[0].license).toBe('CC-BY-4.0');expect(station.station.evses).toEqual([]);
    expect(transport).not.toHaveBeenCalled();expect(adapter.collect).not.toHaveBeenCalled();
    expect((await pool.query('SELECT policy_version FROM station_catalogue_materializations ORDER BY id DESC LIMIT 1')).rows[0].policy_version).toBe('prefer-ocm');
  });
  it('disables a source on rebuild without deleting aliases or advertising its coverage',async()=>{
    const importer=new StationImportRepository(db),primary=stationPackage(),secondary=ocmPackage();
    await importer.publish(primary.data,primary.bytes);await importer.publish(secondary.data,secondary.bytes);
    const before=(await pool.query("SELECT location_id FROM station_source_aliases WHERE source_key='open-charge-map'")).rows[0].location_id;
    const adapters=[primary.data.source.key,'open-charge-map'].map(key=>({key,countries:['TR'],fields:['station'] as const,
      liveAvailability:false as const,collect:jest.fn()}));
    const providers={ [primary.data.source.key]:{enabled:true,priority:10,costRank:0},'open-charge-map':{enabled:false,priority:20,costRank:0}};
    await new StationSourceService(db,new StationSourceRegistry(adapters,{version:'disabled',providers,fields:{}})).rebuild();
    const result=await new DbStationDataProvider(db).findAlongRoutes([fixture().road],100,new AbortController().signal);
    expect(result.data.candidates).toHaveLength(1);expect(result.data.metadata.coverage.sources.map(s=>s.sourceId)).not.toContain('open-charge-map');
    expect((await pool.query("SELECT location_id FROM station_source_aliases WHERE source_key='open-charge-map'")).rows[0].location_id).toBe(before);
    providers['open-charge-map'].enabled=true;
    await new StationSourceService(db,new StationSourceRegistry(adapters,{version:'enabled',providers,fields:{}})).rebuild();
    expect((await pool.query('SELECT 1 FROM station_catalogue_heads WHERE location_id=$1',[before])).rowCount).toBe(1);
  });
  it('publishes only specifically reviewed quarantine exclusions and keeps quality gaps visible',async()=>{
    const importer=new StationImportRepository(db),p=ocmPackage();
    p.data.sourceRowCount=2;p.data.quarantine=[{externalId:'bad-zero',reason:'ZERO_COORDINATE',raw:{Latitude:0,Longitude:0}}];
    await expect(importer.publish(p.data,p.bytes)).rejects.toThrow('Incomplete');
    const policy={version:'reviewed-zero',providers:{'open-charge-map':{enabled:true,priority:20,costRank:0,
      quarantineReview:{version:'test-review',exclusions:[{externalId:'bad-zero',reason:'ZERO_COORDINATE'}]}}},fields:{}};
    await expect(importer.publish(p.data,p.bytes,{policy})).resolves.toMatchObject({published:true});
    const result=await new DbStationDataProvider(db).findAlongRoutes([fixture().road],100,new AbortController().signal);
    expect(result.data.metadata.coverage.completeForQuery).toBe(false);
    expect(result.data.metadata.coverage.sources[0].qualityExclusions).toBe(1);
    const wrong=ocmPackage();wrong.data.version='wrong';wrong.data.sourceRowCount=2;
    wrong.data.quarantine=[{externalId:'bad-zero',reason:'OCM_LICENSE_NOT_APPROVED',raw:{}}];
    await expect(importer.publish(wrong.data,wrong.bytes,{policy})).rejects.toThrow('Incomplete');
  });
});
