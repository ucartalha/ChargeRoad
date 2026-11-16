/** Untimed cardinality/safety probe. Real app, warm MODEL SQL, synthetic series only. */
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const RealDate=Date,epoch=RealDate.now();global.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[epoch]));}static now(){return epoch;}};
const {WeatherService,WeatherAdapterRegistry}=require('../src/weather/weather.service.ts'),{WeatherCacheStore}=require('../src/weather/weather-cache.ts');
const {MetNorwayAdapter}=require('../src/weather/met-norway.adapter.ts'),{weatherTransport}=require('../src/weather/weather-http.ts');
const {weatherSampleLocation}=require('../src/weather/weather-spatial.ts'),{meters}=require('../src/roads/geometry.ts');
const {weatherExperimentWorld,experimentDocument}=require('../src/weather/validation/weather-experiment-fixture.ts');
const {replayOptimizer}=require('../src/planning/planning-replay.ts');
const SqlFixture=require('./validation/weather-sql-model.cjs')(RealDate),hash=v=>crypto.createHash('sha256').update(JSON.stringify(v,(k,v)=>k==='elapsedMilliseconds'?undefined:v)).digest('hex');
async function run(mode,kind){process.env.WEATHER_EXECUTION_MODE=mode;
 const config={enabled:true,providerId:'synthetic-met',endpoint:'http://127.0.0.1:9/forecast',userAgent:'ChargeRoad/warm-model',termsAccepted:true};
 const adapter=new MetNorwayAdapter(config),db=new SqlFixture(),secret='synthetic-atlas-probe-secret-at-least-32-characters';
 const cache=new WeatherCacheStore({pool:db},weatherTransport(config),secret),get=cache.get.bind(cache),requested=new Set(),attempted=new Set();
 const stats={fallbackExact:0,maxOffsetMeters:0,maxAltitudeDifference:0,forecastCalls:0,queryItems:0,steps:{},rejectReasons:{},
  temperatures:[],winds:[],directions:[],pressures:[],sourceAgesSeconds:[],quality:{},sourceVersions:new Set(),licenses:new Set()};
 cache.get=async(...args)=>{const key=crypto.createHmac('sha256',secret).update('weather-cache/v1\0'+args[0]+'\0'+args[1]+'\0'+args[2]).digest('hex');attempted.add(key);
  if(!db.rows.has(key)){const u=new URL(args[2]);db.rows.set(key,{provider:args[0],doc:experimentDocument(Number(u.searchParams.get('lat')),Number(u.searchParams.get('lon')),kind),expires:RealDate.now()+3600000,retry:0,generation:0,token:null});}
  try{return await get(...args);}catch(e){const reason=e.kind??'other';stats.rejectReasons[reason]=(stats.rejectReasons[reason]??0)+1;throw e;}
 };
 const service=new WeatherService(config,new WeatherAdapterRegistry([adapter]),cache),forecast=service.forecast.bind(service),trace=[];
 service.forecast=async(queries,...args)=>{
  stats.forecastCalls++;stats.queryItems+=queries.length;for(const q of queries){requested.add(hash(adapter.url(weatherSampleLocation(q))));const step=q.samplingResolution?.intervalMeters??0;stats.steps[step]=(stats.steps[step]??0)+1;}
  const response=await forecast(queries,...args);trace.push([hash(queries),hash(response)]);
  for(let i=0;i<queries.length;i++){const q=queries[i],f=response.data[i];
   for(const [field,value]of [['temperatures',f.temperatureCelsius],['winds',f.windSpeedKph],['directions',f.windFromDegrees],['pressures',f.airPressureHpa]])if(value!==null)stats[field].push(value);
   stats.quality[f.status??'unspecified']=(stats.quality[f.status??'unspecified']??0)+1;stats.sourceVersions.add(f.source.version);stats.licenses.add(f.source.license);
   const issued=f.sourceUpdatedAt??f.forecastIssuedAt;if(issued)stats.sourceAgesSeconds.push((Date.now()-Date.parse(issued))/1000);
   if(f.metadata){stats.maxOffsetMeters=Math.max(stats.maxOffsetMeters,f.metadata.sampleDistanceMeters);
    if(f.metadata.sampleDistanceMeters<30&&meters(q.location,q.sampleLocation??q.location)>30)stats.fallbackExact++;
    if(q.sampleElevationMeters!==undefined&&f.metadata.sampledElevationMeters!==null)stats.maxAltitudeDifference=Math.max(stats.maxAltitudeDifference,Math.abs(q.sampleElevationMeters-f.metadata.sampledElevationMeters));}}
  return response;
 };
 const w=weatherExperimentWorld(kind,service),outcome=await w.service.plan(w.request,w.preparation,w.options),plan=outcome.result.status==='planned'?outcome.result.plan:null;
 const replay=plan?await replayOptimizer(outcome.replay,w.preparation.road,new AbortController().signal):null;
 for(const field of ['temperatures','winds','directions','pressures','sourceAgesSeconds']){const values=stats[field];stats[field]={count:values.length,min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null};}
 stats.sourceVersions=[...stats.sourceVersions];stats.licenses=[...stats.licenses];
 return {mode,kind,status:outcome.result.status,outcomeHash:hash(outcome),traceHash:hash(trace),requestedCanonicalKeys:requested.size,attemptedCanonicalKeys:attempted.size,
  cacheCounters:cache.counters,stats,sqlStatements:db.sqlCalls,physicalGET:cache.counters.externalCalls,minSyntheticSoc:plan?Math.min(...plan.energySegments.map(s=>s.minimumChargePercent)):null,
  reserveViolations:plan?plan.energySegments.filter(s=>s.minimumChargePercent<plan.minimumReserveChargePercent-1e-8).length:null,
  finalSyntheticSoc:plan?.estimatedArrivalChargePercent??null,stops:plan?.chargingStops.map(s=>hash(s.stationId))??null,
  stationArrivalSyntheticSoc:plan?.chargingStops.map(s=>s.arrivalChargePercent)??null,
  energySyntheticKwh:plan?.energySegments.reduce((sum,s)=>sum+s.netBatteryEnergyKwh,0)??null,
  replayEquivalence:replay?(hash(replay.result)===hash(outcome.result)?'PASS':'FAIL'):'NOT_APPLICABLE_NO_PLAN',
  source:'Synthetic analytical document generator; not independent observed weather accuracy',falseSafeAgainstIndependentGrid:'NOT_RUN'};
}
async function main(){const rows=[];try{for(const kind of ['short','motorway600','long850','mountain','wind_shift','reserve'])for(const mode of ['legacy','atlas','atlas_adaptive']){const r=await run(mode,kind);rows.push(r);console.log(JSON.stringify({kind,mode,status:r.status,keys:r.attemptedCanonicalKeys}));}
 fs.writeFileSync(path.resolve(__dirname,'../../../artifacts/cr-wx-003r-2026-11-16/'+(process.argv.includes('--final')?'cardinality-final.json':'cardinality.json')),JSON.stringify({epoch,rows,realPg:'NOT_RUN',accuracy:'ACCURACY_UNVERIFIED',timing:'untimed probe, not performance acceptance'},null,2),{flag:'wx'});
}finally{delete process.env.WEATHER_EXECUTION_MODE;}}
main().catch(e=>{console.error('ATLAS_PROBE_FAILED/'+e.name);process.exitCode=1;});
