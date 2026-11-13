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
import {optimizerWorld} from '../../planning/__tests__/optimizer.fixtures';
import {EvPlanningService} from '../../planning/ev-planning.service';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {ChargingCurveEngine} from '../../charging/charging-engine';
import {ChargeStopOptimizer} from '../../planning/charge-stop-optimizer';
import {RoutingProvider} from '../../providers/routing-provider';
import {WEATHER_POLICY} from '../weather-policy';
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
  it('shares a terrain-safe cell across nearby users and re-evaluates ETA without downloading another series',async()=>{
    const transport=jest.fn(echo),first=gateway(transport),second=gateway(transport),validAt=new Date(Date.now()+600000).toISOString();
    const a={...query('a',validAt),location:{latitude:39.901,longitude:32.801},sampleElevationMeters:800,sampleReliefMeters:10};
    const b={...a,id:'b',location:{latitude:39.902,longitude:32.802},validAt:new Date(Date.now()+1800000).toISOString()};
    const [one,two]=await Promise.all([first.forecast([a],new AbortController().signal),second.forecast([b],new AbortController().signal)]);
    expect(transport).toHaveBeenCalledTimes(1);expect(one.data[0].status).toBe('available');expect(two.data[0].status).toBe('available');
    expect(one.data[0].location).toEqual(a.location);expect(two.data[0].location).toEqual(b.location);
    expect(one.data[0].metadata?.sampledLocation).toEqual(two.data[0].metadata?.sampledLocation);
    expect(one.data[0].metadata?.sampleDistanceMeters).toBeGreaterThan(0);
    await first.forecast([{...a,validAt:new Date(Date.now()+3600000).toISOString()}],new AbortController().signal);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects cell sharing over terrain/elevation differences without relaxing provider coordinate validation',async()=>{
    const transport=jest.fn(echo),service=gateway(transport),validAt=new Date(Date.now()+600000).toISOString();
    const q={...query('a',validAt),location:{latitude:39.901,longitude:32.801},sampleElevationMeters:1200,sampleReliefMeters:10};
    const result=await service.forecast([q],new AbortController().signal);
    expect(result.data[0].status).toBe('available');expect(transport).toHaveBeenCalledTimes(2);
    // The actual model elevation stays 800 m, and the exact requested coordinate is used after rejecting the cell.
    expect(result.data[0].metadata?.sampledElevationMeters).toBe(800);expect(result.data[0].metadata?.sampleDistanceMeters).toBeLessThan(30);
    const wrong=gateway(async()=>{const d=freshDocument();(d.body as any).geometry.coordinates=[0,0,0];return d;});
    const rejected=await wrong.forecast([{...q,id:'other',location:{latitude:40.101,longitude:33.101}}],new AbortController().signal);
    expect(rejected.data[0].status).toBe('provider_unavailable');
  });
  it('uses provider, adapter version and geographic location as independent cache identities',async()=>{
    const transport=jest.fn(async()=>freshDocument()),cache=store(transport);
    await cache.get('fake','1',url,signal,budget(),validate);
    await cache.get('fake','2',url,signal,budget(),validate);
    await cache.get('fake-other','1',url,signal,budget(),validate);
    await cache.get('fake','1',url+'/different-cell',signal,budget(),validate);
    expect(transport).toHaveBeenCalledTimes(4);
    expect((await pool.query('SELECT count(*)::int AS n FROM weather_forecast_cache')).rows[0].n).toBe(4);
  });
  it('serves a real road-to-weather preliminary preview over HTTP without calling the charge optimizer',async()=>{
    const transport=jest.fn(echo),service=gateway(transport),route=normalizeRoadTrip(trip(),roadRequest(),roadConfig,new Map());
    const routing={routes:jest.fn(async()=>({data:{schemaVersion:'1.0.0',routes:[route]},source:route.source}))};
    const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(DatabaseService).useValue(database)
      .overrideProvider(WeatherService).useValue(service).overrideProvider(RoutingProvider).useValue(routing).compile();
    const app=module.createNestApplication();try{
      app.setGlobalPrefix('v1');await app.listen(0,'127.0.0.1');const address=(await app.getUrl())+'/v1/weather/route-preview';
      const request=roadRequest(),body={origin:request.origin,destination:request.destination,departureAt:new Date(Date.now()+300000).toISOString(),avoidTolls:false,avoidFerries:false};
      const post=(value:unknown)=>fetch(address,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
      const response=await post(body),preview=await response.json();
      expect(response.status).toBe(200);expect(preview.status).toBe('preliminary_route');expect(preview.energyReady).toBe(false);
      expect(preview.forecasts.length).toBeLessThanOrEqual(5);expect(preview.route.geometry.length).toBeGreaterThan(1);
      expect(preview).not.toHaveProperty('plan');expect(preview).not.toHaveProperty('finalChargePercent');expect(preview.route).not.toHaveProperty('segments');
      expect(transport.mock.calls.length).toBeLessThanOrEqual(5);expect((await post({})).status).toBe(400);
      const calls=transport.mock.calls.length,future=await(await post({...body,departureAt:new Date(Date.now()+259300000).toISOString()})).json();
      expect(future.route.geometry.length).toBeGreaterThan(1);expect(future.status).toBe('preliminary_route');expect(future.forecasts).toEqual([]);
      expect(transport).toHaveBeenCalledTimes(calls);
    }finally{await app.close();}
  });
  it('keeps a five-point preview preliminary and never calls an energy engine or exceeds five external acquisitions',async()=>{
    const transport=jest.fn(echo),service=gateway(transport),route=normalizeRoadTrip(trip(),roadRequest(),roadConfig,new Map());
    const input={route,departureAt:new Date(Date.now()+300000).toISOString(),stops:[]};
    const preview=await service.forPreview(input,new AbortController().signal);
    expect(preview.status).toBe('preliminary_route');expect(preview.energyReady).toBe(false);
    expect(preview.reasons).toContain('PREVIEW_REQUIRES_DETAILED_WEATHER_FOR_ENERGY');
    expect(transport.mock.calls.length).toBeLessThanOrEqual(5);
    const future=await service.forPreview({...input,departureAt:new Date(Date.now()+259300000).toISOString()},signal);
    expect(future.status).toBe('preliminary_route');expect(future.forecasts).toEqual([]);
  });
  it('reuses navigation series after a charging delay, returning only a window and explicit unknown timing',async()=>{
    const transport=jest.fn(echo),service=gateway(transport),route=normalizeRoadTrip(trip(),roadRequest(),roadConfig,new Map());
    const input={route,departureAt:new Date(Date.now()+300000).toISOString(),stops:[{segmentId:route.segments[1].id,delaySeconds:0}]};
    const first=await service.forNavigation(input,{progressMeters:0},new AbortController().signal),calls=transport.mock.calls.length;
    expect(first.status).toBe('weather_window_ready');expect(first.energyReady).toBe(false);
    const delayed=await service.forNavigation({...input,stops:[{segmentId:route.segments[1].id,delaySeconds:1800}]},
      {progressMeters:0,event:'charge_changed',previous:first.sampling!.state},new AbortController().signal);
    expect(delayed.status).toBe('weather_window_ready');expect(transport).toHaveBeenCalledTimes(calls);
    expect(Date.parse(delayed.forecasts[1].validAt)-Date.parse(first.forecasts[1].validAt)).toBe(1800000);
    const unknown=await service.forNavigation({...input,stops:[{segmentId:route.segments[1].id,delaySeconds:null}]},
      {progressMeters:0,event:'charge_changed'},new AbortController().signal);
    expect(unknown.status).toBe('insufficient_data');expect(unknown.reasons).toContain('unknown_stop_duration');
  });
  it('runs the real energy/charging optimizer with the shared weather gateway instead of a mocked weather port',async()=>{
    const world=optimizerWorld(),transport=jest.fn(async(address:string)=>{
      const doc=await echo(address);for(const point of (doc.body as any).properties.timeseries){
        point.data.instant.details.air_temperature=30;point.data.instant.details.wind_speed=0;
        for(const key of ['next_1_hours','next_6_hours'])if(point.data[key])point.data[key].details.precipitation_amount=0;
      }return doc;
    });
    const planner=new EvPlanningService(world.vehicles as any,world.roads as any,world.stations as any,gateway(transport),
      new EnergyConsumptionEngine(),new ChargingCurveEngine(),new ChargeStopOptimizer());
    const result=await planner.plan(world.request,world.preparation,world.options);
    expect(result.result.status).toBe('planned');
    if(result.result.status==='planned')expect(result.result.plan.chargingStops.length).toBeGreaterThan(0);
    expect(transport.mock.calls.length).toBeGreaterThan(0);
  },30000);
  it.each([100,1000])('coalesces %i users across two instances on a cold shared cell and measures warm reuse',async users=>{
    let dbQueries=0;const counted={pool:{query:(...args:unknown[])=>{dbQueries++;return (pool.query as any)(...args);},
      connect:async()=>{const client=await pool.connect();return {query:(...args:unknown[])=>{dbQueries++;return (client.query as any)(...args);},release:()=>client.release()};}}} as unknown as DatabaseService;
    const transport=jest.fn(async(address:string)=>{await new Promise(r=>setTimeout(r,50));return echo(address);});
    const caches=[new WeatherCacheStore(counted,transport,secret),new WeatherCacheStore(counted,transport,secret)];
    const services=caches.map(cache=>new WeatherService(config,new WeatherAdapterRegistry([new MetNorwayAdapter(config)]),cache));
    const validAt=new Date(Date.now()+600000).toISOString();
    const run=async(label:string)=>{
      const began=performance.now(),before=dbQueries,beforeCalls=transport.mock.calls.length;
      const beforeCounters=caches.map(c=>({...c.counters})),latencies:number[]=[];
      const results=await Promise.all(Array.from({length:users},async(_,i)=>{
        const start=performance.now(),q={...query('u-'+i,validAt),location:{latitude:39.901+(i%10)*.00005,longitude:32.801},sampleElevationMeters:800,sampleReliefMeters:10};
        const result=await services[i%2].forecast([q],new AbortController().signal);latencies.push(performance.now()-start);return result.data[0];
      }));latencies.sort((a,b)=>a-b);
      const count=(key:keyof typeof caches[0]['counters'])=>caches.reduce((n,c,i)=>n+c.counters[key]-beforeCounters[i][key],0);
      console.log(JSON.stringify({weatherLoad:{scenario:label,users,instances:2,weatherQueries:users,uniqueCells:1,
        cacheHits:count('hits'),cacheMisses:count('misses'),coalesced:count('coalesced'),httpCalls:transport.mock.calls.length-beforeCalls,
        dbQueries:dbQueries-before,p50Ms:latencies[Math.ceil(users*.5)-1],p95Ms:latencies[Math.ceil(users*.95)-1],p99Ms:latencies[Math.ceil(users*.99)-1],
        elapsedMs:performance.now()-began,insufficientRatio:results.filter(f=>f.status!=='available').length/users}}));
      expect(results.every(f=>f.status==='available')).toBe(true);
    };
    await run('cold');expect(transport).toHaveBeenCalledTimes(1);await run('warm');expect(transport).toHaveBeenCalledTimes(1);
    expect((await pool.query('SELECT used FROM weather_provider_state')).rows[0].used).toBe(1);
  },30000);
  it('shares all five preview points for 100 concurrent users on the same route',async()=>{
    const transport=jest.fn(echo),services=[gateway(transport),gateway(transport)],route=normalizeRoadTrip(trip(),roadRequest(),roadConfig,new Map());
    for(const s of route.segments){for(const p of s.elevationProfile??[])p.elevationMeters=800;s.elevationGainMeters=0;s.elevationLossMeters=0;}
    const input={route,departureAt:new Date(Date.now()+300000).toISOString(),stops:[]},began=performance.now();
    const results=await Promise.all(Array.from({length:100},(_,i)=>services[i%2].forPreview(input,new AbortController().signal)));
    expect(results.every(r=>r.status==='preliminary_route'&&!r.energyReady&&r.forecasts.length===5&&r.forecasts.every(f=>f.status==='available'))).toBe(true);
    const cells=(await pool.query('SELECT count(*)::int AS n FROM weather_forecast_cache')).rows[0].n;
    expect(transport.mock.calls.length).toBe(cells);expect(cells).toBeLessThanOrEqual(5);
    console.log(JSON.stringify({weatherLoad:{scenario:'same_route_preview_cold',users:100,instances:2,weatherQueries:500,uniqueCells:cells,
      httpCalls:transport.mock.calls.length,elapsedMs:performance.now()-began,insufficientRatio:0}}));
  },30000);
  it.each([100,1000])('bounds %i unrelated cold-cache requests when the global daily quota is exhausted',async users=>{
    await pool.query(`INSERT INTO weather_provider_state(provider_id,day,used) VALUES($1,(now() AT TIME ZONE 'UTC')::date,1000)`,[config.providerId]);
    const transport=jest.fn(echo),services=[gateway(transport),gateway(transport)],validAt=new Date(Date.now()+600000).toISOString(),began=performance.now();
    const latencies:number[]=[];
    const results=await Promise.all(Array.from({length:users},async(_,i)=>{
      const start=performance.now();const result=await services[i%2].forecast([{...query('distinct-'+i,validAt),
        location:{latitude:35+i*.01,longitude:30}}],new AbortController().signal);latencies.push(performance.now()-start);return result.data[0];
    }));latencies.sort((a,b)=>a-b);
    expect(results.every(f=>f.status==='budget_exhausted')).toBe(true);expect(transport).not.toHaveBeenCalled();
    expect((await pool.query('SELECT used FROM weather_provider_state')).rows[0].used).toBe(1000);
    console.log(JSON.stringify({weatherLoad:{scenario:'distinct_cold_quota_exhausted',users,instances:2,uniqueCells:users,httpCalls:0,quotaDelta:0,
      p50Ms:latencies[Math.ceil(users*.5)-1],p95Ms:latencies[Math.ceil(users*.95)-1],p99Ms:latencies[Math.ceil(users*.99)-1],
      elapsedMs:performance.now()-began,insufficientRatio:1}}));
  },30000);
  it('fences an expired lease owner after another instance successfully publishes',async()=>{
    let started!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>{started=r;}),pending=new Promise<void>(r=>{release=r;});
    const old=store(async()=>{started();await pending;return freshDocument();});
    const original=old.get('fake','1',url,new AbortController().signal,budget(),validate);await entered;
    await pool.query("UPDATE weather_forecast_cache SET lease_until=now()-interval '1 second'");
    await pool.query('UPDATE weather_provider_state SET next_allowed_at=now()');
    const replacement=await store(async()=>freshDocument()).get('fake','1',url,new AbortController().signal,budget(),validate);
    release();await expect(original).rejects.toThrow('Invalid');
    expect((await pool.query('SELECT document FROM weather_forecast_cache')).rows[0].document.body).toEqual(replacement.body);
    expect((await pool.query('SELECT blocked_until>now() AS blocked FROM weather_provider_state')).rows[0].blocked).toBe(false);
  });
  it('bounds an unresponsive provider with an independent fetch timeout and shares its backoff',async()=>{
    const original=WEATHER_POLICY.fetchTimeoutMs;Object.assign(WEATHER_POLICY,{fetchTimeoutMs:25});
    try{
      const transport=jest.fn(async()=>new Promise<WeatherDocument>(()=>{})),cache=store(transport);
      await expect(cache.get('fake','1',url,new AbortController().signal,budget(),validate)).rejects.toMatchObject({kind:'provider_unavailable'});
      await expect(store(transport).get('fake','1',url+'/new',signal,budget(),validate)).rejects.toThrow('backoff');
      expect(transport).toHaveBeenCalledTimes(1);
    }finally{Object.assign(WEATHER_POLICY,{fetchTimeoutMs:original});}
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
