const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{isDeepStrictEqual}=require('util');
const h=require('./navigation-performance-fixtures.cjs'),{Index}=h.load();
const signature='export function distanceMeters(a:Coordinate,b:Coordinate){',loop='  for(let i=0;i<lengths.length;i++){';
if(h.original.split(signature).length!==2||h.original.split(loop).length!==2)throw Error('SOURCE_SEAM_CHANGED');
const counted=h.original.replace(signature,signature+'globalThis.__navDiagnostic.lengths++;').replace(loop,loop+'globalThis.__navDiagnostic.projections++;');
const before=h.compile(counted),after=h.compile(h.indexedSource(counted)),rows=[];
for(const size of [200,1000,5000,15000])for(const layout of ['polyline','segments']){
 const w=h.fixture(size,layout);
 if(process.argv.includes('--steady'))w.fixes=w.fixes.map((fix,j)=>({...fix,...(layout==='polyline'?w.route.segments[0].geometry[j*2]:w.route.segments[j*2].geometry[0])}));
 globalThis.__navDiagnostic={lengths:0,projections:0};
 const a=h.sequence(before,w,undefined,true),original={...globalThis.__navDiagnostic};
 globalThis.__navDiagnostic={lengths:0,projections:0};const build={edgeLengthEvaluations:0},index=new Index(w.route,build);
 const b=h.sequence(after,w,index,true),candidate={buildEdgeLengthEvaluations:build.edgeLengthEvaluations,fixEdgeLengthEvaluations:globalThis.__navDiagnostic.lengths,
  projections:globalThis.__navDiagnostic.projections,numericPayloadBytes:index.retainedNumericBytes};
 assert.ok(isDeepStrictEqual(a,b),'NAVIGATION_EQUIVALENCE_FAILED (raw data suppressed)');assert.equal(candidate.projections,original.projections);index.dispose();
 rows.push({size,layout,fixes:w.fixes.length,original,candidate,equivalent:true});
}
delete globalThis.__navDiagnostic;
const result={generatedAt:new Date().toISOString(),status:'PASS',rows,scope:'Separate instrumented operation counts, never timing data; original source body counters only. Candidate constructor optional diagnostic counts actual distanceMeters calls.',
 sources:{original:h.hash(h.original),index:h.hash(fs.readFileSync(path.join(__dirname,'validation/navigation-geometry-index.ts'),'utf8')),harness:h.hash(fs.readFileSync(__filename,'utf8'))},
 render:{status:'NOT_RUN',reason:'No mounted RN component/Profiler/device. Snapshot/Map callbacks unchanged; no render savings or FPS claim.'},
 raceAppStateDevice:{status:'NOT_RUN',reason:'No app callback changes. Generation/abort/AppState source hashes protected; runtime device acceptance not performed.'}};
fs.writeFileSync(path.join(h.folder,process.argv.includes('--steady')?'operations-steady.json':'operations.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'PASS',workloads:rows.length,projectionOrderChanged:false}));
