import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {Test} from '@nestjs/testing';
import type {NestExpressApplication} from '@nestjs/platform-express';
import {planningApiResponseSchema} from '@chargeroad/shared';
import {AppModule} from '../../app.module';
import {DatabaseService} from '../../database/database.service';
import {migrate} from '../../database/migrate';
import {configureHttpApi} from '../../config/http-api';
import {EvPlanningService} from '../ev-planning.service';
import {RATE_LIMIT_OPTIONS} from '../../security/rate-limit.config';
import {httpPlanningWorld} from './planning-http.fixtures';
import {PlanningJobsStore} from '../http/planning-jobs.store';
import {PlanningJobsWorker} from '../http/planning-jobs.worker';
const integration=process.env.TEST_DATABASE_URL?describe:describe.skip;
integration('Planning jobs: HTTP, PostgreSQL ownership, solver, cancellation and recovery',()=>{
 const schema='planning_jobs_'+randomBytes(8).toString('hex'),secretBefore=process.env.RATE_LIMIT_IP_HASH_SECRET;
 let admin:Pool,pool:Pool,app:NestExpressApplication,url:string,store:PlanningJobsStore,worker:PlanningJobsWorker;
 let world:ReturnType<typeof httpPlanningWorld>;const planner={plan:jest.fn()},token='a'.repeat(64),otherToken='b'.repeat(64);
 const headers=(key=token)=>({'Content-Type':'application/json',Authorization:'Bearer '+key});
 beforeAll(async()=>{process.env.RATE_LIMIT_IP_HASH_SECRET='job-test-only-secret-with-at-least-32-characters';
  admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});await admin.query('CREATE SCHEMA '+schema);
  pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+schema,max:10});await migrate(pool);
  const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(DatabaseService).useValue({pool})
   .overrideProvider(EvPlanningService).useValue(planner).overrideProvider(RATE_LIMIT_OPTIONS).useValue({secret:process.env.RATE_LIMIT_IP_HASH_SECRET,
    timezone:'Europe/Istanbul',strikeLimit:3,maxPending:32,policies:Object.fromEntries(['general','planning','auth','catalogue'].map(k=>[k,{limit:1000,windowSeconds:60}]))}).compile();
  app=module.createNestApplication<NestExpressApplication>({bodyParser:false,logger:false});configureHttpApi(app);await app.listen(0,'127.0.0.1');url=await app.getUrl();
  store=app.get(PlanningJobsStore);worker=app.get(PlanningJobsWorker);
 },30000);
 beforeEach(async()=>{await pool.query('TRUNCATE planning_jobs,api_rate_limit_days CASCADE');world=httpPlanningWorld();planner.plan.mockReset();
  planner.plan.mockImplementation((...args:Parameters<EvPlanningService['plan']>)=>world.service.plan(...args));});
 afterAll(async()=>{if(app)await app.close();if(pool)await pool.end();if(admin){if(!/^planning_jobs_[a-f0-9]{16}$/.test(schema))throw new Error('Unsafe schema');await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
  if(secretBefore===undefined)delete process.env.RATE_LIMIT_IP_HASH_SECRET;else process.env.RATE_LIMIT_IP_HASH_SECRET=secretBefore;});
 const create=(body=world.body,key=token)=>fetch(url+'/v1/planning-jobs',{method:'POST',headers:headers(key),body:JSON.stringify(body)});
 const get=(suffix='',key=token)=>fetch(url+'/v1/planning-jobs/'+world.body.requestId+suffix,{headers:headers(key)});
 it('enqueues immediately, runs the actual solver, polls and downloads the matching result',async()=>{
  const response=await create();expect(response.status).toBe(201);expect((await response.json()).status).toBe('queued');expect(planner.plan).not.toHaveBeenCalled();
  const before=await get('/result');expect(before.status).toBe(409);await worker.tick();
  expect(await(await get()).json()).toMatchObject({status:'completed'});const result=await get('/result'),body=planningApiResponseSchema.parse(await result.json());
  expect(result.headers.get('cache-control')).toBe('no-store');expect(body.status).toBe('planned');expect(body.requestId).toBe(world.body.requestId);
  expect(planner.plan.mock.calls[0][0].policy.maxComputationMilliseconds).toBeGreaterThan(30000);
  expect((await pool.query('SELECT request_payload FROM planning_jobs')).rows[0].request_payload).toBeNull();
 });
 it('is idempotent but rejects changed requests and hides every endpoint from another owner',async()=>{
  expect((await create()).status).toBe(201);expect((await create()).status).toBe(201);
  expect((await create({...world.body,startingChargePercent:99})).status).toBe(409);
  expect((await create(world.body,otherToken)).status).toBe(404);expect((await get('',otherToken)).status).toBe(404);expect((await get('/result',otherToken)).status).toBe(404);
  expect((await fetch(url+'/v1/planning-jobs/'+world.body.requestId,{method:'DELETE',headers:headers(otherToken)})).status).toBe(404);
  expect((await fetch(url+'/v1/planning-jobs/'+world.body.requestId)).status).toBe(404);
  expect((await pool.query('SELECT count(*)::int n FROM planning_jobs')).rows[0].n).toBe(1);
 });
 it('cancellation arriving before submit fences a late POST without starting work',async()=>{
  const result=await fetch(url+'/v1/planning-jobs/'+world.body.requestId,{method:'DELETE',headers:headers()});expect(result.status).toBe(200);
  expect((await(await create()).json()).status).toBe('cancelled');await worker.tick();expect(planner.plan).not.toHaveBeenCalled();
 });
 it('expired worker leases cannot renew or overwrite a recovered job',async()=>{
  await create();const old=await store.claim();expect(old).not.toBeNull();
  await pool.query("UPDATE planning_jobs SET lease_until=now()-interval '1 second'");expect(await store.renew(old)).toBe(false);
  const next=await store.claim();expect(Number(next.generation)).toBe(Number(old.generation)+1);expect(await store.renew(next)).toBe(true);
  await store.finish(old,null,'OLD_WORKER');expect((await get()).status).toBe(200);expect((await(await get()).json()).status).toBe('running');
  await store.finish(next,null,'CONTROLLED_FAILURE');expect((await(await get()).json()).errorCode).toBe('CONTROLLED_FAILURE');
 });
 it('cancels a running generation and ignores its late result',async()=>{
  await create();const job=await store.claim();await store.cancel(world.body.requestId,store.owner('Bearer '+token));
  expect(await store.renew(job)).toBe(false);await store.finish(job,null,'LATE_FAILURE');expect((await(await get()).json()).status).toBe('cancelled');
 });
 it('hides expired jobs and cleans private data after TTL',async()=>{
  await create();await pool.query("UPDATE planning_jobs SET expires_at=now()-interval '1 second'");expect((await get()).status).toBe(404);expect(await store.claim()).toBeNull();
  await store.cleanup();expect((await pool.query('SELECT count(*)::int n FROM planning_jobs')).rows[0].n).toBe(0);
 });
 it('rejects invalid input before any job is enqueued',async()=>{expect((await create({...world.body,startingChargePercent:101})).status).toBe(400);
  expect((await pool.query('SELECT count(*)::int n FROM planning_jobs')).rows[0].n).toBe(0);});
 it('retains estimated navigation SOC provenance and a conditional warning through the real solver',async()=>{
  const input={...world.body,startingChargeSource:'estimated' as const,startingChargeEstimate:{planId:randomUUID(),revision:1,algorithmVersion:'navigation-test',generatedAt:new Date().toISOString()}};
  expect((await create(input)).status).toBe(201);await worker.tick();const result=planningApiResponseSchema.parse(await(await get('/result')).json());
  expect(result.status).toBe('planned');if(result.status==='planned')expect(result.plan.assumptions.some(a=>a.code==='starting_soc_model_estimate')).toBe(true);
  expect(planner.plan.mock.calls[0][0].startingChargeSource).toBe('estimated');expect(planner.plan.mock.calls[0][0].startingChargeEstimate).toEqual(input.startingChargeEstimate);
 });
 it('aborts actual in-flight solver work after cancellation, not just its public status',async()=>{
  let entered!:()=>void,aborted=false;const started=new Promise<void>(r=>entered=r);
  planner.plan.mockImplementationOnce((_a,_b,_c,signal:AbortSignal)=>new Promise((_resolve,reject)=>{entered();signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true});}));
  await create();const work=worker.tick();await started;await store.cancel(world.body.requestId,store.owner('Bearer '+token));
  await work;expect(aborted).toBe(true);expect((await(await get()).json()).status).toBe('cancelled');
 },10000);
 it('keeps status polling small under concurrent HTTP/PG load and reports p95/p99 without external calls',async()=>{
  await create();const job=await store.claim(),samples:number[]=[];let bytes=0;
  for(let batch=0;batch<5;batch++)await Promise.all(Array.from({length:20},async()=>{const start=performance.now(),response=await get(),raw=await response.text();
   samples.push(performance.now()-start);bytes+=Buffer.byteLength(raw);expect(response.status).toBe(200);expect(JSON.parse(raw).status).toBe('running');expect(raw.length).toBeLessThan(512);}));
  samples.sort((a,b)=>a-b);console.log(JSON.stringify({planningJobStatusLoad:{requests:100,concurrency:20,p95Ms:samples[94],p99Ms:samples[98],responseBytes:bytes,externalCalls:0}}));
  await store.finish(job,null,'CONTROLLED_END');expect(planner.plan).not.toHaveBeenCalled();
 });
});
