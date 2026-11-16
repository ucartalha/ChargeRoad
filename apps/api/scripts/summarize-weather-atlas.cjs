const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../../..'),folder=path.join(root,'artifacts/cr-wx-003r-2026-11-16');
const read=p=>JSON.parse(fs.readFileSync(path.join(folder,p),'utf8'));
const percentile=(xs,p)=>{if(!xs.length)return null;return [...xs].sort((a,b)=>a-b)[Math.ceil(p*xs.length)-1];};
const stats=xs=>({n:xs.length,p50:percentile(xs,.5),p95:percentile(xs,.95),min:xs.length?Math.min(...xs):null,max:xs.length?Math.max(...xs):null});
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
function main(){const cold=read('final/benchmark.json'),warm=read('warm-audit/benchmark.json'),parity=read('warm-source-correction.json');
 const rows=[...cold.rows.filter(r=>!r.warm),...warm.rows],groups=[],mismatches=[];
 for(const kind of [...new Set(rows.map(r=>r.kind))])for(const state of [false,true])for(const jobs of [...new Set(rows.filter(r=>r.kind===kind&&r.warm===state).map(r=>r.jobs))]){
  const selected=rows.filter(r=>r.kind===kind&&r.warm===state&&r.jobs===jobs),baseline=selected.filter(r=>r.mode==='legacy');
  for(const mode of ['legacy','atlas','atlas_adaptive']){
   const rs=selected.filter(r=>r.mode===mode),legacy=baseline[0];if(!rs.length)continue;
   if(mode==='atlas')for(const r of rs)for(let i=0;i<r.results.length;i++)if(r.results[i].outcomeHash!==legacy.results[i].outcomeHash||r.results[i].weatherHash!==legacy.results[i].weatherHash)mismatches.push({kind,state,jobs,index:i});
   groups.push({kind,warm:state,jobs,mode,batchWallMs:stats(rs.map(r=>r.wallMs)),plannerWallMs:stats(rs.flatMap(r=>r.results.map(v=>v.metrics.durationMs))),
    firstUsablePlannerWallMs:stats(rs.flatMap(r=>r.results.filter(v=>v.status==='planned').map(v=>v.metrics.durationMs))),
    physicalGET:stats(rs.map(r=>r.physicalGET)),uniquePhysicalKeys:stats(rs.map(r=>r.distinctPhysicalKeys)),cacheGet:stats(rs.map(r=>r.cacheGet)),parse:stats(rs.map(r=>r.parseCalls)),
    modelSql:stats(rs.map(r=>r.sqlStatements)),modelAverageQps:stats(rs.map(r=>r.sqlStatements/(r.wallMs/1000))),weatherUnionMs:stats(rs.map(r=>r.weatherUnionMs)),
    cpuUserMs:stats(rs.map(r=>r.cpuUserMs)),cpuSystemMs:stats(rs.map(r=>r.cpuSystemMs)),heapDelta:stats(rs.map(r=>r.heapDelta)),
    statuses:rs.flatMap(r=>r.results.map(v=>v.status)),reasonCodes:[...new Set(rs.flatMap(r=>r.results.flatMap(v=>v.reasonCodes)))],
    finalSyntheticSoc:stats(rs.flatMap(r=>r.results.flatMap(v=>v.finalSoc===null?[]:[v.finalSoc]))),
    minSyntheticSoc:stats(rs.flatMap(r=>r.results.flatMap(v=>v.minimumSyntheticSoc===null?[]:[v.minimumSyntheticSoc]))),
    energyKwh:stats(rs.flatMap(r=>r.results.flatMap(v=>v.energy===null?[]:[v.energy]))),
    pendingPeak:'NOT_MEASURED',pendingAfter:Math.max(...rs.map(r=>r.pendingAfter)),
    states:stats(rs.flatMap(r=>r.results.flatMap(v=>v.metrics.counters.expanded_states))),transitions:stats(rs.flatMap(r=>r.results.flatMap(v=>v.metrics.counters.transitions)))});
  }
 }
 const coreKeys=Object.keys(cold.sources).filter(k=>!k.startsWith('scripts/')&&!k.includes('validation/weather-experiment-fixture'));
 const coreStable=coreKeys.every(k=>cold.sources[k]===warm.sources[k]);
 const result={decision:'NO_GO',groups,atlasCriticalMismatches:mismatches,coreStable,bodyParity:parity.status,
  realPg:'NOT_RUN',twoInstancePg:'NOT_RUN',independentGrid:'NOT_RUN',field:'FIELD_ACCURACY_NOT_RUN',accuracy:'ACCURACY_UNVERIFIED',
  activeSavings:0,limits:{samplePerArm:2,p95:'small sample maximum, diagnostic only; not SLA/production acceptance',
   plannerWall:'real service metrics exclude fixture construction; batch wall includes fixture/hash overhead',
   weatherUnion:'foreground occupancy union, NOT causally exclusive PG/network/critical path',
   qps:'MODEL average only; true PG p95/max QPS/pool/lock/lease waits NOT_MEASURED'},
  sourceHashes:{cold:cold.sources,warm:warm.sources}};
 fs.writeFileSync(path.join(folder,'comparison.json'),JSON.stringify(result,null,2),{flag:'wx'});
 console.log(JSON.stringify({decision:result.decision,groups:groups.length,atlasCriticalMismatches:mismatches.length,coreStable,bodyParity:parity.status}));
}
main();
