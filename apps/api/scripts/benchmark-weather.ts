import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {DatabaseService} from '../src/database/database.service';
import {WeatherCacheStore} from '../src/weather/weather-cache';
import {MetNorwayAdapter} from '../src/weather/met-norway.adapter';
import {normalizeWeather} from '../src/weather/weather-normalize';
import {latencySummary} from '../src/planning/validation/metrics';
import type {WeatherDocument} from '../src/weather/weather-ports';

async function main(){
  const doc=JSON.parse(await readFile(resolve(__dirname,'../src/weather/__tests__/fixtures/met-ankara-document.json'),'utf8')) as WeatherDocument;
  const adapter=new MetNorwayAdapter({enabled:false,providerId:'fixture-met',endpoint:'https://example.invalid',userAgent:'benchmark-only',termsAccepted:false});
  const series=adapter.parse(doc),base=Date.parse(series.sourceUpdatedAt),samples:{status:string;durationMs:number}[]=[];
  const queries=Array.from({length:207},(_,i)=>({id:'benchmark-'+i,segmentId:'segment-'+i,location:series.location,validAt:new Date(base+3600000+i*1000).toISOString()}));
  for(let i=0;i<1030;i++){const start=performance.now();for(const q of queries)normalizeWeather(series,q,'fixture-met',base+1000);
    if(i>=30)samples.push({status:'ok',durationMs:performance.now()-start});}
  const database=new DatabaseService();const id='local-weather-benchmark-'+Date.now();let fakeCalls=0;
  try{
    const cache=new WeatherCacheStore(database,async()=>{fakeCalls++;return {...doc,expiresAt:new Date(Date.now()+3600000).toISOString()};},'benchmark-weather-secret-at-least-32-characters');
    const url='https://example.invalid/forecast',signal=new AbortController().signal;
    await cache.get(id,'1',url,signal,{used:0,limit:1},d=>{adapter.parse(d);});
    let next=0;const hits:{status:string;durationMs:number}[]=[];
    await Promise.all(Array.from({length:4},async()=>{while(next++<1000){const start=performance.now();
      await cache.get(id,'1',url,signal,{used:0,limit:0},d=>{adapter.parse(d);});hits.push({status:'ok',durationMs:performance.now()-start});}}));
    const report={generatedAt:new Date().toISOString(),scope:'Local MET fixture + PostgreSQL only; no external HTTP or production SLA',
      queriesPerNormalization:queries.length,normalization:latencySummary(samples).all,postgresCacheConcurrency:4,
      postgresCache:latencySummary(hits).all,fakeTransportCalls:fakeCalls,externalHttpCalls:0};
    await writeFile(resolve(__dirname,'../../../docs/validation/task10-weather-benchmark.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  }finally{
    await database.pool.query('DELETE FROM weather_forecast_cache WHERE provider_id=$1',[id]);
    await database.pool.query('DELETE FROM weather_provider_state WHERE provider_id=$1',[id]);await database.onModuleDestroy();
  }
}
void main().catch((e:unknown)=>{console.error(e instanceof Error?e.message:'Weather benchmark failed');process.exitCode=1;});
