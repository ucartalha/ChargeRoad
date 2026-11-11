import { mkdir,writeFile } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { DatabaseService } from '../src/database/database.service';
import { DbStationDataProvider } from '../src/stations/db-station.provider';
import { STATION_POLICY } from '../src/stations/station-policy';
import { fixture } from '../src/planning/__tests__/fixtures';
import { latencySummary } from '../src/planning/validation/metrics';
import type { RoadRoute } from '@chargeroad/shared';

function geometry(points:[number,number][],id:string):RoadRoute {
  const route=fixture().road;route.id=id;
  route.segments[0].id=id+'-segment';route.segments[0].geometry=points.map(([lon,lat])=>({latitude:lat,longitude:lon}));
  return route;
}
async function main(){
  const database=new DatabaseService();
  try{
    const provider=new DbStationDataProvider(database),signal=new AbortController().signal;
    // Representative geometries only. They are NOT actual roads or a hard-coded product pilot route.
    const short=geometry([[32.8,39.9],[32.8,39.909]],'short-line');
    const reverse=geometry([[32.8,39.909],[32.8,39.9]],'reversed-line');
    const long=geometry([[29,40.9],[30.5,40.5],[32.8,39.9],[34.7,39.8]],'long-bending-line');
    const sparse=geometry([[44,41.5],[44.05,41.6]],'sparse-line');
    const cases:[string,RoadRoute[]][]=[['short_line',[short]],['two_directions',[short,reverse]],['long_bending_line',[long]],['sparse_line',[sparse]]];
    const groups=[] as (ReturnType<typeof latencySummary>['all'] & {name:string;errors:number;maxCandidates:number;truncatedResponses:number;elapsedMs:number;maxPoolWaiting:number})[];
    for(const [name,routes]of cases){
      for(let i=0;i<30;i++)await provider.findAlongRoutes(routes,2000,signal,['ccs2']);
      let next=0,maxCandidates=0,truncatedResponses=0,maxPoolWaiting=0;
      const samples:{status:string;durationMs:number}[]=[];const start=performance.now();
      await Promise.all(Array.from({length:4},async()=>{
        while(next++<1000){
          const before=performance.now();let status='ok';
          try{const r=await provider.findAlongRoutes(routes,2000,signal,['ccs2']);maxCandidates=Math.max(maxCandidates,r.data.candidates.length);
            if(r.data.metadata.search.truncated)truncatedResponses++;}catch{status='error';}
          samples.push({status,durationMs:performance.now()-before});maxPoolWaiting=Math.max(maxPoolWaiting,database.pool.waitingCount);
        }
      }));
      groups.push({name,...latencySummary(samples).all,errors:samples.filter(s=>s.status==='error').length,
        maxCandidates,truncatedResponses,elapsedMs:performance.now()-start,maxPoolWaiting});
    }
    const plan=(await database.pool.query(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT location_id FROM station_catalogue_heads
      WHERE public.ST_DWithin(location_geog,public.ST_GeogFromText($1),2000)`,['LINESTRING(32.8 39.9,32.8 39.909)'])).rows[0]['QUERY PLAN'];
    const counts=(await database.pool.query(`SELECT
      (SELECT count(*)::int FROM station_catalogue_heads) AS locations,
      (SELECT count(*)::int FROM station_catalogue_heads WHERE public_access) AS public_locations,
      (SELECT count(*)::int FROM station_connector_claims) AS connector_claim_revisions,
      (SELECT count(*)::int FROM charging_evses) AS physical_evse_revisions`)).rows[0];
    const sources=(await database.pool.query(`SELECT s.id,s.source_key,s.scope_key,s.content_sha256,s.report,pub.last_checked_at
      FROM station_source_publications pub JOIN station_source_snapshots s ON s.id=pub.snapshot_id`)).rows;
    const output=resolve(process.argv[2]??'../../artifacts/stations/benchmark.json');
    await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({schemaVersion:1,generatedAt:new Date().toISOString(),
      scope:'local_postgis_candidate_microbenchmark_not_navigation_or_live_availability',policy:STATION_POLICY,concurrency:4,warmupPerCase:30,
      counts,sources,groups,indexPlan:plan,environment:{node:process.version,platform:process.platform,cpu:cpus()[0]?.model},
      limitations:['Synthetic geometries against the real station catalogue; not actual route/detour validation',
        'No operator HTTP load, live availability, battery/charging calculation or production SLA',
        'Short test duration; no sustained imports/telemetry load']},null,2)+'\n');
    console.log(JSON.stringify({output,counts,groups},null,2));if(groups.some(g=>g.errors))process.exitCode=1;
  }finally{await database.onModuleDestroy();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
