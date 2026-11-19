const fs=require('fs'),path=require('path'),crypto=require('crypto'),Module=require('module'),cp=require('child_process'),os=require('os'),assert=require('assert/strict');
const ts=require('typescript');require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,esModuleInterop:true},fileName:f}).outputText,f);
const root=path.resolve(__dirname,'../../..'),folder=path.join(root,'artifacts/latency-2026-11-16');
const mobileFile=path.join(root,'apps/mobile/src/api/planning.ts'),mobileSource=fs.readFileSync(mobileFile,'utf8');
const {PlanningJobsStore}=require('../src/planning/http/planning-jobs.store.ts');
const {latencyPilotPollHint}=require('../src/planning/validation/latency-poll-pilot.ts');
const {planningApiRequestSchema,toMobilePlanningResponse}=require('@chargeroad/shared');
const hash=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const sources=Object.fromEntries(['apps/mobile/src/api/planning.ts','apps/api/src/planning/http/planning-jobs.store.ts','apps/api/src/planning/http/planning-jobs.worker.ts','apps/api/src/planning/validation/latency-poll-pilot.ts','apps/api/scripts/benchmark-polling-latency.cjs'].map(p=>[p,hash(fs.readFileSync(path.join(root,p),'utf8'))]));
const write=(name,data)=>fs.writeFileSync(path.join(folder,name),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
class Clock{
 constructor(){this.now=0;this.serial=0;this.events=new Map();}
 set=(fn,delay=0)=>{const id=++this.serial;this.events.set(id,{at:this.now+delay,fn});return id;};clear=id=>this.events.delete(id);
 async drain(promise){let done=false,value,error;promise.then(v=>{done=true;value=v;},e=>{done=true;error=e;});
  for(let n=0;n<200000&&!done;n++){
   // Flush production promise/json/Zod continuations before advancing virtual time.
   for(let j=0;j<30;j++)await Promise.resolve();if(done)break;
   const next=[...this.events.entries()].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!next)throw Error('CLOCK_STALLED');
   this.events.delete(next[0]);this.now=next[1].at;next[1].fn();
  }if(!done)throw Error('CLOCK_LIMIT');return {value,error};
 }
}
const id='11111111-1111-4111-8111-111111111111',secret='a'.repeat(64),epoch=Date.parse('2026-11-16T09:00:00Z');
const request=()=>planningApiRequestSchema.parse({schemaVersion:'1.0.0',requestId:id,origin:{latitude:40,longitude:29},destination:{latitude:40.02,longitude:29},vehicleVariantId:id,
 departureAt:new Date(epoch+60000).toISOString(),startingChargePercent:80,startingChargeObservedAt:new Date(epoch).toISOString(),constraints:{minimumReserveChargePercent:10,targetArrivalChargePercent:20}});
const result=requestId=>({schemaVersion:'1.0.0',requestId,status:'insufficient_data',reasons:[{code:'SYNTHETIC_DATA_GAP',explanation:'Synthetic diagnostic only'}],
 metadata:{apiVersion:'planning-http/1.0.0',policyId:'synthetic',policyVersion:'1',access:'stateless_guest',historyStored:false,
 algorithms:{optimizer:'diagnostic',energy:'diagnostic',charging:'diagnostic'},models:{energy:null,charging:null}}});
