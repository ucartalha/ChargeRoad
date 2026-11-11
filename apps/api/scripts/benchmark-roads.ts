import { readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ValhallaRoadAdapter } from '../src/roads/valhalla-adapter';
import { normalizeRoadTrip } from '../src/roads/normalize-road';
import { config,roadRequest } from '../src/roads/__tests__/fixtures';
import { DatabaseService } from '../src/database/database.service';
import { PgRoadClient } from '../src/roads/road-client';
import { latencySummary } from '../src/planning/validation/metrics';

// No external HTTP: real response fixture and local PostgreSQL cache only.
async function main(){
  const directory=resolve(__dirname,'../src/roads/__tests__/fixtures');
  const raw=JSON.parse(await readFile(resolve(directory,'ankara-route.json'),'utf8'));
  const trace=JSON.parse(await readFile(resolve(directory,'ankara-trace.json'),'utf8'));
  const client={post:async(_provider:string,url:string)=>({data:url.endsWith('trace_attributes')?trace:raw,retrievedAt:'2026-11-11T13:00:00Z'})};
  const adapter=new ValhallaRoadAdapter(config),request=roadRequest(),signal=new AbortController().signal;
  const input=(await adapter.route(request,[request.origin,request.destination],client,signal))![0];
  input.legs[0].edges=await adapter.attributes(input.legs[0],client,signal);
  const samples:{status:string;durationMs:number}[]=[];
  for(let i=0;i<1050;i++){const start=performance.now();normalizeRoadTrip(input,request,config,new Map());
    if(i>=50)samples.push({status:'ok',durationMs:performance.now()-start});}
  const database=new DatabaseService();let fakeCalls=0;
  try{
    const cache=new PgRoadClient(database,config,'benchmark-only-secret-at-least-32-characters',async()=>{fakeCalls++;return raw;});
    const id='local-road-benchmark-'+Date.now(),body={fixture:'ankara'};
    await cache.post(id,'https://example.invalid/route',body,signal);
    const hits:{status:string;durationMs:number}[]=[];
    let next=0;await Promise.all(Array.from({length:4},async()=>{while(next++<1000){const start=performance.now();
      await cache.post(id,'https://example.invalid/route',body,signal);hits.push({status:'ok',durationMs:performance.now()-start});}}));
    const report={generatedAt:new Date().toISOString(),scope:'local fixture / cache only; no provider load or production SLA',
      normalization:latencySummary(samples).all,postgresCacheConcurrency:4,postgresCache:latencySummary(hits).all,
      fakeTransportCalls:fakeCalls,externalHttpCalls:0};
    await database.pool.query('DELETE FROM road_response_cache WHERE provider_id=$1',[id]);
    await database.pool.query('DELETE FROM road_provider_budget WHERE provider_id=$1',[id]);
    await writeFile(resolve(__dirname,'../../../docs/validation/task9-road-benchmark.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  }finally{await database.onModuleDestroy();}
}
void main().catch((e:unknown)=>{console.error(e instanceof Error?e.message:'Road benchmark failed');process.exitCode=1;});
