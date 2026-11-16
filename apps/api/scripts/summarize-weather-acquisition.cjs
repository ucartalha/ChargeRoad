const fs=require('fs'),path=require('path');const folder=path.resolve(__dirname,'../../../docs/validation/cr-lat-002-2026-11-16'),base=path.join(folder,'trace-v2');
const processes=[1,2,3].map(i=>JSON.parse(fs.readFileSync(path.join(base,`weather-process-${i}.json`),'utf8')));
if(new Set(processes.map(p=>p.fixtureEpoch)).size!==1||new Set(processes.map(p=>JSON.stringify(p.sources))).size!==1)throw Error('CROSS_PROCESS_FIXTURE_OR_SOURCE_MISMATCH');
const stat=v=>{const a=[...v].sort((a,b)=>a-b),q=p=>a[Math.max(0,Math.ceil(p*a.length)-1)];return {n:a.length,p50:q(.5),p95:q(.95),p99:q(.99),min:a[0],max:a.at(-1)};},all=processes.flatMap((p,i)=>p.rows.map(r=>({...r,process:i+1}))),groups=[];
for(const profile of ['short','medium','long'])for(const objective of ['minimum_total_duration','minimum_charging_stops','minimum_energy'])for(const warm of [false,true]){
 const r=all.filter(r=>r.profile===profile&&r.objective===objective&&r.warm===warm),arm=enabled=>{const v=r.filter(r=>r.enabled===enabled);
  return {wallMs:stat(v.map(v=>v.wallMs)),cpuUserMs:v.reduce((n,v)=>n+v.cpuUserMs,0),cpuSystemMs:v.reduce((n,v)=>n+v.cpuSystemMs,0),
   fixtureSqlCalls:stat(v.map(v=>v.fixtureSqlCalls)),fixtureTransportCalls:stat(v.map(v=>v.physicalFixtureTransportCalls)),heapDelta:stat(v.map(v=>v.heapDelta)),
   cacheCounterVariants:[...new Set(v.map(v=>JSON.stringify(v.cacheCounters)))].map(s=>JSON.parse(s)),orderHashVariants:new Set(v.map(v=>v.transportOrderHash)).size,
   perProcess:[1,2,3].map(i=>({process:i,wallMs:stat(v.filter(v=>v.process===i).map(v=>v.wallMs))}))};};
 const on=r.filter(r=>r.enabled),perGet=on.flatMap(r=>r.trace.decomposition),maxOverflow=Math.max(0,...perGet.map(g=>Object.values(g.categories).reduce((a,b)=>a+b,0)-g.awaitedWallMs));
 groups.push({profile,objective,warm,before:arm(false),observed:arm(true),outcomeVariants:new Set(r.map(r=>JSON.stringify(r.result))).size,
  fieldVariantCounts:Object.fromEntries(['result','physicalFixtureTransportCalls','httpCodes','cacheCounters'].map(k=>[k,new Set(r.map(r=>JSON.stringify(r[k]))).size])),
  queryItems:r[0].queryItems,forecastCalls:r[0].forecastCalls,uniqueRequestedLocations:r[0].uniqueRequestedLocations,uniqueActualSampleLocations:r[0].uniqueActualSampleLocations,
  distinctLocationTimePairs:r[0].distinctLocationTimePairs,distinctProviderCacheKeys:r[0].distinctProviderCacheKeys,
  perGetCoveragePartitionMaxOverflowMs:maxOverflow,perGetCategories: [...new Set(perGet.flatMap(g=>Object.keys(g.categories)))],forecastSelectionCalls:on.map(r=>r.trace.events.filter(e=>e.category==='forecast_selection').length),
  perJobExclusiveWait:'NOT_MEASURED: overlapping acquisitions; fixture labels cannot attribute real PG/network/lock causality'});
}
const result={generatedAt:new Date().toISOString(),sources:processes[0].sources,fixtureEpoch:processes[0].fixtureEpoch,groups,
 instrumentationOrderGate:processes.every(p=>p.status==='PASS')?'PASS':'FAIL',failures:processes.flatMap((p,i)=>p.failures.map(f=>({process:i+1,...f}))),
 semanticStatuses:processes.map((p,i)=>({process:i+1,cases:p.semantics.map(s=>({kind:s.kind,status:s.status}))})),
 actualSavings:0,stageB:'NOT_RUN',realPgPerformance:'NOT_MEASURED: readonly missing-key EXPLAIN only, no mutation fixture authorized',
 notes:['All strict mismatches retained; no sorting of provider order or expected/golden replacement.','Even baseline-only order varies in several cohorts; this is not proven observer causality, but strict invariance remains unproven.',
  'SQL model enforces test serialization with JS mutex. It does not prove actual PostgreSQL lock/lease races.','Metrics overhead timings include actual fixture awaits; compiler/setup excluded; not production instrumentation acceptance.','n6 per arm/group; p95/p99 sample maximum. Job labels 3 objectives do not run the optimizer in this forecast microflow.']};
fs.writeFileSync(path.join(folder,'acquisition-analysis.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({groups:groups.length,orderGate:result.instrumentationOrderGate,failures:result.failures.length,maxPartitionOverflow:Math.max(...groups.map(g=>g.perGetCoveragePartitionMaxOverflowMs))}));
