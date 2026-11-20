#!/usr/bin/env node
// Local planning load test (2026-11-20). No dependencies (Node >= 20 fetch). Run only against the test instance:
//   node apps/api/scripts/load/plan-load-test.cjs --routes <routes.json> [--base http://127.0.0.1:3001/v1]
//        [--stages 2,4,8,16,32] [--iterations 1] [--cooldown 10] [--out <result.json>]
// Each virtual user repeats the phone flow: road preview + POST /planning-jobs, long-poll status (15 s), then
// GET /result?view=mobile. Stages raise the number of simultaneous users step by step.
// Safety: refuses any base URL that is not 127.0.0.1:3001 / localhost:3001; stops the whole run at the first 429 or
// IP block (so the shared rate-limit table never collects strikes), cancels its open jobs on Ctrl+C or abort.
// Privacy: the routes file holds coordinates and stays outside the repository; nothing here prints coordinates.
'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),{execFile}=require('node:child_process');

const arg=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i>0?process.argv[i+1]:fallback;};
const BASE=arg('base','http://127.0.0.1:3001/v1'),ROUTES=arg('routes'),OUT=arg('out');
const STAGES=arg('stages','2,4,8,16,32').split(',').map(Number),ITERATIONS=Number(arg('iterations','1')),COOLDOWN_S=Number(arg('cooldown','10'));
const VEHICLE='a82a3933-a3fe-41f8-b830-b4b1a747a5ba',POLL_WAIT_MS=15000,FLOW_TIMEOUT_MS=6*60*1000;
if(!/^http:\/\/(127\.0\.0\.1|localhost):3001\/v1$/.test(BASE))throw new Error('Refusing to load anything but the local test instance on port 3001');
if(!ROUTES)throw new Error('--routes <file> is required (array of {name, origin, destination})');
const routes=JSON.parse(fs.readFileSync(ROUTES,'utf8'));
if(!Array.isArray(routes)||!routes.length)throw new Error('Routes file must be a non-empty array');

let stopped=null;const open=new Map();// jobId -> secret, for cancellation
const stop=reason=>{if(!stopped){stopped=reason;console.error('\nSTOP:',reason);}};
process.on('SIGINT',()=>{stop('interrupted (Ctrl+C)');void cancelAll().finally(()=>process.exit(130));});

