/** Stage A only: real weather service/cache/adapter, synthetic SQL/transport boundary. No production importer. */
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto'),Module=require('module'),{AsyncLocalStorage}=require('async_hooks'),{setTimeout:delay}=require('timers/promises');
const root=path.resolve(__dirname,'../../..'),tag=process.argv.find(v=>v.startsWith('--tag='))?.slice(6)||'trace-v2';if(!/^[a-z0-9-]+$/.test(tag))throw Error('Invalid tag');
const out=path.join(root,'docs/validation/cr-lat-002-2026-11-16',tag);fs.mkdirSync(out,{recursive:true});
const hash=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const sources=Object.fromEntries(['apps/api/src/weather/weather-cache.ts','apps/api/src/weather/weather.service.ts','apps/api/src/weather/met-norway.adapter.ts','apps/api/src/weather/weather-policy.ts','apps/api/scripts/diagnose-weather-acquisition.cjs'].map(p=>[p,hash(fs.readFileSync(path.join(root,p),'utf8'))]));
const write=(name,v)=>fs.writeFileSync(path.join(out,name),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const RealDate=Date,epoch=Number(process.argv.find(v=>v.startsWith('--epoch='))?.slice(8)||Date.now());global.Date=class extends RealDate{constructor(v){super(v===undefined?epoch:v);}static now(){return epoch;}};
const {WeatherCacheStore}=require('../src/weather/weather-cache.ts'),{WeatherService,WeatherAdapterRegistry}=require('../src/weather/weather.service.ts');
const {MetNorwayAdapter}=require('../src/weather/met-norway.adapter.ts'),{WeatherUnavailable}=require('../src/weather/weather-ports.ts'),{document,config,instant}=require('../src/weather/__tests__/fixtures.ts');
const {WEATHER_POLICY}=require('../src/weather/weather-policy.ts'),ts=require('typescript'),als=new AsyncLocalStorage();
function label(sql){if(sql.includes('c.document'))return 'cache_read';if(sql.includes('FOR UPDATE'))return 'provider_lock_sql';if(sql.includes('AS leased'))return 'entry_recheck';
 if(sql.includes('count(*)'))return 'active_leases';if(sql.startsWith('INSERT INTO weather_forecast_cache'))return 'lease_claim';if(sql.includes('next_allowed_at=now()'))return 'pace_reserve';
 if(sql.includes('document=$4'))return 'fenced_save';if(sql.includes('retry_at=now()'))return 'failure_release';if(sql.includes('blocked_until=GREATEST'))return 'provider_backoff';return 'transaction_or_state';}
class SqlFixture {
 constructor(){this.rows=new Map();this.states=new Map();this.locks=new Map();this.sqlCalls=0;}
 state(id){if(!this.states.has(id))this.states.set(id,{used:0,next:0,blockedUntil:0,kind:'provider_unavailable'});return this.states.get(id);}
 async connect(){await delay(1);const held=[];const query=async(sql,p=[])=>{this.sqlCalls++;await delay(1);const now=RealDate.now(),r=this.rows.get(p[0]);
 if(sql==='COMMIT'||sql==='ROLLBACK'){while(held.length)held.pop()();return {rows:[],rowCount:0};}
 if(sql.includes('c.document'))return {rows:r?[{document:r.doc,fresh:r.expires>now,retry:r.retry>now,blocked_kind:this.state(r.provider).kind}]:[],rowCount:r?1:0};
 if(sql.includes('FOR UPDATE')){const previous=this.locks.get(p[0])??Promise.resolve();let release;const gate=new Promise(r=>release=r);this.locks.set(p[0],previous.then(()=>gate));await previous;held.push(release);const s=this.state(p[0]);return {rows:[{today:true,used:s.used,blocked:s.blockedUntil>RealDate.now(),blocked_kind:s.kind,paced:s.next>RealDate.now()}]};}
 if(sql.includes('AS leased'))return {rows:r?[{fresh:r.expires>now,leased:!!r.token&&r.lease>now}]:[]};
 if(sql.includes('count(*)'))return {rows:[{n:[...this.rows.values()].filter(r=>r.provider===p[0]&&r.token&&r.lease>now).length}]};
 if(sql.startsWith('INSERT INTO weather_forecast_cache')){if(r&&(r.expires>now||r.retry>now||r.token&&r.lease>now))return {rows:[],rowCount:0};const n={...(r||{}),provider:p[1],token:p[2],generation:(r?.generation||0)+1,lease:now+p[3]*1000,expires:r?.expires||0,retry:0};this.rows.set(p[0],n);return {rows:[{generation:String(n.generation)}],rowCount:1};}
 if(sql.includes('next_allowed_at=now()')){const s=this.state(p[0]);s.used++;s.next=now+p[1];return {rows:[],rowCount:1};}
 if(sql.includes('document=$4')){const ok=r&&r.token===p[1]&&String(r.generation)===p[2]&&r.lease>now;if(!ok)return {rows:[],rowCount:0};r.doc=JSON.parse(p[3]);r.expires=Date.parse(p[4]);r.token=null;r.retry=0;return {rows:[{}],rowCount:1};}
 if(sql.includes('retry_at=now()')){const ok=r&&r.token===p[1]&&String(r.generation)===p[2];if(ok){r.token=null;r.retry=now+p[3]*1000;}return {rows:ok?[{}]:[],rowCount:ok?1:0};}
 if(sql.includes('blocked_until=GREATEST')){const s=this.state(p[0]);s.blockedUntil=Math.max(s.blockedUntil,now+p[1]*1000);s.kind=p[2];return {rows:[],rowCount:1};}
 return {rows:[],rowCount:0};};return {query,release(){while(held.length)held.pop()();}};}
 async query(sql,p){const c=await this.connect();try{return await c.query(sql,p);}finally{c.release();}}
}
function observed(db,enabled){const events=[],gets=[],http=[],parses=[],stats={pacingRetries:0,ownershipRetries:0,concurrencyRetries:0};let serial=0;
 const span=async(category,fn)=>{if(!enabled)return fn();const ctx=als.getStore(),start=performance.now();try{return await fn();}finally{events.push({get:ctx?.id??0,category,start,end:performance.now()});}};
 const capture=(sql,r)=>{const c=als.getStore();if(!c)return;if(sql.includes('FOR UPDATE'))c.paced=!!r.rows[0]?.paced;if(sql.includes('AS leased'))c.leased=!!r.rows[0]?.leased;
  if(sql.includes('count(*)'))c.full=r.rows[0]?.n>=WEATHER_POLICY.maxConcurrency;};
 const query=(target,sql,p)=>span('fixture_sql_'+label(sql),async()=>{const r=await target.query(sql,p);capture(sql,r);return r;});
 const pool=enabled?{query:(s,p)=>query(db,s,p),connect:()=>span('fixture_connection_acquire',async()=>{const c=await db.connect();return {query:(s,p)=>query(c,s,p),release:()=>c.release()};})}:db;
 const wrappedDelay=(ms,value,opts)=>{const c=als.getStore(),reason=c?.paced?'pacing_retry':c?.leased?'ownership_retry':c?.full?'concurrency_retry':'coordination_retry';
  if(c?.paced)stats.pacingRetries++;else if(c?.leased)stats.ownershipRetries++;else if(c?.full)stats.concurrencyRetries++;return span(reason,()=>delay(ms,value,opts));};
 function Cache(){if(!enabled)return WeatherCacheStore;const filename=path.join(root,'apps/api/src/weather/weather-cache.ts'),source=fs.readFileSync(filename,'utf8'),m={exports:{}},req=Module.createRequire(filename);
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('exports','module','require',js)(m.exports,m,n=>n==='node:timers/promises'?{setTimeout:wrappedDelay}:req(n));return m.exports.WeatherCacheStore;}
 function Service(){if(!enabled)return WeatherService;const filename=path.join(root,'apps/api/src/weather/weather.service.ts'),m={exports:{}},req=Module.createRequire(filename),normalize=req('./weather-normalize');
  const js=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('exports','module','require',js)(m.exports,m,n=>n==='./weather-normalize'?{...normalize,normalizeWeather:(...args)=>{const start=performance.now();try{return normalize.normalizeWeather(...args);}finally{events.push({get:0,category:'forecast_selection',start,end:performance.now()});}}}:req(n));return m.exports.WeatherService;}
 return {events,gets,http,parses,stats,pool,span,Cache,Service,wrap(cache){const get=cache.get.bind(cache);cache.get=(...args)=>{if(!enabled)return get(...args);
  const ctx={id:++serial,keyHash:hash(args.slice(0,3)).slice(0,16)},start=performance.now();const promise=als.run(ctx,()=>get(...args));
  void promise.then(()=>gets.push({...ctx,start,end:performance.now(),outcome:'value'}),()=>gets.push({...ctx,start,end:performance.now(),outcome:'error'}));return promise;};}};
}
function payload(location,kind){const d=document(),body=d.body;body.geometry.coordinates=[location.longitude,location.latitude,800];body.properties.meta.updated_at=new Date(epoch-(kind==='stale'?48*3600000:0)).toISOString();
 for(const p of body.properties.timeseries)p.time=new Date(Date.parse(p.time)-Date.parse(instant)+epoch).toISOString();
 if(kind==='unknown')for(const p of body.properties.timeseries)delete p.data.instant.details.wind_speed;
 return {...d,validatedAt:new Date(epoch).toISOString(),fetchedAt:new Date(epoch).toISOString()};}
async function one(enabled,profile,objective,warm,kind='known'){
 const count={short:10,medium:100,long:1000}[profile],jobs={short:1,medium:2,long:3}[profile],unique=objective==='minimum_charging_stops'?1:3;
 const db=new SqlFixture(),o=observed(db,enabled),order=[],codes=[],controller=new AbortController();
 const adapter=new MetNorwayAdapter(config),parse=adapter.parse.bind(adapter);adapter.parse=d=>{const start=performance.now();try{return parse(d);}finally{if(enabled)o.parses.push(performance.now()-start);}};
 const transport=async(url,old,signal)=>o.span('fixture_http_transport',async()=>{const key=hash(url).slice(0,16);order.push(key);await delay(5,undefined,{signal});
  if(kind==='429'||kind==='503'){codes.push(Number(kind));throw new WeatherUnavailable('provider_unavailable','synthetic',1);}
  const u=new URL(url),location={latitude:Number(u.searchParams.get('lat')),longitude:Number(u.searchParams.get('lon'))};codes.push(old?304:200);
  const d=payload(location,kind);return old?{...d,status:304,body:null}:d;});
 const Cache=o.Cache(),cache=new Cache({pool:o.pool},transport,'synthetic-observation-secret-at-least-32-characters');o.wrap(cache);
 const Service=o.Service(),service=new Service(config,new WeatherAdapterRegistry([adapter]),cache),queries=Array.from({length:count},(_,i)=>({id:'q'+i,segmentId:'s'+i,
  location:{latitude:39.9+(i%unique)*.001,longitude:32.8},validAt:new Date(epoch+1800000+(i%2)*1000).toISOString()}));
 if(kind==='outside')queries.forEach(q=>q.validAt=new Date(epoch-1).toISOString());
 if(warm||kind==='304'){
  for(const q of queries.slice(0,unique)){const url=adapter.url(q.location),key=crypto.createHmac('sha256','synthetic-observation-secret-at-least-32-characters').update('weather-cache/v1\0'+adapter.id+'\0'+adapter.version+'\0'+url).digest('hex');
   const d=payload(q.location,'known');db.rows.set(key,{provider:adapter.id,doc:d,expires:kind==='304'?0:RealDate.now()+3600000,retry:0,generation:0,token:null});}
 }
 if(kind==='cancel'||kind==='deadline')setTimeout(()=>controller.abort(new Error('synthetic_abort')),3);
 const cpu=process.cpuUsage(),heapBefore=process.memoryUsage().heapUsed,start=performance.now();
 const work=Array.from({length:jobs},()=>service.forecast(queries,controller.signal,{budgetScope:{}}).then(v=>({hash:hash(v),statuses:[...new Set(v.data.map(d=>d.status??'known'))]}),e=>({error:e===controller.signal.reason?'same_abort_reason':'unexpected_error'})));
 const results=await Promise.all(work);
 const wallMs=performance.now()-start,used=process.cpuUsage(cpu);
 // Shared detached owners remain bounded; wait for their cleanup before discarding the fixture.
 const tailStart=performance.now();while(cache.pending.size&&performance.now()-tailStart<5000)await delay(10);
 const decomposition=o.gets.map(g=>{const e=o.events.filter(e=>e.get===g.id),cuts=[...new Set([g.start,g.end,...e.flatMap(e=>[Math.max(g.start,e.start),Math.min(g.end,e.end)])].filter(t=>t>=g.start&&t<=g.end))].sort((a,b)=>a-b),times={};
  for(let i=1;i<cuts.length;i++){const a=cuts[i-1],b=cuts[i],active=e.filter(e=>e.start<=a&&e.end>=b).sort((x,y)=>(x.end-x.start)-(y.end-y.start)),category=active[0]?.category??'unattributed';times[category]=(times[category]??0)+b-a;}
  return {awaitedWallMs:g.end-g.start,categories:times};});
 return {enabled,profile,objective,warm,kind,queryItems:count*jobs,forecastCalls:jobs,uniqueRequestedLocations:unique,distinctLocationTimePairs:new Set(queries.map(q=>JSON.stringify([q.location,q.validAt]))).size,
  uniqueActualSampleLocations:new Set(queries.map(q=>adapter.url(q.location))).size,distinctProviderCacheKeys:new Set(queries.map(q=>adapter.url(q.location))).size,
  actualSamples:'counts use existing adapter truncation; no new rounding. Terrain fallback covered by existing regression suite, not this matrix',result:results,transportOrderHash:hash(order),physicalFixtureTransportCalls:order.length,httpCodes:codes,
  cacheCounters:{...cache.counters},fixtureSqlCalls:db.sqlCalls,wallMs,cpuUserMs:used.user/1000,cpuSystemMs:used.system/1000,heapDelta:process.memoryUsage().heapUsed-heapBefore,
  trace:enabled?{gets:o.gets.length,distinctKeyHashes:new Set(o.gets.map(g=>g.keyHash)).size,eventCount:o.events.length,events:o.events,decomposition,
   parseMs:o.parses.reduce((a,b)=>a+b,0),retryCounts:o.stats}:null,
  criticalPathExclusive:'NOT_MEASURED: overlapping keys/jobs; per-get clipped partition is coverage only, never summed into job wall',externalNetworkCalls:0};
}
function eq(a,b){for(const k of ['result','transportOrderHash','physicalFixtureTransportCalls','httpCodes','cacheCounters'])if(JSON.stringify(a[k])!==JSON.stringify(b[k]))throw Error('INSTRUMENTATION_SEMANTIC_MISMATCH/'+k);}
async function child(i,smoke){const rows=[],failures=[],profiles=smoke?['short']:['short','medium','long'],objectives=smoke?['minimum_total_duration']:['minimum_total_duration','minimum_charging_stops','minimum_energy'];
 await one(false,'short','minimum_charging_stops',true);await one(true,'short','minimum_charging_stops',true);
 for(const profile of profiles)for(const objective of objectives)for(const warm of [false,true]){let reference;for(const enabled of i%2?[true,false,false,true]:[false,true,true,false]){
  const row=await one(enabled,profile,objective,warm);if(reference){try{eq(reference,row);}catch(e){failures.push({profile,objective,warm,enabled,code:e.message,beforeOrderHash:reference.transportOrderHash,currentOrderHash:row.transportOrderHash});}}else reference=row;rows.push(row);}}
 const semantics=[];for(const kind of ['unknown','stale','outside','429','503','304','cancel','deadline']){const a=await one(false,'short','minimum_charging_stops',false,kind),b=await one(true,'short','minimum_charging_stops',false,kind);let status='PASS';try{eq(a,b);}catch(e){status='FAIL';failures.push({kind,code:e.message});}semantics.push({kind,status,before:a,observed:b});}
 const status=failures.length?'FAIL':'PASS';
 write(smoke?'weather-smoke.json':`weather-process-${i}.json`,{generatedAt:new RealDate().toISOString(),sources,fixtureEpoch:epoch,mode:'Stage A instrumentation only; no batching/reuse optimization',sql:'in-memory fixture, NOT real PG latency/locking proof',rows,semantics,failures,status});console.log(JSON.stringify({process:i,rows:rows.length,semantics:semantics.length,status}));}
async function main(){if(process.argv.includes('--smoke'))return child(0,true);const i=process.argv.find(a=>a.startsWith('--child='))?.slice(8);if(i)return child(Number(i),false);
 for(let i=1;i<=3;i++){const p=cp.spawnSync(process.execPath,['-r',require.resolve('ts-node/register/transpile-only'),__filename,'--child='+i,'--tag='+tag,'--epoch='+epoch],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',timeout:180000,maxBuffer:1048576});if(p.status!==0){console.error((p.stderr||'').split('\n').filter(l=>/^(INSTRUMENTATION_|WEATHER_DIAGNOSTIC_)/.test(l)).join('\n'));throw Error('CHILD_FAILED');}console.log(p.stdout.trim());}
 const records=[1,2,3].map(i=>JSON.parse(fs.readFileSync(path.join(out,`weather-process-${i}.json`),'utf8'))),failureCount=records.reduce((n,r)=>n+r.failures.length,0);
 write('weather-summary.json',{generatedAt:new RealDate().toISOString(),sources,status:'STAGE_A_ONLY',instrumentationEquivalence:failureCount?'FAIL':'PASS',failureCount,processes:3,order:'ABBA/BAAB; one warmup/arm; 2 samples/arm/group/process => n6 pooled',
  optimization:'NOT_RUN: state timeout regression gate remains red',realWeatherNetwork:'NOT_RUN',realPgWriteFixture:'NOT_RUN: no new schema/migration/reset/drop under task restriction',actualSavings:0});}
main().catch(e=>{console.error(/^INSTRUMENTATION_SEMANTIC_MISMATCH\/[a-zA-Z]+$/.test(e.message)?e.message:'WEATHER_DIAGNOSTIC_FAILED (raw fields suppressed)');process.exitCode=1;});
