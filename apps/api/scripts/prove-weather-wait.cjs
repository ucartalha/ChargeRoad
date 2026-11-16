/** CR-LAT-002R, offline MODEL only. No real PostgreSQL/provider traffic. */
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto'),{setTimeout:delay}=require('timers/promises');
const root=path.resolve(__dirname,'../../..'),folder=path.join(root,'docs/validation/cr-lat-002r-2026-11-16/contract-v2');
fs.mkdirSync(folder,{recursive:true});
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const {candidateClass,candidateSource}=require('./validation/weather-wait-candidate.cjs');
const {WeatherCacheStore}=require('../src/weather/weather-cache.ts'),{WeatherService,WeatherAdapterRegistry}=require('../src/weather/weather.service.ts');
const {MetNorwayAdapter}=require('../src/weather/met-norway.adapter.ts'),{document,config,instant}=require('../src/weather/__tests__/fixtures.ts');
const {WeatherUnavailable}=require('../src/weather/weather-ports.ts');
const {WEATHER_POLICY}=require('../src/weather/weather-policy.ts');
const Candidate=candidateClass(),RealDate=Date,epoch=Date.parse('2026-11-16T09:00:00Z');
global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[epoch]));}static now(){return epoch;}};
global.fetch=async()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');};
// Reuse the previous MODEL implementation, not a rewritten optimizer/cache algorithm.
const modelFile=path.join(__dirname,'diagnose-weather-acquisition.cjs'),modelText=fs.readFileSync(modelFile,'utf8');
let model=modelText.slice(modelText.indexOf('class SqlFixture {'),modelText.indexOf('function observed('));
if(!model.startsWith('class SqlFixture {')||!model.endsWith('\n'))throw Error('MODEL_SEAM_CHANGED');
model=model.replace('paced:s.next>RealDate.now()','paced:s.next>RealDate.now(),pace_wait_ms:Math.max(0,s.next-RealDate.now())');
model=model.replace('leased:!!r.token&&r.lease>now','leased:!!r.token&&r.lease>now,lease_wait_ms:Math.max(0,r.lease-now)');
const SqlFixture=new Function('delay','RealDate',model+';return SqlFixture;')(delay,RealDate);
function payload(location,kind){const d=document(),body=d.body;
 body.geometry.coordinates=[location.longitude,location.latitude,800];body.properties.meta.updated_at=new Date(epoch-(kind==='stale'?48*3600000:0)).toISOString();
 for(const p of body.properties.timeseries)p.time=new Date(Date.parse(p.time)-Date.parse(instant)+epoch).toISOString();
 if(kind==='unknown')for(const p of body.properties.timeseries)delete p.data.instant.details.wind_speed;
 return {...d,validatedAt:new Date(epoch).toISOString(),fetchedAt:new Date(epoch).toISOString()};
}
async function one(candidate,jobs,keys,kind='known',instrumented=true){
 const db=new SqlFixture(),events=[],rawOrder=[],physical=new Map(),saved=new Map(),sql={select:0,claim:0,total:0},spans={},reasons={pacing_wait:0,active_lease_wait:0,concurrency_wait:0,fresh_hit:0};let active=0,peak=0,ownerViolation=false;
 const measure=async(name,fn)=>{if(!instrumented)return fn();const start=performance.now();try{return await fn();}finally{spans[name]=(spans[name]??0)+performance.now()-start;}};
 const query=async(target,s,p)=>{sql.total++;if(s.includes('c.document'))sql.select++;if(s.includes('FOR UPDATE'))sql.claim++;
  const result=await measure('sqlInclusive',()=>target.query(s,p));
  if(s.includes('FOR UPDATE')&&result.rows[0]?.paced)reasons.pacing_wait++;
  if(s.includes('AS leased')&&result.rows[0]?.leased)reasons.active_lease_wait++;
  if(s.includes('count(*)')&&result.rows[0]?.n>=2)reasons.concurrency_wait++;
  if(s.includes('c.document')&&result.rows[0]?.fresh)reasons.fresh_hit++;
  if(s.startsWith('INSERT INTO weather_forecast_cache')&&result.rowCount)events.push([p[0],'claim']);
  if(s.includes('document=$4')&&result.rowCount){events.push([p[0],'commit']);saved.set(p[0],hash(JSON.parse(p[3])));}
  if(s.includes('retry_at=now()')&&result.rowCount)events.push([p[0],'release']);
  return result;};
 const pool={query:(s,p)=>query(db,s,p),connect:()=>measure('poolConnect',async()=>{const c=await db.connect();return {query:(s,p)=>query(c,s,p),release:()=>c.release()};})};
 const secret='synthetic-weather-proof-secret-at-least-32-characters',adapter=new MetNorwayAdapter(config);
 const keyFor=url=>crypto.createHmac('sha256',secret).update('weather-cache/v1\0'+adapter.id+'\0'+adapter.version+'\0'+url).digest('hex');
 const controller=new AbortController();
 const transport=async(url,old,signal)=>measure('transportInclusive',async()=>{
  const key=keyFor(url);rawOrder.push(key);physical.set(key,(physical.get(key)||0)+1);events.push([key,'fetch']);active++;peak=Math.max(peak,active);
  if(active>WEATHER_POLICY.maxConcurrency)ownerViolation=true;
  try{await delay(kind==='cancel-owner'?35:5,undefined,{signal});
   if(kind==='429'||kind==='503')throw new WeatherUnavailable('provider_unavailable','synthetic',1);
   const u=new URL(url),d=payload({latitude:Number(u.searchParams.get('lat')),longitude:Number(u.searchParams.get('lon'))},kind);
   events.push([key,old?'304':'200']);return old?{...d,status:304,body:null}:d;
  }finally{active--;}
 });
 const Cache=candidate?Candidate:WeatherCacheStore,cache=new Cache({pool},transport,secret);
 const service=new WeatherService(config,new WeatherAdapterRegistry([adapter]),cache);
 const queries=Array.from({length:keys},(_,i)=>({id:'q'+i,segmentId:'s'+i,location:{latitude:39.9+i*.001,longitude:32.8},validAt:new Date(epoch+1800000+i*1000).toISOString()}));
 if(['warm','304','budget-fresh'].includes(kind))for(const q of queries){const url=adapter.url(q.location),key=keyFor(url),d=payload(q.location,'known');
  db.rows.set(key,{provider:adapter.id,doc:d,expires:kind==='304'?0:RealDate.now()+3600000,retry:0,generation:0,token:null});}
 if(kind==='outside')queries.forEach(q=>q.validAt=new Date(epoch-1).toISOString());
 if(kind==='quota')db.state(adapter.id).used=WEATHER_POLICY.dailyLimit;
 if(kind==='cancel'||kind==='deadline')controller.abort(new Error('synthetic_abort'));
 if(kind==='cancel-owner')setTimeout(()=>controller.abort(new Error('synthetic_abort')),10);
 const cpu=process.cpuUsage(),heap=process.memoryUsage().heapUsed,start=performance.now();
 const results=await Promise.all(Array.from({length:jobs},()=>service.forecast(queries,controller.signal,{budgetScope:{},maxExternalCalls:kind==='budget-fresh'||kind==='budget'?0:128})
  .then(v=>({hash:hash(v),statuses:v.data.map(d=>d.status)}),e=>({error:e===controller.signal.reason?'caller_abort':'unexpected'}))));
 const wallMs=performance.now()-start,used=process.cpuUsage(cpu);
 // Await every detached owner before fixture disposal. Source maintains independent 5s bound.
 const end=performance.now()+6000;while(cache.pending.size&&performance.now()<end)await delay(5);
 if(cache.pending.size||active)throw Error('WEATHER_PENDING_LEAK');
 const perKey=Object.fromEntries([...new Set(events.map(e=>e[0]))].map(key=>[key,events.filter(e=>e[0]===key).map(e=>e[1])]));
 for(const flow of Object.values(perKey))if(flow.filter(x=>x==='claim').length>1||flow.filter(x=>x==='fetch').length>1)ownerViolation=true;
 const semantic={results,physical:Object.fromEntries([...physical].sort()),saved:Object.fromEntries([...saved].sort()),perKey,
  cacheCounters:{...cache.counters},ownerViolation,pendingAfter:cache.pending.size};
 return {candidate,instrumented,jobs,distinctKeys:keys,kind,wallMs,cpuUserMs:used.user/1000,cpuSystemMs:used.system/1000,
  heapDelta:process.memoryUsage().heapUsed-heap,sql,peak,spans,reasons,rawOrder,semantic,
  // Only the dictionary representation is canonicalized, NOT the raw transport trace
  // or event order within any key. Independent key insertion order is not a contract.
  semanticHash:hash({...semantic,perKey:Object.fromEntries(Object.entries(perKey).sort(([a],[b])=>a.localeCompare(b)))}),
  overlap:'spans inclusive; NOT additive critical path; real PG/network NOT_RUN'};
}
function eq(a,b){if(a.semanticHash!==b.semanticHash||a.semantic.ownerViolation||b.semantic.ownerViolation)throw Error('WEATHER_CONTRACT_MISMATCH');}
async function child(id){const rows=[],failures=[],semantics=[];
 await one(false,1,1,'warm');await one(true,1,1,'warm');
 for(const jobs of [1,10,100])for(const keys of [1,3]){
  let baseline;for(const candidate of id%2?[false,true,true,false]:[true,false,false,true]){
   const row=await one(candidate,jobs,keys);if(baseline){try{eq(baseline,row);}catch(e){failures.push({jobs,keys,error:e.message});}}else baseline=row;rows.push(row);
  }
 }
 for(const kind of ['warm','304','unknown','stale','outside','429','503','cancel','deadline','cancel-owner','quota','budget','budget-fresh']){
  const a=await one(false,10,1,kind),b=await one(true,10,1,kind);let status='PASS';try{eq(a,b);}catch(e){status='FAIL';failures.push({kind,error:e.message});}
  semantics.push({kind,status,before:a,after:b});
 }
 // Observer equivalence uses the new per-key contract; raw cross-key order retained.
 for(const jobs of [1,2,3])for(const keys of [1,2,3]){
  const a=await one(false,jobs,keys,'known',false),b=await one(false,jobs,keys,'known',true);let status='PASS';try{eq(a,b);}catch(e){status='FAIL';failures.push({jobs,keys,observer:true,error:e.message});}
  semantics.push({jobs,keys,observer:true,status,before:a,after:b});
 }
 const value={baselineVersion:'weather-per-key-contract/v2',id,modelSourceSha256:hash(modelText),candidateSourceSha256:hash(candidateSource()),
  proofSourceSha256:hash(fs.readFileSync(__filename,'utf8')),
  productionSourceSha256:hash(fs.readFileSync(path.join(root,'apps/api/src/weather/weather-cache.ts'),'utf8')),fixtureEpoch:epoch,
  rows,semantics,failures,status:failures.length?'FAIL':'PASS',realPg:'NOT_RUN',realNetwork:'NOT_RUN',externalRequests:0,
  limitations:'1/10/100 same-instance forecast calls sharing 1 or 3 keys, NOT 100 unique external acquisitions or users. JS SQL mutex is MOCK. Cross-process fencing NOT_RUN.'};
 fs.writeFileSync(path.join(folder,`weather-wait-process-${id}.json`),JSON.stringify(value,null,2),{flag:'wx'});
 console.log(JSON.stringify({process:id,status:value.status,rows:rows.length,failures:failures.length}));
}
async function main(){const id=process.argv.find(a=>a.startsWith('--child='));if(id)return child(Number(id.slice(8)));
 for(let i=1;i<=3;i++){const p=cp.spawnSync(process.execPath,['-r',require.resolve('ts-node/register/transpile-only'),__filename,'--child='+i],{cwd:path.join(root,'apps/api'),encoding:'utf8',timeout:180000,maxBuffer:1024*1024});
  if(p.status!==0)throw Error('WEATHER_PROOF_CHILD_FAILED');console.log(p.stdout.trim());}
}
main().catch(e=>{console.error(e.message==='WEATHER_PROOF_CHILD_FAILED'?e.message:'WEATHER_PROOF_FAILED');process.exitCode=1;});