async function scenario(pilot,readyMs,kind='normal',previewEnabled=true){
 const clock=new Clock(),calls=[],events=[],cancelled=new AbortController(),capOwner='synthetic-owner';let previewAt=null,seenAt=null,finalAt=null;
 const finalResult=result(kind==='mismatched_result'?'22222222-2222-4222-8222-222222222222':id);
 const row=()=>({id,status:clock.now>=readyMs?(kind==='failed'?'failed':kind==='cancelled'?'cancelled':'completed'):clock.now<500?'queued':'running',
  created_at:new Date(epoch),started_at:new Date(epoch+500),expires_at:new Date(epoch+3600000),error_code:kind==='failed'?'CONTROLLED_ERROR':null,result_payload:finalResult});
 // Real production SELECT/owner/TTL result methods. SQL transport is an in-memory boundary, not a PG latency measurement.
 const store=new PlanningJobsStore({pool:{query:async(sql,params)=>{const allowed=params[0]===id&&params[1]===capOwner&&kind!=='expired'&&kind!=='owner';
  return {rows:allowed?[row()]:[]};}}});
 const view=()=>{const v=store.view(row());return {...v,pollAfterMilliseconds:latencyPilotPollHint(v.status,clock.now,pilot,'development')};};
 const call=async(address,options)=>{
  // Query strings (?waitMs, ?view=mobile) do not change the endpoint role; the result honours view=mobile like the API.
  const bare=address.split('?')[0],role=bare.endsWith('/result')?'result':bare.endsWith('/roads/preview')?'preview':options.method==='POST'?'create':options.method==='DELETE'?'cancel':'status';
  calls.push(role);events.push({stage:role+'_start',at:clock.now});
  if(options.headers.Authorization!=='Bearer '+secret&&role!=='preview')throw Error('CAPABILITY_CHANGED');
  await new Promise((resolve,reject)=>{const timer=clock.set(resolve,10),abort=()=>{clock.clear(timer);reject(new Error('aborted'));};if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});});
  if(kind==='network'&&role==='status')throw Error('controlled network failure');
  let code=200,data;
  if(kind==='quota'&&role==='status'){code=429;data={};}
  else if(kind==='unavailable'&&role==='status'){code=503;data={};}
  else if(kind==='malformed'&&role==='status')data={status:'completed'};
  else if(role==='create'){code=201;data=view();}
  else if(role==='status'){try{data=await store.status(id,capOwner);data={...data,pollAfterMilliseconds:latencyPilotPollHint(data.status,clock.now,pilot,'development')};if(data.status==='completed')seenAt=clock.now;}catch{code=404;data={};}}
  else if(role==='result'){try{data=await store.result(id,capOwner);if(/[?&]view=mobile(&|$)/.test(address))data=toMobilePlanningResponse(data);}catch{code=404;data={};}}
  else if(role==='preview'){data={schemaVersion:'1.0.0',status:'not_found',reasons:['synthetic'],metadata:{}};}
  else data=view();
  events.push({stage:role+'_headers',at:clock.now});
  return {ok:code<400,status:code,headers:{get:n=>n==='Retry-After'&&code===429?'60':null},json:async()=>{await new Promise(r=>clock.set(r,10));events.push({stage:role+'_body_end',at:clock.now});return data;}};
 };
 const m={exports:{}},req=Module.createRequire(mobileFile),js=ts.transpileModule(mobileSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const VirtualDate=class extends Date{constructor(v){super(v===undefined?epoch+clock.now:v);}static now(){return epoch+clock.now;}};
 new Function('exports','module','require','fetch','process','setTimeout','clearTimeout','Date',js)(m.exports,m,req,call,{env:{EXPO_PUBLIC_API_URL:'http://synthetic.invalid/v1'}},clock.set,clock.clear,VirtualDate);
 if(kind==='abort')clock.set(()=>cancelled.abort(),1000);
 const outcome=await clock.drain(m.exports.planningApi.planAsync(request(),cancelled.signal,secret,()=>{},()=>{previewAt=clock.now;}));
 if(outcome.value)finalAt=clock.now;
 const error=outcome.error?{name:outcome.error.name,status:outcome.error.status??0,retryAfterSeconds:outcome.error.retryAfterSeconds??0,messageHash:hash(outcome.error.message)}:null;
 return {readyMs,kind,pilot,previewEnabled,readyToObservedMs:seenAt===null?null:seenAt-readyMs,finalResponseAcceptedAt:finalAt,previewCallbackAt:previewAt,
  statusGets:calls.filter(v=>v==='status').length,resultGets:calls.filter(v=>v==='result').length,cancelCalls:calls.filter(v=>v==='cancel').length,
  outcomeHash:outcome.value?hash(outcome.value):null,error,events,physicalProviderHttp:0,sqlSelectIntentCount:calls.filter(v=>['status','result'].includes(v)).length,
  visiblePaint:'NOT_RUN',scope:'Virtual client transport + actual mobile polling/Zod + actual store view/status/result; create/worker readiness, PG/HTTP latency modeled. Not real provider/worker latency.'};
}
function equivalent(a,b){assert.equal(a.outcomeHash,b.outcomeHash);assert.deepEqual(a.error,b.error);assert.equal(a.resultGets,b.resultGets);}
async function child(i){const rows=[],cases=[100,500,1900,2100,4500,6500,9500,10500,14000,30000,60000];
 for(let warm=0;warm<2;warm++){await scenario(false,500);await scenario(true,500);}
 for(let block=0;block<3;block++)for(const ready of cases){let ref;
  for(const pilot of (block+i)%2?[true,false,false,true]:[false,true,true,false]){const r=await scenario(pilot,ready);if(ref)equivalent(ref,r);else ref=r;rows.push({process:i,block,...r});}}
 const semantic=[];for(const kind of ['quota','unavailable','network','expired','owner','failed','cancelled','malformed','mismatched_result','abort']){
  const a=await scenario(false,500,kind),b=await scenario(true,500,kind);equivalent(a,b);semantic.push({kind,equivalent:true,before:a,prototype:b});}
 write('process-'+i+'.json',{generatedAt:new Date().toISOString(),sources,environment:{node:process.version,platform:os.platform(),cpu:os.cpus()[0]?.model},rows,semantic,
  defaultProductionHint:latencyPilotPollHint('queued',0,true,'production'),singleUser:true,previewPolicy:'unchanged; invalid mocked preview rejected by existing Zod, render NOT_RUN'});
 console.log(JSON.stringify({process:i,pairs:rows.length/2,semantic:semantic.length,status:'PASS'}));}
