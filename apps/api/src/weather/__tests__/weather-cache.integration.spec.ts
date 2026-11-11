import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {Test} from '@nestjs/testing';
import {DatabaseService} from '../../database/database.service';
import {migrate} from '../../database/migrate';
import {AppModule} from '../../app.module';
import {WeatherCacheStore} from '../weather-cache';
import {WeatherService,WeatherAdapterRegistry} from '../weather.service';
import {MetNorwayAdapter} from '../met-norway.adapter';
import {WeatherUnavailable} from '../weather-ports';
import type {WeatherTransport,WeatherDocument} from '../weather-ports';
import {config,document,query,instant} from './fixtures';
import {normalizeRoadTrip} from '../../roads/normalize-road';
import {trip,roadRequest,config as roadConfig} from '../../roads/__tests__/fixtures';
const integration=process.env.TEST_DATABASE_URL?describe:describe.skip;
const fixtureBase=Math.floor(Date.now()/3600000)*3600000;

function freshDocument():WeatherDocument{
  const doc=document(),body=doc.body as any,base=fixtureBase;
  body.properties.meta.updated_at=new Date(base).toISOString();
  for(const point of body.properties.timeseries)point.time=new Date(Date.parse(point.time)-Date.parse(instant)+base).toISOString();
  return {...doc,fetchedAt:new Date().toISOString(),validatedAt:new Date().toISOString()};
}
integration('Weather shared PostgreSQL acquisition and HTTP',()=>{
  const schema='weather_test_'+randomBytes(8).toString('hex'),signal=new AbortController().signal;
  const secret='test-weather-only-secret-at-least-32-characters',url='https://example.invalid/weather';
  let admin:Pool,pool:Pool,database:DatabaseService;
  beforeAll(async()=>{admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});await admin.query('CREATE SCHEMA '+schema);
    pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+schema,max:8});await migrate(pool);database={pool} as DatabaseService;},30000);
  beforeEach(async()=>{await pool.query('TRUNCATE weather_forecast_cache,weather_provider_state');});
  afterAll(async()=>{await pool.end();if(!/^weather_test_[a-f0-9]{16}$/.test(schema))throw new Error('Unsafe test schema');await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();});
  const validate=(doc:WeatherDocument)=>{new MetNorwayAdapter(config).parse(doc);};
  const store=(transport:WeatherTransport)=>new WeatherCacheStore(database,transport,secret);
  const budget=()=>({used:0,limit:16});
  function gateway(transport:WeatherTransport){return new WeatherService(config,new WeatherAdapterRegistry([new MetNorwayAdapter(config)]),store(transport));}
  const echo=async(address:string)=>{const doc=freshDocument(),u=new URL(address);(doc.body as any).geometry.coordinates=[Number(u.searchParams.get('lon')),Number(u.searchParams.get('lat')),800];return doc;};

  it('deduplicates across instances even when the initiating client disconnects',async()=>{
    let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>{entered=r;}),pending=new Promise<void>(r=>{release=r;});
    const transport=jest.fn(async()=>{entered();await pending;return freshDocument();});
    const controller=new AbortController(),owner=store(transport).get('fake','1',url,controller.signal,budget(),validate);
    await started;const waiter=store(transport).get('fake','1',url,signal,budget(),validate);
    controller.abort(new Error('Disconnected'));await expect(owner).rejects.toThrow('Disconnected');
    release();expect((await waiter).body).toBeDefined();expect(transport).toHaveBeenCalledTimes(1);
    expect((await pool.query('SELECT request_key FROM weather_forecast_cache')).rows[0].request_key).toMatch(/^[a-f0-9]{64}$/);
  });
  it('honors Expires, revalidates with Last-Modified and preserves source/fetch dates on 304',async()=>{
    const first=freshDocument(),second={...first,status:304,body:null,validatedAt:new Date(Date.now()+1000).toISOString()};
    const transport=jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const cache=store(transport);await cache.get('fake','1',url,signal,budget(),validate);
    await cache.get('fake','1',url,signal,budget(),validate);expect(transport).toHaveBeenCalledTimes(1);
    await pool.query("UPDATE weather_forecast_cache SET expires_at=now()-interval '1 second'");
    await pool.query('UPDATE weather_provider_state SET next_allowed_at=now()');
    const result=await cache.get('fake','1',url,signal,budget(),validate);
    expect(transport.mock.calls[1][1]).toBe(first.lastModified);expect(result.fetchedAt).toBe(first.validatedAt);
    expect(result.validatedAt).toBe(second.validatedAt);expect(result.body).toEqual(first.body);
  });
  it('rejects a bodyless 304 without any cached representation and shares failure backoff',async()=>{
    const transport=jest.fn(async()=>({...freshDocument(),status:304,body:null}));
    await expect(store(transport).get('fake','1',url,signal,budget(),validate)).rejects.toThrow('Invalid');
    await expect(store(transport).get('fake','1',url+'/other',signal,budget(),validate)).rejects.toThrow('backoff');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('fences a late worker without releasing or blocking the successor',async()=>{
    const successor=randomUUID(),transport=async()=>{await pool.query('UPDATE weather_forecast_cache SET token=$1,generation=generation+1',[successor]);return freshDocument();};
    await expect(store(transport).get('fake','1',url,signal,budget(),validate)).rejects.toThrow('Invalid');
    expect((await pool.query('SELECT token FROM weather_forecast_cache')).rows[0].token).toBe(successor);
    expect((await pool.query('SELECT blocked_until>now() AS blocked FROM weather_provider_state')).rows[0].blocked).toBe(false);
  });
  it('limits in-flight fetches across instances and charges only actual external acquisitions',async()=>{
    let active=0,max=0;const transport=jest.fn(async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,800));active--;return freshDocument();});
    await Promise.all(Array.from({length:4},(_,i)=>store(transport).get('fake','1',url+'/'+i,signal,budget(),validate)));
    expect(max).toBeLessThanOrEqual(2);expect(transport).toHaveBeenCalledTimes(4);
    expect((await pool.query('SELECT used FROM weather_provider_state')).rows[0].used).toBe(4);
  });
  it('enforces shared 429 and daily limits, resetting the day without silently falling back',async()=>{
    const fail=jest.fn(async()=>{throw new WeatherUnavailable('budget_exhausted','Too many',120);});
    await expect(store(fail).get('fake','1',url,signal,budget(),validate)).rejects.toMatchObject({retrySeconds:120});
    await expect(store(fail).get('fake','1',url,signal,budget(),validate)).rejects.toMatchObject({kind:'budget_exhausted'});
    await expect(store(fail).get('fake','1',url+'/b',signal,budget(),validate)).rejects.toThrow('backoff');
    expect(fail).toHaveBeenCalledTimes(1);
    await pool.query("UPDATE weather_provider_state SET blocked_until=now(),next_allowed_at=now(),used=1000");
    await expect(store(fail).get('fake','1',url+'/c',signal,budget(),validate)).rejects.toThrow('daily');
    await pool.query("UPDATE weather_provider_state SET day=day-1");
    const ok=jest.fn(async()=>freshDocument());await store(ok).get('fake','1',url+'/d',signal,budget(),validate);
    expect((await pool.query('SELECT used FROM weather_provider_state')).rows[0].used).toBe(1);
  });
  it('shares one series across passage times and reports budget exhaustion or wrong coordinates explicitly',async()=>{
    const transport=jest.fn(echo),service=gateway(transport),later=new Date(Date.now()+600000).toISOString();
    const q=query('one',later);const result=await service.forecast([q,{...q,id:'two',validAt:new Date(Date.now()+2400000).toISOString()}],signal);
    expect(result.data.every(f=>f.status==='available')).toBe(true);expect(transport).toHaveBeenCalledTimes(1);
    await service.forecast([{...q,validAt:new Date(Date.now()+3600000).toISOString()}],signal);expect(transport).toHaveBeenCalledTimes(1);
    const depleted={used:16,limit:16};
    await expect(store(transport).get('fake','1',url+'/new',signal,depleted,validate)).rejects.toMatchObject({kind:'budget_exhausted'});
    const wrong=gateway(async()=>{const d=freshDocument();(d.body as any).geometry.coordinates=[0,0,0];return d;});
    expect((await wrong.forecast([{...q,location:{latitude:40,longitude:33}}],signal)).data[0].status).toBe('provider_unavailable');
  });
  it('does not refresh an HTTP-fresh but meteorologically stale document before Expires',async()=>{
    const old=freshDocument();(old.body as any).properties.meta.updated_at=new Date(Date.now()-13*3600000).toISOString();
    const transport=jest.fn(async()=>old),service=gateway(transport),q=query('q',new Date(Date.now()+600000).toISOString());
    const result=await service.forecast([q],signal);expect(result.data[0].status).toBe('stale');
    await service.forecast([q],signal);expect(transport).toHaveBeenCalledTimes(1);
  });
  it('serves bounded HTTP queries, rejects malformed/early times and returns preview without fetching after 72 hours',async()=>{
    const transport=jest.fn(echo),service=gateway(transport);
    const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(DatabaseService).useValue(database)
      .overrideProvider(WeatherService).useValue(service).compile();
    const app=module.createNestApplication();try{
      app.setGlobalPrefix('v1');await app.listen(0,'127.0.0.1');const address=(await app.getUrl())+'/v1/weather/forecast';
      const departureAt=new Date(Date.now()+300000).toISOString(),q=query('q',new Date(Date.now()+600000).toISOString());
      const post=(body:unknown)=>fetch(address,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const response=await post({departureAt,queries:[q]});expect(response.status).toBe(200);expect((await response.json()).status).toBe('weather_ready');
      expect((await post({})).status).toBe(400);
      expect((await post({departureAt,queries:[{...q,validAt:instant}]})).status).toBe(400);
      const beyond=new Date(Date.now()+259300000).toISOString();
      expect((await(await post({departureAt:beyond,queries:[{...q,validAt:beyond}]})).json()).status).toBe('preliminary_route');
      expect(transport).toHaveBeenCalledTimes(1);
    }finally{await app.close();}
  });
  it('physically removes expired cache entries while preserving an active lease',async()=>{
    const cache=store(async()=>freshDocument());await cache.get('fake','1',url,signal,budget(),validate);
    await pool.query("UPDATE weather_forecast_cache SET retain_until=now()-interval '1 second',token=$1,lease_until=now()+interval '1 minute'",[randomUUID()]);
    expect(await cache.cleanup()).toBe(0);
    await pool.query('UPDATE weather_forecast_cache SET token=NULL,lease_until=NULL');expect(await cache.cleanup()).toBe(1);
  });
  it('moves downstream route forecasts after charging, preserving the source series',async()=>{
    const transport=jest.fn(echo),service=gateway(transport),route=normalizeRoadTrip(trip(),roadRequest(),roadConfig,new Map());
    const request={route,departureAt:new Date(Date.now()+300000).toISOString(),stops:[]};
    const before=await service.forRoute(request,signal);
    const delayed=await service.forRoute({...request,stops:[{segmentId:route.segments[1].id,delaySeconds:1800}]},signal);
    expect(before.status).toBe('weather_ready');expect(delayed.status).toBe('weather_ready');
    expect(Date.parse(delayed.forecasts[1].validAt)-Date.parse(before.forecasts[1].validAt)).toBe(1800000);
    expect(delayed.forecasts[1].sourceUpdatedAt).toBe(before.forecasts[1].sourceUpdatedAt);
    const unknown=await service.forRoute({...request,stops:[{segmentId:route.segments[1].id,delaySeconds:null}]},signal);
    expect(unknown.status).toBe('insufficient_data');expect(unknown.reasons).toContain('unknown_stop_duration');
  });
});
