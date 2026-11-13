import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {Test} from '@nestjs/testing';
import type {NestExpressApplication} from '@nestjs/platform-express';
import {planningApiResponseSchema,planningApiErrorSchema} from '@chargeroad/shared';
import {AppModule} from '../../app.module';
import {DatabaseService} from '../../database/database.service';
import {migrate} from '../../database/migrate';
import {configureHttpApi} from '../../config/http-api';
import {EvPlanningService} from '../ev-planning.service';
import {RATE_LIMIT_OPTIONS} from '../../security/rate-limit.config';
import type {RateLimitOptions} from '../../security/rate-limit.config';
import {PLANNING_HTTP_OPTIONS} from '../http/planning-http-policy';
import {httpPlanningWorld} from './planning-http.fixtures';
import type {OptimizerOutcome} from '../optimizer-types';
import {RoadProviderError} from '../../roads/road-client';
const integration=process.env.TEST_DATABASE_URL?describe:describe.skip;
integration('Public planning HTTP with real shared security/admission',()=>{
  const schema='planning_http_'+randomBytes(8).toString('hex');let admin:Pool,pool:Pool,app:NestExpressApplication,otherApp:NestExpressApplication,url:string,otherUrl:string;
  let world:ReturnType<typeof httpPlanningWorld>;
  const planner={plan:jest.fn()},rate:RateLimitOptions={secret:'test-only-shared-planning-secret-32-chars',timezone:'Europe/Istanbul',strikeLimit:3,maxPending:32,
    policies:{general:{limit:1000,windowSeconds:60},catalogue:{limit:1000,windowSeconds:60},auth:{limit:1000,windowSeconds:60},planning:{limit:1000,windowSeconds:60}}};
  beforeAll(async()=>{
    admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});await admin.query('CREATE SCHEMA '+schema);
    pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+schema,max:10});await migrate(pool);
    const makeApp=async()=>{const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(DatabaseService).useValue({pool})
        .overrideProvider(EvPlanningService).useValue(planner).overrideProvider(RATE_LIMIT_OPTIONS).useValue(rate)
        .overrideProvider(PLANNING_HTTP_OPTIONS).useValue({budgetMs:3000,localConcurrency:2}).compile();
      const instance=module.createNestApplication<NestExpressApplication>({bodyParser:false,logger:false});configureHttpApi(instance);await instance.listen(0,'127.0.0.1');return instance;};
    app=await makeApp();otherApp=await makeApp();url=await app.getUrl();otherUrl=await otherApp.getUrl();
  },30000);
  beforeEach(async()=>{
    await pool.query('TRUNCATE api_rate_limit_days CASCADE');await pool.query('UPDATE planning_admission_config SET capacity=4');
    world=httpPlanningWorld();planner.plan.mockReset();planner.plan.mockImplementation((...args:Parameters<EvPlanningService['plan']>)=>world.service.plan(...args));rate.policies.planning.limit=1000;
  });
  afterAll(async()=>{if(app)await app.close();if(otherApp)await otherApp.close();if(pool)await pool.end();if(admin){if(!/^planning_http_[a-f0-9]{16}$/.test(schema))throw new Error('Unsafe schema');await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}});
  const post=(body:unknown,extra:RequestInit={})=>fetch(url+'/v1/plans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),...extra});
  const noPlan=(requestId:string):OptimizerOutcome=>({result:{status:'insufficient_data',requestId,reasons:[{code:'VEHICLE_ENERGY_PROFILE_MISSING',explanation:'Vehicle profile is not ready'}]}});
  async function released(){for(let i=0;i<50;i++){if((await pool.query('SELECT count(*)::int AS n FROM planning_execution_slots WHERE token IS NOT NULL')).rows[0].n===0)return;await new Promise(r=>setTimeout(r,10));}throw new Error('Planning lease not released');}
  it('computes a real three-mode solver plan over HTTP and exposes only the public response',async()=>{
    const response=await post(world.body),body=await response.json();expect(response.status).toBe(200);expect(body.status).toBe('planned');
    expect(planningApiResponseSchema.safeParse(body).success).toBe(true);expect(body.plan.chargingStops.length).toBeGreaterThan(0);
    expect(body.plan.chargingStops.every((s:{connectionDurationSeconds:number})=>s.connectionDurationSeconds===120)).toBe(true);
    expect(planner.plan.mock.calls[0][0].policy.maxComputationMilliseconds).toBeLessThan(3000);
    expect(body.plan.estimatedArrivalAt).toBeNull();expect(body.metadata.historyStored).toBe(false);expect(body.metadata.access).toBe('stateless_guest');
    expect(body).not.toHaveProperty('validationInput');expect(body).not.toHaveProperty('replay');expect(body).not.toHaveProperty('vehicle');
    expect(body.metadata.models.energy.version).toBe(world.vehicle.energyModel!.version);expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe(world.body.requestId);await released();
  });
  it('keeps insufficient data as a domain result without calling external providers',async()=>{
    delete world.vehicle.energyModel;const response=await post(world.body),body=await response.json();expect(response.status).toBe(200);expect(body.status).toBe('insufficient_data');
    expect(world.roads.routes).not.toHaveBeenCalled();expect(world.weather.forecast).not.toHaveBeenCalled();await released();
  });
  it('preserves quota exhaustion and its real retry interval through the full HTTP domain result',async()=>{
    world.roads.routes.mockRejectedValueOnce(new RoadProviderError('Synthetic daily budget exhausted',429,7200,'ROAD_PROVIDER_QUOTA_EXHAUSTED'));
    const response=await post(world.body),body=await response.json();expect(response.status).toBe(503);expect(body.status).toBe('provider_error');
    expect(body.reasons[0].code).toBe('ROAD_PROVIDER_QUOTA_EXHAUSTED');expect(body.metadata.retryAfterSeconds).toBe(7200);expect(response.headers.get('retry-after')).toBe('7200');
    expect(world.weather.forecast).not.toHaveBeenCalled();await released();
  });
  it('transports a validated plan larger than 2 MiB with gzip while preserving the JSON contract',async()=>{
    const explanation='Transport-only regression payload. '.repeat(80000);
    planner.plan.mockImplementation(async(...args:Parameters<EvPlanningService['plan']>)=>{
      const outcome=await world.service.plan(...args);
      if(outcome.result.status==='planned')outcome.result.plan.assumptions.push({id:'transport-regression',code:'test_transport',explanation});
      return outcome;
    });
    const response=await post(world.body),body=await response.json();expect(response.status).toBe(200);
    expect(response.headers.get('content-encoding')).toBe('gzip');expect(body.status).toBe('planned');
    expect(body.plan.assumptions.find((a:{id:string})=>a.id==='transport-regression').explanation).toBe(explanation);
    expect(planningApiResponseSchema.safeParse(body).success).toBe(true);await released();
  });
  it('returns an actionable nearby-road confirmation instead of a provider outage for city-centre coordinates',async()=>{
    const original=world.roads.routes.getMockImplementation()!;
    world.roads.routes.mockImplementation(async(...args)=>{const response=structuredClone(await original(...args));
      for(const route of response.data?.routes??[])route.segments[0].geometry[0].latitude+=.002;return response;});
    const response=await post(world.body),body=await response.json();expect(response.status).toBe(200);expect(body.status).toBe('insufficient_data');
    expect(body.reasons[0].code).toBe('ROAD_ENDPOINT_CONFIRMATION_REQUIRED');expect(world.weather.forecast).not.toHaveBeenCalled();
  });
  it('accepts valid three-hour-old forecast runs and rejects genuinely stale runs under the shared weather policy',async()=>{
    const original=world.weather.forecast.getMockImplementation()!;
    let hours=3;world.weather.forecast.mockImplementation(async(...args)=>{const response=await original(...args);
      for(const f of response.data){f.sourceUpdatedAt=new Date(Date.now()-hours*3600000).toISOString();f.forecastIssuedAt=null;}return response;});
    const current=await post(world.body);expect(current.status).toBe(200);expect((await current.json()).status).toBe('planned');await released();
    hours=13;const stale=await post({...world.body,requestId:'22222222-2222-4222-8222-222222222222'});expect((await stale.json()).status).toBe('insufficient_data');await released();
  });
  it.each(['minimum_charging_stops','minimum_energy'] as const)('accepts user mode %s',async objective=>{
    const response=await post({...world.body,objective}),body=await response.json();expect(response.status).toBe(200);expect(body.plan.search.objective).toBe(objective);await released();
  });
  it.each(['policy','optimizerOptions','vehicle','ownerId','tripId','replay'] as const)('rejects caller-controlled internal field %s',async key=>{
    const response=await post({...world.body,[key]:{maxStates:1000000}});expect(response.status).toBe(400);expect((await response.json()).error.code).toBe('VALIDATION_ERROR');expect(planner.plan).not.toHaveBeenCalled();
  });
  it.each(['percentage','coordinate','timezone','missing_reserve','missing_arrival','reversed_constraints','bad_vehicle_id','fake_measurement','future_observation','identical_locations','too_far'] as const)('validates input: %s',async kind=>{
    const body=structuredClone(world.body) as any;
    switch(kind){case 'percentage':body.startingChargePercent=101;break;case 'coordinate':body.origin.latitude=91;break;
      case 'timezone':body.departureAt='2026-11-12T10:00:00';break;case 'missing_reserve':delete body.constraints.minimumReserveChargePercent;break;
      case 'missing_arrival':delete body.constraints.targetArrivalChargePercent;break;case 'reversed_constraints':body.constraints.targetArrivalChargePercent=5;break;
      case 'bad_vehicle_id':body.vehicleVariantId='not-a-catalogue-id';break;case 'fake_measurement':body.initialBatteryTemperatureC={origin:'estimated',value:30,modelVersion:'attacker'};break;
      case 'future_observation':body.startingChargeObservedAt=new Date(Date.now()+20000).toISOString();break;case 'identical_locations':body.destination=body.origin;break;
      case 'too_far':body.destination={latitude:-40,longitude:-100};break;}
    const response=await post(body);expect(response.status).toBe(400);expect(planningApiErrorSchema.safeParse(await response.json()).success).toBe(true);expect(planner.plan).not.toHaveBeenCalled();
  });
  it('defaults only the optimization mode; never inserts SOC constraints',async()=>{
    const body={...world.body} as any;delete body.objective;const response=await post(body);expect(response.status).toBe(200);
    expect((await response.json()).plan.search.objective).toBe('minimum_total_duration');await released();
  });
  it('bounds both content-length and chunked request bodies before computation',async()=>{
    const response=await post({...world.body,padding:'x'.repeat(20000)});expect(response.status).toBe(413);expect((await response.json()).error.code).toBe('REQUEST_TOO_LARGE');
    const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify({...world.body,padding:'x'.repeat(20000)})));c.close();}});
    const chunked=await fetch(url+'/v1/plans',{method:'POST',headers:{'Content-Type':'application/json'},body:stream,duplex:'half'} as RequestInit);
    expect(chunked.status).toBe(413);expect((await chunked.json()).error.code).toBe('REQUEST_TOO_LARGE');expect(planner.plan).not.toHaveBeenCalled();
  });
  it('normalizes malformed JSON and unsupported content type without leaking parser errors',async()=>{
    const bad=await post(null,{body:'{"broken"'});expect(bad.status).toBe(400);const error=await bad.json();expect(error.error.code).toBe('INVALID_JSON');expect(JSON.stringify(error)).not.toContain('SyntaxError');
    const text=await post(world.body,{headers:{'Content-Type':'text/plain'}});expect(text.status).toBe(415);expect(planner.plan).not.toHaveBeenCalled();
  });
  it('separates provider failure from an infeasible road',async()=>{
    planner.plan.mockResolvedValueOnce({result:{status:'provider_error',requestId:world.body.requestId,reasons:[{code:'ROAD_PROVIDER_FAILED',explanation:'Road provider failed'}]}});
    const unavailable=await post(world.body);expect(unavailable.status).toBe(503);expect((await unavailable.json()).status).toBe('provider_error');await released();
    planner.plan.mockResolvedValueOnce({result:{status:'infeasible',requestId:world.body.requestId,reasons:[{code:'ROAD_ROUTE_NOT_FOUND',explanation:'No road'}]}});
    const infeasible=await post(world.body);expect(infeasible.status).toBe(200);expect((await infeasible.json()).status).toBe('infeasible');await released();
  });
  it('returns computation limits distinctly and keeps validated limited-search plans successful',async()=>{
    planner.plan.mockResolvedValueOnce({result:{status:'computation_limit',requestId:world.body.requestId,reasons:[{code:'NO_VALID_PLAN_WITHIN_DEADLINE',explanation:'Budget ended'}]}});
    const limit=await post(world.body);expect(limit.status).toBe(503);expect((await limit.json()).status).toBe('computation_limit');await released();
    world.body.startingChargePercent=100;world.body.constraints={minimumReserveChargePercent:0,targetArrivalChargePercent:0};
    planner.plan.mockImplementationOnce((req,prep,options,signal)=>world.service.plan(req,prep,{...options,maxStates:1},signal));
    const planned=await post(world.body);expect(planned.status).toBe(200);const plan=await planned.json();expect(plan.status).toBe('planned');expect(plan.plan.search.searchComplete).toBe(false);await released();
  });
  it('bounds the HTTP deadline and aborts the underlying operation',async()=>{
    let cancelled=false;planner.plan.mockImplementationOnce((_a,_b,_c,signal:AbortSignal)=>new Promise((_resolve,reject)=>{
      signal.addEventListener('abort',()=>{cancelled=true;reject(signal.reason);},{once:true});}));
    const response=await post(world.body);expect(response.status).toBe(503);expect((await response.json()).error.code).toBe('PLANNING_REQUEST_DEADLINE');await released();expect(cancelled).toBe(true);
  },10000);
  it('rejects a valid-looking plan that changes submitted journey inputs',async()=>{
    planner.plan.mockImplementationOnce((req,prep,options,signal)=>world.service.plan({...req,departureAt:new Date(Date.parse(req.departureAt)+1000).toISOString()},prep,options,signal));
    const response=await post(world.body);expect(response.status).toBe(500);expect((await response.json()).error.code).toBe('PLANNING_RESPONSE_INVALID');await released();
  });
  it('does not leak exceptions, foreign requests or internal replay data',async()=>{
    planner.plan.mockRejectedValueOnce(new Error('password=do-not-expose'));const response=await post(world.body);expect(response.status).toBe(500);expect(JSON.stringify(await response.json())).not.toContain('do-not-expose');await released();
    planner.plan.mockResolvedValueOnce(noPlan('00000000-0000-4000-8000-000000000000'));const foreign=await post(world.body);expect(foreign.status).toBe(500);expect((await foreign.json()).error.code).toBe('PLANNING_RESPONSE_INVALID');await released();
  });
  it('uses the shared planning rate policy and blocks on the third daily violation',async()=>{
    rate.policies.planning.limit=1;planner.plan.mockResolvedValue(noPlan(world.body.requestId));const first=await post(world.body);expect(first.status).toBe(200);await first.json();await released();
    for(let i=0;i<3;i++){const r=await post(world.body),body=await r.json();expect(r.status).toBe(429);expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');}
    expect((await pool.query('SELECT strikes FROM api_rate_limit_days')).rows[0].strikes).toBe(1);
    for(let i=0;i<2;i++){
      // Expire only the window epoch to simulate the next distinct window without sleeping or altering the daily strikes.
      await pool.query("UPDATE api_rate_limit_days SET windows=jsonb_set(windows,'{planning:v1,epoch}','0'::jsonb)");
      const allowed=await post(world.body);expect(allowed.status).toBe(200);await allowed.json();await released();
      const limited=await post(world.body);expect(limited.status).toBe(429);expect((await limited.json()).error.code).toBe(i===1?'IP_BLOCKED_UNTIL_DAY_END':'RATE_LIMIT_EXCEEDED');
    }
    expect(planner.plan).toHaveBeenCalledTimes(3);
  });
  it('uses a shared global slot and releases it with the owning token',async()=>{
    await pool.query('UPDATE planning_admission_config SET capacity=1');let finish!:(v:OptimizerOutcome)=>void,started!:()=>void;
    const start=new Promise<void>(r=>started=r);planner.plan.mockImplementationOnce(()=>new Promise<OptimizerOutcome>(r=>{finish=r;started();}));
    const first=post(world.body);await start;const second=await fetch(otherUrl+'/v1/plans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(world.body)});
    expect(second.status).toBe(503);expect((await second.json()).error.code).toBe('PLANNING_CAPACITY_EXCEEDED');
    expect(planner.plan).toHaveBeenCalledTimes(1);finish(noPlan(world.body.requestId));expect((await first).status).toBe(200);await released();
  });
  it('cancels the solver and releases its lease when the HTTP client disconnects',async()=>{
    let started!:()=>void;const start=new Promise<void>(r=>started=r);let aborted=false;
    planner.plan.mockImplementationOnce((_a,_b,_c,signal:AbortSignal)=>new Promise((_resolve,reject)=>{started();signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true});}));
    const cancel=new AbortController(),pending=post(world.body,{signal:cancel.signal});await start;cancel.abort();await expect(pending).rejects.toThrow();await released();expect(aborted).toBe(true);
  });
});