const stats=v=>{const a=[...v].sort((a,b)=>a-b),p=x=>a[Math.max(0,Math.ceil(a.length*x)-1)];return {n:a.length,p50:p(.5),p95:p(.95),p99:p(.99)};};
async function main(){const c=process.argv.find(v=>v.startsWith('--child='))?.slice(8);if(c)return child(Number(c));
 for(let i=1;i<=3;i++){const p=cp.spawnSync(process.execPath,[__filename,'--child='+i],{cwd:process.cwd(),encoding:'utf8',maxBuffer:1048576});if(p.status!==0){console.error(p.stdout.trim());throw Error('CHILD_FAILED');}console.log(p.stdout.trim());}
 const all=[1,2,3].flatMap(i=>JSON.parse(fs.readFileSync(path.join(folder,'process-'+i+'.json'),'utf8')).rows),groups=[];
 for(const ready of [...new Set(all.map(r=>r.readyMs))]){const arm=pilot=>{const r=all.filter(r=>r.readyMs===ready&&r.pilot===pilot);return {readyToObservedMs:stats(r.map(r=>r.readyToObservedMs)),finalResponseAcceptedMs:stats(r.map(r=>r.finalResponseAcceptedAt)),statusGets:stats(r.map(r=>r.statusGets)),resultGets:stats(r.map(r=>r.resultGets))};};groups.push({readyMs:ready,before:arm(false),prototype:arm(true)});}
 write('polling-ab.json',{generatedAt:new Date().toISOString(),sources,groups,scope:'First/only A-B hypothesis, virtual same-process timeline; 3 independent processes, warmup 2/arm, 3 balanced blocks, 18 samples/arm/readiness group, concurrency1.',
  policy:'prototype only: development opt-in 2000ms while job age<10000ms, otherwise native5000ms. Client always honors server hint. Not wired into production.',
  actualUiPaint:'NOT_RUN',localProvider:'NOT_RUN',previewOnOff:'NOT_RUN',sharedQueueLoad:'NOT_RUN',abrp:'NOT_COMPARABLE',decision:'NO_GO_FOR_PRODUCTION_OR_REAL_VISIBLE_LATENCY_CLAIM'});
}
if(require.main===module)main().catch(()=>{console.error('POLLING_LATENCY_MEASUREMENT_FAILED; raw user data/errors suppressed');process.exitCode=1;});
module.exports={scenario,latencyPilotPollHint,Clock};
