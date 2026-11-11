import { randomBytes,randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { migrate } from '../../database/migrate';
import { PgRoadClient,RoadProviderError } from '../road-client';
import { config,roadRequest,trip,tags } from './fixtures';
import { RoadAdapterRegistry,RoadRoutingService } from '../road-service';
import type { RoadShapeAdapter,RoadTripInput } from '../provider-ports';
import { OsmWayAttributeProvider } from '../osm-attributes';
import { AppModule } from '../../app.module';
import { StationImportRepository } from '../../stations/station-import.repository';
import { stationPackage } from '../../stations/__tests__/fixtures';

const integration=process.env.TEST_DATABASE_URL?describe:describe.skip;
integration('Road providers: shared caching, licensing, access and HTTP',()=>{
  const schema='road_test_'+randomBytes(8).toString('hex'),signal=new AbortController().signal;
  let admin:Pool,pool:Pool,database:DatabaseService;
  beforeAll(async()=>{admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});await admin.query('CREATE SCHEMA '+schema);
    pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+schema,max:5});await migrate(pool);database={pool} as DatabaseService;},30000);
  beforeEach(async()=>{await pool.query('TRUNCATE road_response_cache,road_provider_budget,osm_way_attributes,station_data_sources,charging_locations,station_import_runs,station_catalogue_materializations CASCADE');});
  afterAll(async()=>{await pool.end();if(!/^road_test_[a-f0-9]{16}$/.test(schema))throw new Error('Unsafe schema');await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();});
  const secret='synthetic-road-secret-at-least-32-characters';
  it('shares the same cached response across clients and never stores a raw request key',async()=>{
    let release!:()=>void,entered!:()=>void;const wait=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});
    const transport=jest.fn(async()=>{entered();await wait;return {route:'fixture'};});
    const first=new PgRoadClient(database,config,secret,transport).post('fake','https://example.invalid/route',{privateCoordinate:39.9},signal);
    await started;
    const second=new PgRoadClient(database,config,secret,transport).post('fake','https://example.invalid/route',{privateCoordinate:39.9},signal);
    release();const [a,b]=await Promise.all([first,second]);expect(a).toEqual(b);expect(transport).toHaveBeenCalledTimes(1);
    const stored=(await pool.query('SELECT request_key,payload FROM road_response_cache')).rows[0];
    expect(stored.request_key).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(stored)).not.toContain('privateCoordinate');
  });
  it('fences a late worker and preserves successor ownership',async()=>{
    const token=randomUUID();const transport=async()=>{await pool.query(`UPDATE road_response_cache SET token=$1,generation=generation+1`,[token]);return {};};
    await expect(new PgRoadClient(database,config,secret,transport).post('fake','https://example.invalid/route',{},signal)).rejects.toThrow('Expired');
    expect((await pool.query('SELECT token FROM road_response_cache')).rows[0].token).toBe(token);
  });
  it('enforces daily budget and propagates shared 429 backoff without paid fallback',async()=>{
    const transport=jest.fn(async()=>{throw new RoadProviderError('rate limited',429,120);});
    await expect(new PgRoadClient(database,config,secret,transport).post('fake','https://example.invalid/a',{},signal)).rejects.toThrow('rate');
    await expect(new PgRoadClient(database,config,secret,transport).post('fake','https://example.invalid/b',{},signal)).rejects.toThrow('quota');
    expect(transport).toHaveBeenCalledTimes(1);
    await pool.query("UPDATE road_provider_budget SET blocked_until=now(),next_allowed_at=now(),used=100");
    await expect(new PgRoadClient(database,config,secret,transport).post('fake','https://example.invalid/c',{},signal)).rejects.toThrow('quota');
  });
  it('persists only speed-related OSM tags with attribution and reuses them without network calls',async()=>{
    const provider=new OsmWayAttributeProvider(database,{...config,overpassEnabled:true});
    const client={post:jest.fn(async()=>({data:{elements:[{type:'way',id:123,tags:{maxspeed:'80',name:'not persisted'}}],osm3s:{timestamp_osm_base:'2026-11-11T00:00:00Z'}},retrievedAt:new Date().toISOString()}))};
    expect((await provider.getWays(['123'],client,signal)).get('123')?.tags).toEqual({maxspeed:'80'});
    await provider.getWays(['123'],client,signal);expect(client.post).toHaveBeenCalledTimes(1);
    expect((await pool.query('SELECT license FROM osm_way_attributes')).rows[0].license).toBe('ODbL-1.0');
  });
  it('backs off optional upstream failures across instances instead of repeating slow requests',async()=>{
    const transport=jest.fn(async()=>{throw new RoadProviderError('upstream timeout');});
    await expect(new PgRoadClient(database,config,secret,transport).post('optional','https://example.invalid/a',{},signal)).rejects.toThrow('timeout');
    await expect(new PgRoadClient(database,config,secret,transport).post('optional','https://example.invalid/b',{},signal)).rejects.toThrow('quota');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  function service(adapter:RoadShapeAdapter){return new RoadRoutingService(config,new RoadAdapterRegistry([adapter]),{post:jest.fn()},
    {getWays:jest.fn(async()=>new Map([['123',tags({maxspeed:'80'})]]))},database);}
  function fakeAdapter():RoadShapeAdapter{return {id:config.providerId,capabilities:{alternatives:true,via:true,traffic:'none',freeMapReuse:true},
    route:jest.fn(async()=>[trip()]),attributes:jest.fn(async()=>trip().legs[0].edges)};}
  it('returns an explicit road absence separately from provider failure or avoid violations',async()=>{
    const adapter=fakeAdapter();adapter.route=jest.fn(async()=>null);
    expect((await service(adapter).routes(roadRequest(),signal)).data).toBeNull();
    adapter.route=jest.fn(async()=>{throw new Error('network failed');});await expect(service(adapter).routes(roadRequest(),signal)).rejects.toThrow('network');
    adapter.route=jest.fn(async()=>[{...trip(),hasToll:true}]);await expect(service(adapter).routes({...roadRequest(),avoidTolls:true},signal)).rejects.toThrow('constraints');
  });
  it('calculates a real replacement path once, preserving the base subpath and unverified physical access',async()=>{
    const p=stationPackage();await new StationImportRepository(database).publish(p.data,p.bytes);
    const station=(await pool.query('SELECT location_id FROM station_catalogue_heads')).rows[0].location_id;
    const adapter=fakeAdapter();adapter.route=jest.fn(async(_request,locations)=>{
      if(locations.length===2)return [trip()];
      const t=trip();t.legs=[0,1].map(i=>({...t.legs[0],geometry:[locations[i],locations[i+1]],distanceMeters:600,seconds:70,
        elevation:null,maneuvers:[{begin:0,end:1,seconds:70,instruction:'fixture detour',type:1}]}));return [t];
    });
    const result=await service(adapter).stationAccess({roadRequest:roadRequest(),routeIndex:0,stationIds:[station]},signal);
    expect(result.access[0].status).toBe('routed_to_catalogue_coordinate');expect(result.access[0].physicalAccessVerified).toBe(false);
    expect(result.access[0].additionalDistanceMeters).toBeCloseTo(200);
    expect(result.access[0].replacedDistanceMeters).toBeCloseTo(1000);
  });
  it('serves road HTTP routes with source/traffic/attribution and rejects malformed requests',async()=>{
    const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(DatabaseService).useValue(database)
      .overrideProvider(RoadRoutingService).useValue(service(fakeAdapter())).compile();
    const app=module.createNestApplication();try{app.setGlobalPrefix('v1');await app.listen(0,'127.0.0.1');const url=await app.getUrl();
      const good=await fetch(url+'/v1/roads/routes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(roadRequest())});
      expect(good.status).toBe(200);const result=await good.json();expect(result.data.routes[0].metadata.traffic).toBe('none');
      expect(result.data.routes[0].metadata.attributions).toHaveLength(1);
      const bad=await fetch(url+'/v1/roads/routes',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});expect(bad.status).toBe(400);
    }finally{await app.close();}
  });
});
