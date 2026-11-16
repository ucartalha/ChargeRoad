const fs=require('fs'),path=require('path'),{isDeepStrictEqual:eq}=require('node:util');
const folder=path.resolve(__dirname,'../../../docs/validation/cr-lat-002r-2026-11-16');
const read=p=>JSON.parse(fs.readFileSync(path.join(folder,p),'utf8'));
const percentile=(xs,p)=>[...xs].sort((a,b)=>a-b)[Math.max(0,Math.ceil(xs.length*p)-1)];
const distribution=xs=>({n:xs.length,p50:percentile(xs,.5),p95:percentile(xs,.95),min:Math.min(...xs),max:Math.max(...xs)});
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
function main(){const records=[1,2,3].map(i=>read(`contract-v2/weather-wait-process-${i}.json`)),groups=[],failures=[];
 for(const jobs of [1,10,100])for(const keys of [1,3]){
  const rows=records.flatMap(r=>r.rows.filter(v=>v.jobs===jobs&&v.distinctKeys===keys)),before=rows.filter(r=>!r.candidate),after=rows.filter(r=>r.candidate),reference=before[0];
  for(const row of rows)if(!eq(reference.semantic,row.semantic))failures.push({jobs,keys});
  const b=distribution(before.map(r=>r.wallMs)),a=distribution(after.map(r=>r.wallMs));
  groups.push({jobs,keys,before:b,after:a,p95DeltaPercent:100*(a.p95/b.p95-1),medianSavingPercent:100*(1-a.p50/b.p50),
   beforeSql:mean(before.map(r=>r.sql.total)),afterSql:mean(after.map(r=>r.sql.total)),beforeSelect:mean(before.map(r=>r.sql.select)),afterSelect:mean(after.map(r=>r.sql.select)),
   beforeClaim:mean(before.map(r=>r.sql.claim)),afterClaim:mean(after.map(r=>r.sql.claim)),
   beforeCpu:distribution(before.map(r=>r.cpuUserMs+r.cpuSystemMs)),afterCpu:distribution(after.map(r=>r.cpuUserMs+r.cpuSystemMs)),
   beforeHeap:distribution(before.map(r=>r.heapDelta)),afterHeap:distribution(after.map(r=>r.heapDelta)),
   physicalCalls:[...new Set(rows.map(r=>Object.values(r.semantic.physical).reduce((a,b)=>a+b,0)))],
   perProcess:records.map(record=>({id:record.id,before:distribution(record.rows.filter(r=>!r.candidate&&r.jobs===jobs&&r.distinctKeys===keys).map(r=>r.wallMs)),after:distribution(record.rows.filter(r=>r.candidate&&r.jobs===jobs&&r.distinctKeys===keys).map(r=>r.wallMs))}))});
 }
 const old=[1,2,3].map(i=>read(`weather-wait-process-${i}.json`));let oldStrictFailures=0,oldNewContractFailures=0;
 for(const r of old){oldStrictFailures+=r.failures.length;for(const jobs of [1,10,100])for(const keys of [1,3]){
  const rows=r.rows.filter(v=>v.jobs===jobs&&v.distinctKeys===keys);for(const v of rows.slice(1))if(!eq(rows[0].semantic,v.semantic))oldNewContractFailures++;
 }}
 const semantics=records.flatMap(r=>r.semantics),value={stage:'OFFLINE_CANDIDATE_ONLY',productionDecision:'NO_GO',
  contract:'per-key event order + owner/fetch/status/saved document/forecast/counters/pending equivalence; independent key dictionary insertion order is not an invariant',
  groups,failures,semanticGate:!failures.length&&records.every(r=>r.status==='PASS')?'PASS':'FAIL',
  semanticCases:{total:semantics.length,passed:semantics.filter(r=>r.status==='PASS').length},
  rawGlobalOrderVariants:groups.map(g=>({jobs:g.jobs,keys:g.keys,variants:new Set(records.flatMap(r=>r.rows.filter(v=>v.jobs===g.jobs&&v.distinctKeys===g.keys).map(v=>JSON.stringify(v.rawOrder)))).size})),
  historicalStrictFAILPreserved:{old31:'Unchanged LAT-002 evidence',initialNewRawFailures:oldStrictFailures,initialNewPerKeySemanticFailures:oldNewContractFailures,classification:'GLOBAL_ORDER_NONDETERMINISTIC'},
  realPg:'NOT_RUN',realProvider:'NOT_RUN',activeSavings:0,
  environment:'Windows; process CPU microseconds API exposes coarse scheduler accounting. Three child processes sequential. Background full Jest verification overlapped part of the model experiment: timing is diagnostic, NOT isolated performance acceptance. n6 per arm/cohort; p95 is sample maximum; no p99/SLA claim.',
  overlap:'SQL/connect/transport spans inclusive; not summed/subtracted as exclusive job critical path',
  sources:records.map(r=>({id:r.id,production:r.productionSourceSha256,candidate:r.candidateSourceSha256,proof:r.proofSourceSha256,model:r.modelSourceSha256}))};
 fs.writeFileSync(path.join(folder,'weather-analysis.json'),JSON.stringify(value,null,2),{flag:'wx'});
 console.log(JSON.stringify({status:value.semanticGate,groups:groups.map(g=>({jobs:g.jobs,keys:g.keys,before:g.before.p95,after:g.after.p95,delta:g.p95DeltaPercent,sql:[g.beforeSql,g.afterSql]})),semantics:value.semanticCases}));
}
main();
