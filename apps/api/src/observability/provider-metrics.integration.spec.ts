import {createServer,Server} from 'node:http';
import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {DatabaseService} from '../database/database.service';
import {migrate} from '../database/migrate';
import {PgRoadClient} from '../roads/road-client';
import {WeatherCacheStore} from '../weather/weather-cache';
import {weatherTransport} from '../weather/weather-http';
import {config as roadConfig} from '../roads/__tests__/fixtures';
import {config as weatherConfig} from '../weather/__tests__/fixtures';
import {withPlanningMetrics} from './planning-metrics';
import type {PlanningMetricSnapshot} from './planning-metrics';
const integration=process.env.TEST_DATABASE_URL?describe:describe.skip;
integration('Measured cold/warm provider cache: real PG and loopback HTTP, no external provider',()=>{
 const schema='perf_metrics_'+randomBytes(8).toString('hex'),id='33333333-3333-4333-8333-333333333333';
 let admin:Pool,pool:Pool,db:DatabaseService,server:Server,base:string;let requests=0;
 beforeAll(async()=>{admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});await admin.query('CREATE SCHEMA '+schema);
  pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+schema});await migrate(pool);db={pool} as DatabaseService;
  server=createServer((req,res)=>{req.resume();req.once('end',()=>{requests++;res.setHeader('Content-Type','application/json');res.setHeader('Expires',new Date(Date.now()+3600000).toUTCString());
   res.setHeader('Last-Modified',new Date(Date.now()-60000).toUTCString());res.end('{"fixture":true}');});});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 },30000);
 afterAll(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));if(pool)await pool.end();if(admin){if(!/^perf_metrics_[a-f0-9]{16}$/.test(schema))throw new Error('Unsafe test schema');await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}});
 async function trace(operation:()=>Promise<unknown>){let snapshot!:PlanningMetricSnapshot;await withPlanningMetrics(id,operation,{enabled:true,scope:'provider_smoke',sink:s=>snapshot=s});return snapshot;}
 it('counts actual road fetch attempts and preserves cache hits/budget use across clients',async()=>{
  const config={...roadConfig,baseUrl:base},client=new PgRoadClient(db,config,'synthetic-metrics-secret-longer-than-32-chars');const before=requests;
  const cold=await trace(()=>client.post(config.providerId,base+'/route',{},new AbortController().signal));
  const warm=await trace(()=>new PgRoadClient(db,config,'synthetic-metrics-secret-longer-than-32-chars').post(config.providerId,base+'/route',{},new AbortController().signal));
  expect(cold.counters).toMatchObject({road_pg_cache_misses:1,road_http_acquisitions:1});expect(cold.stages.road_http!.count).toBe(1);
  expect(warm.counters).toMatchObject({road_pg_cache_hits:1,road_http_acquisitions:0});expect(warm.stages.road_http).toBeUndefined();expect(requests-before).toBe(1);
  expect((await pool.query('SELECT used FROM road_provider_budget WHERE provider_id=$1',[config.providerId])).rows[0].used).toBe(1);
  console.log(JSON.stringify({providerCacheMetrics:{provider:'loopback_road_fixture',n:1,coldMs:cold.durationMs,warmMs:warm.durationMs,coldHttp:cold.counters.road_http_acquisitions,warmHttp:warm.counters.road_http_acquisitions}}));
 });
 it('counts actual weather fetches and PG reuse independently of global store counters',async()=>{
  const cache=new WeatherCacheStore(db,weatherTransport(weatherConfig),'synthetic-weather-metrics-secret-longer-than-32-chars'),signal=new AbortController().signal,budget={used:0,limit:5},before=requests;
  const cold=await trace(()=>cache.get('fixture-weather','v1',base+'/weather',signal,budget,()=>{}));
  const warm=await trace(()=>cache.get('fixture-weather','v1',base+'/weather',signal,budget,()=>{}));
  expect(cold.counters).toMatchObject({weather_pg_cache_misses:1,weather_http_acquisitions:1});expect(warm.counters).toMatchObject({weather_pg_cache_hits:1,weather_http_acquisitions:0});
  expect(budget.used).toBe(1);expect(requests-before).toBe(1);expect(cache.counters.externalCalls).toBe(1);
  console.log(JSON.stringify({providerCacheMetrics:{provider:'loopback_weather_fixture',n:1,coldMs:cold.durationMs,warmMs:warm.durationMs,coldHttp:cold.counters.weather_http_acquisitions,warmHttp:warm.counters.weather_http_acquisitions}}));
 });
});
