const fs=require('fs'),path=require('path'),base=path.resolve(__dirname,'../../../docs/validation/cr-lat-002-2026-11-16');
const rows=[];
for(let i=1;i<=3;i++){const p=JSON.parse(fs.readFileSync(path.join(base,`trace-v2/weather-process-${i}.json`),'utf8'));
 for(const r of p.rows.filter(r=>r.enabled&&r.kind==='known')){
  // All known-forecast events settle before Promise.all returns. No canceled detached tails in this set.
  const events=r.trace.events,cuts=[...new Set(events.flatMap(e=>[e.start,e.end]))].sort((a,b)=>a-b),categories={};
  for(let j=1;j<cuts.length;j++){const a=cuts[j-1],b=cuts[j],active=[...new Set(events.filter(e=>e.start<=a&&e.end>=b).map(e=>e.category))];
   if(!active.length)continue;const k=active.length===1?active[0]:'overlap_unattributable';categories[k]=(categories[k]??0)+b-a;}
  const covered=Object.values(categories).reduce((a,b)=>a+b,0),error=covered-r.wallMs;
  rows.push({process:i,profile:r.profile,objective:r.objective,warm:r.warm,batchForecastCalls:r.forecastCalls,batchAwaitedWallMs:r.wallMs,categories,
   unattributedMs:Math.max(0,r.wallMs-covered),coveredMs:covered,withinWall:error<=1e-8,clockAccountingToleranceMs:1e-8,
   meaning:'Event-occupancy partition only. Overlaps have no causal attribution. SQL/transport are fixture boundaries, not real PG/network. Multiple forecast calls are batch wall, NOT per-job critical path.'});
 }}
const result={generatedAt:new Date().toISOString(),status:rows.every(r=>r.withinWall)?'PASS':'FAIL',rows,
 negativeDetachedCases:'NOT_MEASURED at batch level; raw per-get clipped partitions retained',historical18624And72148ExclusiveComponents:'NOT_MEASURED'};
fs.writeFileSync(path.join(base,'acquisition-coverage.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:result.status,rows:rows.length}));
