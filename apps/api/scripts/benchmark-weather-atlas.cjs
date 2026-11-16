/** Real application path + loopback HTTP transport, MODEL SQL. No external weather requests. */
const fs=require('fs'),path=require('path'),http=require('http'),crypto=require('crypto'),cp=require('child_process');
const root=path.resolve(__dirname,'../../..'),audit=process.argv.includes('--warm-audit'),out=path.join(root,'artifacts/cr-wx-003r-2026-11-16',audit?'warm-audit':'final');
const RealDate=Date,epoch=audit?JSON.parse(fs.readFileSync(path.join(root,'artifacts/cr-wx-003r-2026-11-16/final/run-metadata.json'),'utf8')).epoch:RealDate.now();global.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[epoch]));}static now(){return epoch;}};
const {WeatherService,WeatherAdapterRegistry}=require('../src/weather/weather.service.ts'),{WeatherCacheStore}=require('../src/weather/weather-cache.ts');
const {MetNorwayAdapter}=require('../src/weather/met-norway.adapter.ts'),{weatherTransport}=require('../src/weather/weather-http.ts');
const {weatherExperimentWorld,experimentDocument,weatherExperimentCases}=require('../src/weather/validation/weather-experiment-fixture.ts');
const {withPlanningMetrics}=require('../src/observability/planning-metrics.ts');
const SqlFixture=require('./validation/weather-sql-model.cjs')(RealDate);
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v,(key,v)=>key==='elapsedMilliseconds'?undefined:v)).digest('hex');
let currentKind='short',gets=0,wireKeys=new Set(),wireStatus={};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');gets++;wireKeys.add(hash([url.pathname,...url.searchParams]));
 const status=req.headers['if-modified-since']?304:200;wireStatus[status]=(wireStatus[status]??0)+1;
 res.writeHead(status,{'Content-Type':'application/json',Expires:new Date(epoch+3600000).toUTCString(),'Last-Modified':new Date(epoch).toUTCString()});
 res.end(status===304?undefined:JSON.stringify(experimentDocument(Number(url.searchParams.get('lat')),Number(url.searchParams.get('lon')),currentKind).body));
});
async function one(mode,kind,warm=false,jobs=1){
 currentKind=kind;process.env.WEATHER_EXECUTION_MODE=mode;
 const config={enabled:true,providerId:'synthetic-met',endpoint:`http://127.0.0.1:${server.address().port}/forecast`,userAgent:'ChargeRoad/offline-fixture',termsAccepted:true};
 const db=new SqlFixture(),adapter=new MetNorwayAdapter(config),parse=adapter.parse.bind(adapter);let parses=0;adapter.parse=d=>{parses++;return parse(d);};
 const cache=new WeatherCacheStore({pool:db},weatherTransport(config),'synthetic-weather-atlas-secret-at-least-32-characters');
 const service=new WeatherService(config,new WeatherAdapterRegistry([adapter]),cache);let getsAttempted=0;
 const get=cache.get.bind(cache);cache.get=(...a)=>{getsAttempted++;
  if(warm){const key=crypto.createHmac('sha256','synthetic-weather-atlas-secret-at-least-32-characters').update('weather-cache/v1\0'+a[0]+'\0'+a[1]+'\0'+a[2]).digest('hex');
   if(!db.rows.has(key)){const u=new URL(a[2]),doc=experimentDocument(Number(u.searchParams.get('lat')),Number(u.searchParams.get('lon')),kind);db.rows.set(key,{provider:a[0],doc,expires:Date.parse(doc.expiresAt),retry:0,generation:0,token:null});}}
  return get(...a);};
 let weatherSpans=[];const forecast=service.forecast.bind(service);service.forecast=async(...args)=>{const start=performance.now();try{return await forecast(...args);}finally{weatherSpans.push([start,performance.now()]);}};
 const run=async()=>{const w=weatherExperimentWorld(kind,service);let metrics;
  const outcome=await withPlanningMetrics(w.request.requestId,()=>w.service.plan(w.request,w.preparation,w.options),{enabled:true,scope:'benchmark',sink:s=>metrics=s});
  const planned=outcome.result.status==='planned'?outcome.result.plan:null;
  return {outcomeHash:hash(outcome),weatherHash:hash(outcome.replay?.providers?.weather),status:outcome.result.status,
   reasonCodes:outcome.result.reasons?.map(r=>r.code)??[],stopOrder:planned?.chargingStops.map(s=>hash(s.stationId))??[],
   finalSoc:planned?.estimatedArrivalChargePercent??null,energy:planned?.energySegments.reduce((sum,s)=>sum+s.netBatteryEnergyKwh,0)??null,
   energyReasons:[...new Set(w.evaluations.flatMap(e=>e.reasons.map(r=>r.code)))],
   minimumSyntheticSoc:planned?Math.min(...planned.energySegments.map(s=>s.minimumChargePercent)):null,
   metrics,roadSegments:w.km};};
 const before={get:gets,sql:db.sqlCalls,attempts:getsAttempted,parse:parses},cpu=process.cpuUsage(),heap=process.memoryUsage().heapUsed;
 wireKeys=new Set();wireStatus={};weatherSpans=[];
 const start=performance.now(),results=await Promise.all(Array.from({length:jobs},run)),wallMs=performance.now()-start,used=process.cpuUsage(cpu);
 // Ownership fetch may be detached after an aborted forecast; retain model until bounded cleanup.
 const tail=performance.now()+6000;while(cache.pending.size&&performance.now()<tail)await new Promise(r=>setTimeout(r,5));
 const sorted=weatherSpans.map(([a,b])=>[Math.max(a,start),Math.min(b,start+wallMs)]).filter(([a,b])=>b>=a).sort((a,b)=>a[0]-b[0]);
 let weatherUnionMs=0,end=start;for(const [a,b]of sorted){weatherUnionMs+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}
 return {mode,kind,warm,jobs,wallMs,weatherUnionMs,cpuUserMs:used.user/1000,cpuSystemMs:used.system/1000,heapDelta:process.memoryUsage().heapUsed-heap,
  physicalGET:gets-before.get,wireStatus:{...wireStatus},distinctPhysicalKeys:wireKeys.size,cacheGet:getsAttempted-before.attempts,parseCalls:parses-before.parse,sqlStatements:db.sqlCalls-before.sql,
  pendingAfter:cache.pending.size,results,sql:'MODEL ONLY',poolLockLeaseExclusive:'NOT_MEASURED',realPg:'NOT_RUN',externalWeatherGET:0,
  measurementStatus:wallMs>150000?'NOT_COMPARABLE':'MEASURED'};
}
async function main(){fs.mkdirSync(out,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  if(process.argv.includes('--smoke')){const rows=[];for(const mode of ['legacy','atlas','atlas_adaptive']){const row=await one(mode,'short');rows.push(row);console.log(JSON.stringify({mode,status:row.results[0].status,ms:row.wallMs,get:row.physicalGET,codes:row.results[0].reasonCodes}));}
   const tag=process.argv.includes('--v4')?'smoke-v4.json':process.argv.includes('--v3')?'smoke-v3.json':process.argv.includes('--v2')?'smoke-v2.json':'smoke.json';fs.writeFileSync(path.join(out,tag),JSON.stringify({epoch,fixtureVersion:'wx-synthetic-grid/4',rows},null,2),{flag:'wx'});return;}
  const rows=[];
  fs.closeSync(fs.openSync(path.join(out,'measurements.jsonl'),'wx'));
  const sources=Object.fromEntries(['src/weather/weather-atlas.ts','src/weather/adaptive-weather-sampler.ts','src/weather/weather.service.ts','src/planning/planning-session.ts','src/planning/ev-planning.service.ts','src/energy/energy-engine.ts','src/weather/validation/weather-experiment-fixture.ts','scripts/benchmark-weather-atlas.cjs'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'apps/api',p))).digest('hex')]));
  fs.writeFileSync(path.join(out,'run-metadata.json'),JSON.stringify({sources,epoch,fixtureVersion:audit?'wx-synthetic-grid/5-source-metadata':'wx-synthetic-grid/4-route-offset-guard',order:'ABCCBA',replicates:2,realPg:'NOT_RUN',realFieldAccuracy:'NOT_RUN'},null,2),{flag:'wx'});
  // Bounded diagnostic acceptance run. n2/arm per cold/warm cohort, not a p95 SLA sample.
  for(const kind of weatherExperimentCases)for(const warm of audit?[true]:[false,true]){
   for(const mode of ['legacy','atlas','atlas_adaptive','atlas_adaptive','atlas','legacy']){
    const row=await one(mode,kind,warm);rows.push(row);
    fs.appendFileSync(path.join(out,'measurements.jsonl'),JSON.stringify(row)+'\n');console.log(JSON.stringify({mode,kind,warm,status:row.results[0].status,ms:row.wallMs,get:row.physicalGET}));
    if(row.measurementStatus!=='MEASURED')throw Error('ENVIRONMENT_INTERRUPTED');
   }
  }
  for(const jobs of [10,25,100])for(const mode of ['legacy','atlas','atlas_adaptive']){
   const row=await one(mode,'short',true,jobs);rows.push(row);fs.appendFileSync(path.join(out,'measurements.jsonl'),JSON.stringify(row)+'\n');console.log(JSON.stringify({mode,jobs,status:row.results[0].status,ms:row.wallMs}));}
  fs.writeFileSync(path.join(out,'benchmark.json'),JSON.stringify({fixtureVersion:'wx-synthetic-grid/4',sources,epoch,rows,realPG:'NOT_RUN',accuracy:'FIELD_ACCURACY_NOT_RUN',decision:'NO_GO_UNTIL_FULL_GATES',warmFixture:'On-demand preseeded fresh MODEL rows; seeding CPU included, no warmup plan or provider traffic. Not real PG deserialize/pool performance.'},null,2),{flag:'wx'});
 }finally{delete process.env.WEATHER_EXECUTION_MODE;await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error('WEATHER_ATLAS_BENCHMARK_FAILED/'+e.name);process.exitCode=1;server.close();});
