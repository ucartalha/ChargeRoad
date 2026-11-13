const {test}=require('node:test');const assert=require('node:assert/strict');
const {buildPlanningRequest,initialPlanningForm,runPlanning,LatestPlanningRequest,roadEndpointAdjustment}=require('../src/features/planning/planning-flow.ts');
const {planningApi,PlanningApiError}=require('../src/api/planning.ts');
const id='11111111-1111-4111-8111-111111111111',now=new Date('2026-11-12T09:00:00Z');
const form=()=>({...initialPlanningForm,vehicleId:id,startingCharge:'95',reserve:'10',arrival:'20',
  origin:{id:'a',label:'İstanbul',coordinate:{latitude:41,longitude:29}},destination:{id:'b',label:'Ankara',coordinate:{latitude:40,longitude:33}}});
const insufficient=requestId=>({schemaVersion:'1.0.0',requestId,status:'insufficient_data',reasons:[{code:'VEHICLE_ENERGY_PROFILE_MISSING',explanation:'Missing profile'}]});
test('explicit SOC, selected coordinates, consent and unknown observations map to the public DTO',()=>{
  const request=buildPlanningRequest(form(),id,now);assert.equal(request.objective,'minimum_total_duration');assert.equal(request.vehicleDataQuality,'verified_only');
  assert.equal(request.startingChargePercent,95);assert.equal(request.constraints.minimumReserveChargePercent,10);assert.equal(request.constraints.targetArrivalChargePercent,20);
  assert.deepEqual(request.stateOfHealthPercent,{origin:'unknown',value:null});assert.equal(request.departureAt,'2026-11-12T09:01:00.000Z');
  assert.equal(buildPlanningRequest({...form(),allowEstimates:true},id,now).vehicleDataQuality,'allow_engineering_estimates');
});
test('missing selections and invalid SOC never issue a plan request',()=>{
  for(const patch of [{origin:null},{destination:null},{vehicleId:null},{startingCharge:''},{reserve:''},{arrival:''},{reserve:'50',arrival:'20'},{startingCharge:'101'},{arrival:'NaN'}])
    assert.throws(()=>buildPlanningRequest({...form(),...patch},id,now));
  assert.throws(()=>buildPlanningRequest({...form(),destination:form().origin},id,now));
});
test('scheduled local date validates calendar values and past times; distant dates remain eligible for road preview',()=>{
  for(const scheduled of ['','2026-02-31 10:00','2026-01-01 10:00','2026-11-13 25:10'])assert.throws(()=>buildPlanningRequest({...form(),departure:'scheduled',scheduled},id,now));
  assert.ok(Date.parse(buildPlanningRequest({...form(),departure:'scheduled',scheduled:'2026-12-12 10:00'},id,now).departureAt)>now.getTime()+72*3600000);
});
test('insufficient data requests a separate road preview without inventing SOC or retrying with estimates',async()=>{
  const request=buildPlanningRequest(form(),id,now);let plans=0,previews=0;
  const output=await runPlanning(request,new AbortController().signal,{plan:async r=>{plans++;assert.equal(r.vehicleDataQuality,'verified_only');return insufficient(id);},preview:async r=>{previews++;assert.equal(r.avoidFerries,true);assert.equal(r.origin.latitude,41);return {status:'available',route:{distanceMeters:410000,drivingDurationSeconds:14400}};}});
  assert.equal(plans,1);assert.equal(previews,1);assert.equal(output.result.status,'insufficient_data');assert.equal(output.preview.route.distanceMeters,410000);
  assert.equal(output.preview.route.estimatedArrivalChargePercent,undefined);
});
test('road preview failure preserves the specific energy insufficiency result',async()=>{
  const result=await runPlanning(buildPlanningRequest(form(),id,now),new AbortController().signal,{plan:async()=>insufficient(id),preview:async()=>{throw new Error('provider');}});
  assert.equal(result.result.reasons[0].code,'VEHICLE_ENERGY_PROFILE_MISSING');assert.equal(result.preview,null);assert.ok(result.previewError);
});
test('fallback preserves retry limits and actionable road-location failures',async()=>{
  const request=buildPlanningRequest(form(),id,now);
  const output=await runPlanning(request,new AbortController().signal,{plan:async()=>insufficient(id),preview:async()=>{throw new PlanningApiError('Daha kesin bir adres seç.',60,422);}});
  assert.equal(output.previewRetryAfterSeconds,60);assert.equal(output.previewError,'Daha kesin bir adres seç.');assert.equal(output.result.status,'insufficient_data');
});
test('provider errors and infeasibility do not masquerade as data gaps or trigger more provider work',async()=>{
  for(const status of ['provider_error','infeasible','computation_limit','planned']){let previews=0;const result=await runPlanning(buildPlanningRequest(form(),id,now),new AbortController().signal,
    {plan:async()=>({...insufficient(id),status}),preview:async()=>{previews++;throw new Error('Unexpected');}});assert.equal(result.result.status,status);assert.equal(previews,0);}
});
test('mismatched request IDs cannot be displayed',async()=>{
  await assert.rejects(runPlanning(buildPlanningRequest(form(),id,now),new AbortController().signal,{plan:async()=>insufficient('other'),preview:async()=>null}));
});
test('late responses cannot overwrite a newer form/request even if transport ignores abort',async()=>{
  const runner=new LatestPlanningRequest(),request=buildPlanningRequest(form(),id,now);let resolveOld;const displayed=[];
  const old=runner.run(request,{plan:()=>new Promise(resolve=>{resolveOld=resolve;}),preview:async()=>null},r=>displayed.push('old'));
  const next={...request,requestId:'22222222-2222-4222-8222-222222222222'};
  await runner.run(next,{plan:async()=>({...insufficient(next.requestId),status:'infeasible'}),preview:async()=>null},r=>displayed.push('new'));
  resolveOld(insufficient(id));await old;assert.deepEqual(displayed,['new']);
});
test('cancelled plans do not trigger fallback provider requests',async()=>{
  const controller=new AbortController();let previews=0;const operation=runPlanning(buildPlanningRequest(form(),id,now),controller.signal,
    {plan:async()=>{controller.abort();return insufficient(id);},preview:async()=>{previews++;return null;}});
  await assert.rejects(operation);assert.equal(previews,0);
});
test('road-point confirmation is explicit, bounded and never silently rewrites the GPS/address input',()=>{
  const f=form(),before=structuredClone(f),view={result:{...insufficient(id),reasons:[{code:'ROAD_ENDPOINT_CONFIRMATION_REQUIRED'}]},preview:{route:{originSnapMeters:132,destinationSnapMeters:10,
    geometry:[{latitude:41.001,longitude:29},{latitude:40,longitude:33}]}}};
  const adjustment=roadEndpointAdjustment(f,view);assert.deepEqual(f,before);assert.deepEqual(adjustment.origin.coordinate,view.preview.route.geometry[0]);assert.deepEqual(adjustment.destination,f.destination);
  view.preview.route.originSnapMeters=1001;assert.equal(roadEndpointAdjustment(f,view),null);view.preview.route.originSnapMeters=132;
  view.result.reasons=[{code:'VEHICLE_ENERGY_PROFILE_MISSING'}];assert.equal(roadEndpointAdjustment(f,view),null);
});
test('HTTP 503 domain outcomes are preserved while protocol errors respect Retry-After',async()=>{
  const originalFetch=global.fetch,originalUrl=process.env.EXPO_PUBLIC_API_URL;process.env.EXPO_PUBLIC_API_URL='https://example.com/v1';
  const metadata={apiVersion:'planning-http/1.0.0',policyId:'public-planning',policyVersion:'1.0.0',access:'stateless_guest',historyStored:false,
    algorithms:{optimizer:'1',energy:'1',charging:'1'},models:{energy:null,charging:null}};
  try{global.fetch=async()=>new Response(JSON.stringify({...insufficient(id),status:'provider_error',metadata}),{status:503});
    const result=await planningApi.plan(buildPlanningRequest(form(),id,now),new AbortController().signal);assert.equal(result.status,'provider_error');
    global.fetch=async()=>new Response(JSON.stringify({code:'RATE_LIMIT_EXCEEDED'}),{status:429,headers:{'Retry-After':'60'}});
    await assert.rejects(planningApi.search('Ankara',new AbortController().signal),e=>e instanceof PlanningApiError&&e.retryAfterSeconds===60&&e.status===429);
    global.fetch=async()=>new Response(JSON.stringify({...insufficient('22222222-2222-4222-8222-222222222222'),metadata}),{status:200});
    await assert.rejects(planningApi.plan(buildPlanningRequest(form(),id,now),new AbortController().signal),/bu plan isteğine ait değil/);
  }finally{global.fetch=originalFetch;if(originalUrl===undefined)delete process.env.EXPO_PUBLIC_API_URL;else process.env.EXPO_PUBLIC_API_URL=originalUrl;}
});
