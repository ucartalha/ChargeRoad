import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {Test} from '@nestjs/testing';
import type {NestExpressApplication} from '@nestjs/platform-express';
import {AppModule} from '../../app.module';
import {configureHttpApi} from '../../config/http-api';
import {DatabaseService} from '../../database/database.service';
import {migrate} from '../../database/migrate';
import {GeocodingRegistry,GEOCODING_CONFIG} from '../geocoding-provider';
import type {GeocodingConfig} from '../geocoding-provider';
import {LocationSearchService} from '../location-search.service';
import {RoadAdapterRegistry,RoadRoutingService} from '../../roads/road-service';
import {normalizeRoadTrip} from '../../roads/normalize-road';
import {config as roadConfig,roadRequest,trip} from '../../roads/__tests__/fixtures';
const integration=process.env.TEST_DATABASE_URL?describe:describe.skip;
integration('Location HTTP, cross-instance budget/cache, and road-only fallback',()=>{
  const schema='locations_'+randomBytes(8).toString('hex'),signal=new AbortController().signal;
  let admin:Pool,pool:Pool,a:LocationSearchService,b:LocationSearchService,app:NestExpressApplication,url:string;
  const config:GeocodingConfig={enabled:true,providerId:'fake',baseUrl:'https://example.com/',dailyLimit:2,timeoutMs:5000};
  const packet={schemaVersion:'1.0.0',providerId:'fake',attribution:'© OpenStreetMap contributors',attributionUrl:'https://www.openstreetmap.org/copyright',retrievedAt:'2026-11-12T00:00:00Z',
    results:[{id:'node:1',label:'İstanbul',coordinate:{latitude:41,longitude:29}}]},search=jest.fn(),roads={preview:jest.fn()};
  beforeAll(async()=>{admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});await admin.query('CREATE SCHEMA '+schema);
    pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+schema,max:10});await migrate(pool);
    const registry=new GeocodingRegistry([{id:'fake',search}]),database={pool} as DatabaseService;
    a=new LocationSearchService(database,registry,config);b=new LocationSearchService(database,registry,config);
    const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(DatabaseService).useValue(database)
      .overrideProvider(GeocodingRegistry).useValue(registry).overrideProvider(GEOCODING_CONFIG).useValue(config).overrideProvider(RoadRoutingService).useValue(roads).compile();
    app=module.createNestApplication<NestExpressApplication>({bodyParser:false,logger:false});configureHttpApi(app);await app.listen(0,'127.0.0.1');url=await app.getUrl();
  },30000);
  beforeEach(async()=>{await pool.query('TRUNCATE geocoding_search_cache,geocoding_provider_budget,api_rate_limit_days CASCADE');config.enabled=true;search.mockReset();search.mockResolvedValue(packet);roads.preview.mockReset();});
  afterAll(async()=>{if(app)await app.close();if(pool)await pool.end();if(admin){if(!/^locations_[a-f0-9]{16}$/.test(schema))throw new Error('Unsafe schema');await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}});
  const post=(path:string,body:unknown)=>fetch(url+'/v1/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const resetWindow=()=>pool.query("UPDATE geocoding_provider_budget SET next_at=clock_timestamp()-interval '1 second'");
  it('serves a repeated search from shared cache without storing the raw query or user identity',async()=>{
    await a.search('İstanbul',signal);await expect(b.search('İstanbul',signal)).resolves.toEqual(packet);expect(search).toHaveBeenCalledTimes(1);
    const rows=(await pool.query('SELECT * FROM geocoding_search_cache')).rows;expect(rows).toHaveLength(1);expect(rows[0].cache_key).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[0]).not.toHaveProperty('query');expect(rows[0]).not.toHaveProperty('user_id');
  });
  it('lets only one cold search call the provider across two instances',async()=>{
    const settled=await Promise.allSettled(Array.from({length:12},(_,i)=>(i%2?a:b).search('different '+i,signal)));
    expect(settled.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(search).toHaveBeenCalledTimes(1);
  });
  it('enforces a shared daily budget while still allowing cached reads; the next day resets it',async()=>{
    await a.search('first',signal);await resetWindow();await b.search('second',signal);await resetWindow();await expect(a.search('third',signal)).rejects.toMatchObject({status:503});
    await expect(b.search('first',signal)).resolves.toEqual(packet);expect(search).toHaveBeenCalledTimes(2);
    await pool.query("UPDATE geocoding_provider_budget SET day=day-1");await expect(a.search('third',signal)).resolves.toEqual(packet);
  });
  it('expires cache data and fails closed on missing budget storage',async()=>{
    await a.search('query',signal);await pool.query("UPDATE geocoding_search_cache SET expires_at=clock_timestamp()-interval '1 second'");await resetWindow();await b.search('query',signal);expect(search).toHaveBeenCalledTimes(2);
    await pool.query('ALTER TABLE geocoding_provider_budget RENAME TO temporary_budget');try{await expect(a.search('new query',signal)).rejects.toMatchObject({status:503});}finally{await pool.query('ALTER TABLE temporary_budget RENAME TO geocoding_provider_budget');}
  });
  it('does not turn provider failures into cached empty successes; disables cleanly',async()=>{
    search.mockRejectedValue(new Error('secret-token'));const response=await post('locations/search',{query:'Ankara'});expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toContain('secret-token');
    expect((await pool.query('SELECT count(*)::int n FROM geocoding_search_cache')).rows[0].n).toBe(0);config.enabled=false;
    await expect(a.search('another',signal)).rejects.toMatchObject({status:503});
  });
  it('validates selected address queries over HTTP before contacting any provider',async()=>{
    for(const body of [{query:'a'},{query:'x'.repeat(121)},{query:'Ankara',url:'http://attacker'}])expect((await post('locations/search',body)).status).toBe(400);
    expect(search).not.toHaveBeenCalled();const response=await post('locations/search',{query:'Ankara'});expect(response.status).toBe(200);expect(await response.json()).toEqual(packet);expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('projects a road summary with no SOC, energy segmentation or charging recommendation',async()=>{
    const request=roadRequest(),source=trip(),route=normalizeRoadTrip(source,request,roadConfig,new Map());
    const provider={id:roadConfig.providerId,capabilities:{alternatives:true,via:true,traffic:'none' as const,freeMapReuse:true},route:jest.fn().mockResolvedValue([source]),attributes:jest.fn()};
    const service=new RoadRoutingService(roadConfig,new RoadAdapterRegistry([provider]),{post:jest.fn()},{getWays:jest.fn()},{pool} as DatabaseService);
    roads.preview.mockImplementation((...args:Parameters<RoadRoutingService['preview']>)=>service.preview(...args));
    const input={origin:source.legs[0].geometry[0],destination:source.legs.at(-1)!.geometry.at(-1)!,departureAt:new Date(Date.now()+60000).toISOString(),avoidTolls:false,avoidFerries:true};
    const response=await post('roads/preview',input),body=await response.json();expect(response.status).toBe(200);expect(body.status).toBe('available');
    expect(body.route.distanceMeters).toBe(route.distanceMeters);expect(body.route.traffic).toBe('none');expect(body.route.source.sourceId).toEqual(route.source.sourceId);expect(provider.attributes).not.toHaveBeenCalled();
    expect(body.route).not.toHaveProperty('estimatedArrivalChargePercent');expect(body.route).not.toHaveProperty('chargingStops');expect(body.route).not.toHaveProperty('segments');
    expect(roads.preview.mock.calls[0][0].alternatives).toBe(1);
    expect((await post('roads/preview',{...input,segmentationPolicy:{maxSegments:999999}})).status).toBe(400);
    expect((await post('roads/preview',{...input,destination:input.origin})).status).toBe(400);
    provider.route.mockResolvedValue(null);expect((await (await post('roads/preview',input)).json()).status).toBe('not_found');
  });
});