async function http(method,path,{body,secret,timeoutMs=60000}={}){
  const started=performance.now();
  const response=await fetch(BASE+path,{method,signal:AbortSignal.timeout(timeoutMs),
    headers:{'Content-Type':'application/json',Accept:'application/json',...(secret?{Authorization:'Bearer '+secret}:{})},
    body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text(),ms=performance.now()-started;let data=null;try{data=text?JSON.parse(text):null;}catch{}
  if(response.status===429||data?.code==='RATE_LIMIT_EXCEEDED'||data?.code==='IP_BLOCKED_UNTIL_DAY_END')
    stop('HTTP 429 / rate limit ('+(data?.code??'429')+') on '+method+' '+path.split('?')[0].replace(/[0-9a-f-]{36}/,':id'));
  return {status:response.status,data,bytes:text.length,ms};
}
async function cancelAll(){await Promise.allSettled([...open].map(([id,secret])=>http('DELETE','/planning-jobs/'+id,{secret,timeoutMs:5000})));open.clear();}

// About 1 km of jitter on half of the requests: different users, cold origin legs; the other half repeats exact points.
const jitter=(p,on)=>on?{latitude:+(p.latitude+(Math.random()-.5)*0.018).toFixed(6),longitude:+(p.longitude+(Math.random()-.5)*0.024).toFixed(6)}:p;
function request(route,cold){const now=Date.now();return {schemaVersion:'1.0.0',requestId:crypto.randomUUID(),origin:jitter(route.origin,cold),destination:route.destination,
  vehicleVariantId:VEHICLE,departureAt:new Date(now+60000).toISOString(),departureMode:'now',startingChargePercent:80,startingChargeObservedAt:new Date(now).toISOString(),
  constraints:{minimumReserveChargePercent:10,targetArrivalChargePercent:20},objective:'minimum_total_duration',
  vehicleDataQuality:'allow_engineering_estimates',stationDataQuality:'catalogue_power_scenario',roadPreferences:{avoidTolls:false,avoidFerries:true}};}

async function flow(stage,user,iteration){
  const route=routes[(user+iteration)%routes.length],cold=(user+iteration)%2===0,req=request(route,cold),secret=crypto.randomBytes(32).toString('hex');
  const record={stage,user,iteration,route:route.name,cold,outcome:'error',code:null,submitMs:null,queueMs:null,totalMs:null,resultBytes:null,stops:null};
  const began=performance.now();
  try{
    const preview=http('POST','/roads/preview',{body:{origin:req.origin,destination:req.destination,departureAt:req.departureAt,...req.roadPreferences},timeoutMs:95000}).catch(()=>null);
    const created=await http('POST','/planning-jobs',{body:req,secret});record.submitMs=Math.round(created.ms);
    if(created.status>=400||!created.data?.id){record.code='CREATE_'+created.status+(created.data?.code?':'+created.data.code:'');return record;}
    const id=created.data.id;open.set(id,secret);let status=created.data.status;
    while(!stopped&&!['completed','failed','cancelled','expired'].includes(status)){
      if(performance.now()-began>FLOW_TIMEOUT_MS){record.code='CLIENT_TIMEOUT';break;}
      const polled=await http('GET','/planning-jobs/'+id+'?waitMs='+POLL_WAIT_MS,{secret,timeoutMs:POLL_WAIT_MS+15000});
      if(polled.status>=400){record.code='POLL_'+polled.status;break;}
      if(status==='queued'&&polled.data.status!=='queued'&&record.queueMs===null)record.queueMs=Math.round(performance.now()-began);
      status=polled.data.status;
    }
    if(status==='completed'){
      const result=await http('GET','/planning-jobs/'+id+'/result?view=mobile',{secret,timeoutMs:60000});
      record.resultBytes=result.bytes;record.outcome=result.data?.status??'result_'+result.status;
      record.code=result.data?.status==='planned'?null:(result.data?.reasons?.[0]?.code??null);record.stops=result.data?.plan?.chargingStops?.length??null;
    }else if(!record.code)record.code='JOB_'+status;
    open.delete(id);await preview;
  }catch(error){record.code=error?.name==='TimeoutError'?'HTTP_TIMEOUT':'NETWORK:'+(error?.cause?.code??error?.name??'error');}
  record.totalMs=Math.round(performance.now()-began);return record;
}

// API process CPU/memory (Windows, via PowerShell), sampled every 5 s; never fails the run.
function apiPid(){return new Promise(resolve=>execFile('powershell',['-NoProfile','-Command',
  '(Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess'],(e,out)=>resolve(e?null:Number(String(out).trim())||null)));}
function sample(pid){return new Promise(resolve=>execFile('powershell',['-NoProfile','-Command',`$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue;if($p){"$($p.CPU) $($p.WorkingSet64)"}`],
  (e,out)=>{const [cpu,ws]=String(out).trim().split(' ').map(Number);resolve(e||!Number.isFinite(cpu)?null:{at:Date.now(),cpuSeconds:cpu,memoryMb:Math.round(ws/1048576)});}));}

const pct=(values,p)=>{const s=values.filter(v=>v!==null).sort((a,b)=>a-b);return s.length?s[Math.min(s.length-1,Math.floor(p*(s.length-1)))]:null;};
const sec=ms=>ms===null?'-':(ms/1000).toFixed(1)+'s';
(async()=>{
  const health=await http('GET','/vehicles?limit=1').catch(()=>null);
  if(!health||health.status!==200)throw new Error('Test instance not reachable on '+BASE);
  const pid=await apiPid(),stages=[];console.log('Load test',new Date().toISOString(),'| stages',STAGES.join('→'),'| iterations/user',ITERATIONS,'| api pid',pid??'unknown');
  for(const users of STAGES){
    if(stopped)break;
    const samples=[],timer=pid?setInterval(()=>void sample(pid).then(s=>s&&samples.push(s)),5000):null,startSample=pid?await sample(pid):null,t0=Date.now();
    const records=(await Promise.all(Array.from({length:users},async(_,user)=>{const out=[];
      for(let i=0;i<ITERATIONS&&!stopped;i++)out.push(await flow(users,user,i));return out;}))).flat();
    if(timer)clearInterval(timer);const endSample=pid?await sample(pid):null,wallMs=Date.now()-t0;
    const ok=records.filter(r=>r.outcome==='planned'),totals=records.map(r=>r.totalMs),queue=records.map(r=>r.queueMs);
    const codes={};for(const r of records)if(r.outcome!=='planned'){const k=r.code??r.outcome;codes[k]=(codes[k]??0)+1;}
    const cpu=startSample&&endSample?(endSample.cpuSeconds-startSample.cpuSeconds):null;
    const summary={users,requests:records.length,planned:ok.length,failures:codes,wallMs,
      totalP50:pct(totals,.5),totalP95:pct(totals,.95),totalMax:pct(totals,1),queueP50:pct(queue,.5),queueP95:pct(queue,.95),
      plansPerMinute:+(ok.length/(wallMs/60000)).toFixed(2),apiCpuSeconds:cpu===null?null:+cpu.toFixed(1),apiCpuCoresAvg:cpu===null?null:+(cpu/(wallMs/1000)).toFixed(2),
      apiMemoryMbMax:samples.length?Math.max(...samples.map(s=>s.memoryMb)):endSample?.memoryMb??null,records};
    stages.push(summary);
    console.log(`${String(users).padStart(3)} users | ${ok.length}/${records.length} planned | total p50 ${sec(summary.totalP50)} p95 ${sec(summary.totalP95)} max ${sec(summary.totalMax)}`+
      ` | queue p50 ${sec(summary.queueP50)} p95 ${sec(summary.queueP95)} | ${summary.plansPerMinute} plans/min | cpu ${summary.apiCpuCoresAvg??'-'} cores, mem ${summary.apiMemoryMbMax??'-'} MB`+
      (Object.keys(codes).length?' | failures '+JSON.stringify(codes):''));
    if(!stopped&&users!==STAGES.at(-1))await new Promise(r=>setTimeout(r,COOLDOWN_S*1000));
  }
  await cancelAll();
  if(OUT)fs.writeFileSync(OUT,JSON.stringify({at:new Date().toISOString(),base:BASE,stages:STAGES,iterations:ITERATIONS,stopped,results:stages},null,1));
  if(stopped)process.exitCode=2;
})().catch(async error=>{console.error('FAILED:',error.message);await cancelAll();process.exit(1);});
