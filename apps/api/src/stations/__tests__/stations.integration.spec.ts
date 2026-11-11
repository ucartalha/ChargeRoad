import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { migrate } from '../../database/migrate';
import { DatabaseService } from '../../database/database.service';
import { StationImportRepository } from '../station-import.repository';
import { DbStationDataProvider } from '../db-station.provider';
import { EpdkStationService } from '../epdk.service';
import { STATION_POLICY } from '../station-policy';
import { fixture } from '../../planning/__tests__/fixtures';
import { epdkRow,stationPackage } from './fixtures';

const integration=process.env.TEST_DATABASE_URL?describe:describe.skip;
integration('Station catalogue publication and real PostGIS corridors',()=>{
  const schema='station_test_'+randomBytes(8).toString('hex');
  let admin:Pool,pool:Pool,db:DatabaseService,importer:StationImportRepository,provider:DbStationDataProvider;
  let app:INestApplication,baseUrl:string;
  const signal=new AbortController().signal;
  beforeAll(async()=>{
    admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});await admin.query('CREATE SCHEMA '+schema);
    pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+schema,max:5});
    await migrate(pool);db={pool} as DatabaseService;importer=new StationImportRepository(db);provider=new DbStationDataProvider(db);
    const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(DatabaseService).useValue(db).compile();
    app=module.createNestApplication();app.setGlobalPrefix('v1');await app.listen(0,'127.0.0.1');baseUrl=await app.getUrl();
  },30000);
  beforeEach(async()=>{await pool.query('TRUNCATE station_data_sources,charging_locations,station_import_runs,station_source_fetch_gates CASCADE');});
  afterAll(async()=>{
    if(app)await app.close();
    if(pool)await pool.end();
    if(admin){if(!/^station_test_[a-f0-9]{16}$/.test(schema))throw new Error('Unsafe schema');await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
  });
  it('finds a station near the middle of a route instead of only checking endpoints',async()=>{
    const p=stationPackage([epdkRow('middle',39.9045,32.8),epdkRow('far',40.5,33)]);await importer.publish(p.data,p.bytes);
    const fetch=jest.spyOn(global,'fetch');
    try{
      const result=await provider.findAlongRoutes([fixture().road],100,signal,['ccs2']);
      expect(result.data.candidates).toHaveLength(1);
      expect(result.data.candidates[0].routeMatches[0].distanceMeters).toBeLessThan(1);
      expect(result.data.metadata.coverage.completeForQuery).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    }finally{fetch.mockRestore();}
  });
  it('keeps opposite/overlapping route alternatives associated without duplicating stations',async()=>{
    const p=stationPackage();await importer.publish(p.data,p.bytes);
    const second=structuredClone(fixture().road);second.id='other-route';second.segments[0].id='other-segment';
    second.segments[0].geometry.reverse();
    const result=await provider.findAlongRoutes([fixture().road,second],100,signal);
    expect(result.data.candidates).toHaveLength(1);expect(result.data.candidates[0].routeMatches).toHaveLength(2);
  });
  it('excludes private and removed locations but retains unknown access with a warning',async()=>{
    const one=epdkRow('private');one.hizmetSekli='OZEL';const two=epdkRow('unknown');two.hizmetSekli='unknown';
    const p=stationPackage([one,two,epdkRow('removed')]);p.data.records[2].lifecycle='removed';await importer.publish(p.data,p.bytes);
    const result=await provider.findAlongRoutes([fixture().road],100,signal);
    expect(result.data.candidates).toHaveLength(1);
    expect(result.data.candidates[0].station.access.publicAccess).toBeNull();
  });
  it('reports a candidate budget cap rather than claiming exhaustive search',async()=>{
    const p=stationPackage([epdkRow('one'),epdkRow('two'),epdkRow('three')]);await importer.publish(p.data,p.bytes);
    const small=new DbStationDataProvider(db,{...STATION_POLICY,maxCandidates:2});
    const result=await small.findAlongRoutes([fixture().road],100,signal);
    expect(result.data.candidates).toHaveLength(2);expect(result.data.metadata.search.truncated).toBe(true);
    expect(result.data.metadata.coverage.completeForQuery).toBe(false);
  });
  it('reports no coverage separately from no matches in verified coverage',async()=>{
    const missing=await provider.findAlongRoutes([fixture().road],100,signal);
    expect(missing.data.metadata.search.emptyReason).toBe('coverage_missing');
    const p=stationPackage([epdkRow('far',40.5,33)]);await importer.publish(p.data,p.bytes);
    const none=await provider.findAlongRoutes([fixture().road],100,signal);
    expect(none.data.metadata.search.emptyReason).toBe('no_matches_in_known_data');
  });
  it('widens a corridor in bounded steps when no candidate exists',async()=>{
    const p=stationPackage([epdkRow('wider',39.904,32.84)]);await importer.publish(p.data,p.bytes);
    const result=await provider.findAlongRoutes([fixture().road],100,signal);
    expect(result.data.candidates).toHaveLength(1);expect(result.data.metadata.search.corridorMeters).toBe(5000);
  });
  it('preserves IDs on repeated import and does not merge co-located distinct records',async()=>{
    const p=stationPackage([epdkRow('one'),epdkRow('two')]);await importer.publish(p.data,p.bytes);
    const first=await provider.findAlongRoutes([fixture().road],100,signal);
    expect(first.data.candidates).toHaveLength(2);
    expect((await importer.publish(p.data,p.bytes)).unchanged).toBe(true);
    expect((await provider.findAlongRoutes([fixture().road],100,signal)).data.candidates.map(c=>c.station.id))
      .toEqual(first.data.candidates.map(c=>c.station.id));
  });
  it('preserves the previous publication if a partial or quarantined import is staged',async()=>{
    const p=stationPackage();await importer.publish(p.data,p.bytes);
    const partial=stationPackage([epdkRow('different')]);partial.data.scope.completeSourceSnapshot=false;
    await expect(importer.publish(partial.data,partial.bytes)).rejects.toThrow('Incomplete');
    expect((await provider.findAlongRoutes([fixture().road],100,signal)).data.candidates).toHaveLength(1);
  });
  it('rolls back stage writes if an explicit cross-source identity does not exist',async()=>{
    const p=stationPackage([epdkRow('one'),epdkRow('bad')]);p.data.records[1].matchCanonicalId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';p.data.records[1].matchRationale='Nonexistent test crosswalk';
    await expect(importer.publish(p.data,p.bytes)).rejects.toThrow();
    expect((await pool.query('SELECT count(*)::int AS n FROM station_catalogue_heads')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM charging_locations')).rows[0].n).toBe(0);
  });
  it('rejects stale snapshots and keeps immutable historical revisions',async()=>{
    const p=stationPackage();await importer.publish(p.data,p.bytes);
    const old=stationPackage([epdkRow('old')]);old.data.retrievedAt='2020-01-01T00:00:00Z';
    await expect(importer.publish(old.data,old.bytes)).rejects.toThrow('older');
    await expect(pool.query("UPDATE station_location_revisions SET lifecycle='removed'")).rejects.toThrow('immutable');
  });
  it('rejects a filtered sync before making an unnecessary external request',async()=>{
    await expect(new EpdkStationService(db).sync({lisansNo:'test'})).rejects.toThrow('disabled');
  });
  it('uses the shared fetch gate to prevent a repeated country request',async()=>{
    await pool.query("INSERT INTO station_source_fetch_gates VALUES('epdk-stations','national',now()+interval '1 hour')");
    await expect(new EpdkStationService(db).sync()).rejects.toThrow('quota');
  });
  it('rejects oversized geometry and caller cancellation',async()=>{
    const limited=new DbStationDataProvider(db,{...STATION_POLICY,maxGeometryPoints:1});
    await expect(limited.findAlongRoutes([fixture().road],100,signal)).rejects.toThrow('geometry budget');
    const abort=new AbortController();abort.abort();await expect(provider.findAlongRoutes([fixture().road],100,abort.signal)).rejects.toThrow();
  });
  it('keeps lower-priority complementary access evidence without overriding known primary fields',async()=>{
    const primary=stationPackage();await importer.publish(primary.data,primary.bytes);
    const id=(await pool.query('SELECT location_id FROM station_catalogue_heads')).rows[0].location_id;
    const secondary=stationPackage([epdkRow('secondary')]);secondary.data.source.key='synthetic-secondary';secondary.data.source.priority=20;
    secondary.data.records[0].matchCanonicalId=id;secondary.data.records[0].matchRationale='Explicit fixture crosswalk to the same physical location';
    secondary.data.records[0].station.source.sourceId='synthetic-secondary';
    secondary.data.records[0].station.access.membershipRequired=true;
    await importer.publish(secondary.data,secondary.bytes);
    const result=await provider.findAlongRoutes([fixture().road],100,signal);
    expect(result.data.candidates).toHaveLength(1);
    expect(result.data.candidates[0].station.access.membershipRequired).toBe(true);
    expect(result.data.candidates[0].fieldEvidence?.['access.membershipRequired'].sourceId).toBe('synthetic-secondary');
    expect(result.data.candidates[0].connectorClaims).toHaveLength(1);
  });
  it('does not silently move a stable location ID by several kilometres',async()=>{
    const p=stationPackage();await importer.publish(p.data,p.bytes);
    const moved=stationPackage([epdkRow('ŞRJ/test',40,33)]);
    await expect(importer.publish(moved.data,moved.bytes)).rejects.toThrow('coordinate move');
    expect((await provider.findAlongRoutes([fixture().road],100,signal)).data.candidates).toHaveLength(1);
  });
  it('serves bounded viewport/detail endpoints without contacting an outside provider',async()=>{
    const p=stationPackage();await importer.publish(p.data,p.bytes);
    const response=await fetch(baseUrl+'/v1/stations?west=32.7&east=32.9&south=39.8&north=40&limit=1');
    expect(response.status).toBe(200);const body=await response.json();expect(body.total).toBe(1);
    expect((await fetch(baseUrl+'/v1/stations/'+body.items[0].id)).status).toBe(200);
    expect((await fetch(baseUrl+'/v1/stations?west=-180&east=180&south=-90&north=90')).status).toBe(400);
    expect((await fetch(baseUrl+'/v1/stations/not-a-uuid')).status).toBe(404);
  });
  it('can republish an old content state only after a genuinely newer acquisition receipt',async()=>{
    const first=stationPackage();first.data.retrievedAt='2026-01-01T00:00:00Z';
    const initial=await importer.publish(first.data,first.bytes);
    const row=epdkRow();row.sarjIstasyonuAdi='Changed name';
    const second=stationPackage([row]);second.data.retrievedAt='2026-01-02T00:00:00Z';await importer.publish(second.data,second.bytes);
    await expect(importer.publish(first.data,first.bytes)).rejects.toThrow('older');
    first.data.retrievedAt='2026-01-03T00:00:00Z';
    const restored=await importer.publish(first.data,first.bytes);
    expect(restored.published).toBe(true);expect(restored.snapshotId).toBe(initial.snapshotId);
    expect((await pool.query('SELECT payload FROM station_catalogue_heads')).rows[0].payload.station.name).toBe('Synthetic station');
  });
  it('serializes concurrent identical publications without duplicate identities',async()=>{
    const p=stationPackage();const results=await Promise.all([importer.publish(p.data,p.bytes),importer.publish(p.data,p.bytes)]);
    expect(new Set(results.map(r=>r.snapshotId)).size).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM charging_locations')).rows[0].n).toBe(1);
    expect(results.filter(r=>r.unchanged)).toHaveLength(1);
  });
});
