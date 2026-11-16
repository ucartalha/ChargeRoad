const fs=require('fs'),path=require('path'),cp=require('child_process'),os=require('os'),assert=require('assert/strict');
const {PerformanceObserver}=require('perf_hooks');const {setImmediate:yieldLoop}=require('timers/promises');
const h=require('./navigation-performance-fixtures.cjs'),{before,after,Index}=h.load();
const config={processes:3,warmups:3,blocks:4,fixes:32,concurrency:1,numericTolerance:0,performanceSequence:'regular 2-edge progress every 2 seconds; golden adversarial sequences remain unchanged'};
const sizes=[200,1000,5000,15000],layouts=['polyline','segments'];
const tag=process.argv.find(v=>v.startsWith('--tag='))?.slice(6)||'run1';if(!/^[a-z0-9-]+$/.test(tag))throw Error('Invalid tag');
const out=path.join(h.folder,tag);fs.mkdirSync(out,{recursive:true});
const write=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const sourceHashes=()=>Object.fromEntries(['apps/mobile/src/features/navigation/navigation-core.ts','apps/mobile/scripts/validation/navigation-geometry-index.ts',
 'apps/mobile/scripts/navigation-performance-fixtures.cjs','apps/mobile/scripts/benchmark-mobile-navigation.cjs'].map(p=>[p,h.hash(fs.readFileSync(path.join(h.root,p),'utf8'))]));
const sources=sourceHashes(),environment={node:process.version,platform:os.platform(),release:os.release(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length};
function golden(){const rows=[];
 for(const size of sizes)for(const layout of layouts)for(const shape of ['regular','hotspot','loopback','parallel','antimeridian']){
  const w=h.fixture(size,layout,shape),result=h.sequence(before,w,undefined,true);rows.push({size,layout,shape,fixtureHash:h.hash(w),outcomeHash:h.hash(result)});
 }return rows;}
function validation(){const baseline=JSON.parse(fs.readFileSync(path.join(h.folder,'baseline/golden.json'),'utf8'));let compared=0;
 for(const row of baseline.rows){const w=h.fixture(row.size,row.layout,row.shape),index=new Index(w.route),a=h.sequence(before,w,undefined,true),b=h.sequence(after,w,index,true);
  assert.equal(h.hash(w),row.fixtureHash);assert.equal(h.hash(a),row.outcomeHash);assert.deepEqual(b,a);index.dispose();compared+=a.length;}
 // Both pure functions keep the original invalid-fix and continuity boundary behavior.
 const w=h.fixture(200,'segments'),index=new Index(w.route),f=w.fixes[0];
 for(const patch of [{latitude:NaN},{longitude:Infinity},{timestamp:f.timestamp-15001},{timestamp:f.timestamp+2001},{accuracy:null},{accuracy:51},{accuracy:-1}])
  assert.deepEqual(after.navigationProgress(w.route,{...f,...patch},f.timestamp,w.anchor,undefined,index),before.navigationProgress(w.route,{...f,...patch},f.timestamp,w.anchor));
 return {status:'PASS',orderedFixComparisons:compared,goldenCases:baseline.rows.length,tolerance:0};
}
function one(strategy,w,diagnostic=false){const times=[],cpu=process.cpuUsage(),heapBefore=process.memoryUsage().heapUsed,begin=performance.now();
 let index;const buildStart=performance.now();if(strategy==='indexed')index=new Index(w.route);const buildMs=performance.now()-buildStart;
 let previous,last;const outputs=[];
 for(const fix of w.fixes){const start=performance.now();last=(strategy==='indexed'?after:before).navigationProgress(w.route,fix,fix.timestamp,w.anchor,previous,index);times.push(performance.now()-start);
  if(last)previous={distance:last.distance,timestamp:fix.timestamp};if(diagnostic)outputs.push(last);}
 const retainedNumericBytes=index?.retainedNumericBytes??0;index?.dispose();const end=performance.now(),used=process.cpuUsage(cpu);
 return {strategy,totalMs:end-begin,buildMs,fixMs:times,cpuUserMs:used.user/1000,cpuSystemMs:used.system/1000,heapBefore,heapAfter:process.memoryUsage().heapUsed,
  retainedNumericBytes,window:{start:begin,end},resultHash:h.hash(diagnostic?outputs:last),edgeLengthComputations:strategy==='indexed'?index.edgeCount:null};
}
async function child(i){const checks=validation(),events=[],obs=new PerformanceObserver(list=>{for(const e of list.getEntries())if(events.length<10000)events.push({start:e.startTime,duration:e.duration,kind:e.detail?.kind});});obs.observe({entryTypes:['gc']});
 const rows=[];
 for(const size of sizes)for(const layout of layouts){const w=h.fixture(size,layout);
  w.fixes=w.fixes.map((fix,j)=>({...fix,...(layout==='polyline'?w.route.segments[0].geometry[j*2]:w.route.segments[j*2].geometry[0])}));
  const control=one('original',w,true),candidate=one('indexed',w,true);assert.equal(control.resultHash,candidate.resultHash);
  for(let n=0;n<config.warmups;n++){one('original',w);one('indexed',w);}
  for(let block=0;block<config.blocks;block++){global.gc?.();await yieldLoop();for(const strategy of (block+i)%2?['indexed','original','original','indexed']:['original','indexed','indexed','original']){
   rows.push({size,layout,block,process:i,...one(strategy,w)});
  }}
  // First-fix startup and amortization are measured separately, not disguised as warm latency.
  for(const strategy of ['original','indexed'])rows.push({size,layout,block:-1,process:i,firstFixOnly:true,...one(strategy,{...w,fixes:w.fixes.slice(0,1)})});
 }
 await yieldLoop();await yieldLoop();obs.disconnect();assert.deepEqual(sourceHashes(),sources);write('process-'+i+'.json',{generatedAt:new Date().toISOString(),environment,sources,config,checks,gcEvents:events,rows});
 console.log(JSON.stringify({process:i,rows:rows.length,equivalence:checks.status}));
}
const stats=v=>{const a=[...v].sort((a,b)=>a-b),p=x=>a[Math.max(0,Math.ceil(a.length*x)-1)];return {n:a.length,p50:p(.5),p95:p(.95),p99:p(.99),min:a[0],max:a.at(-1)};};
async function parent(){for(let i=1;i<=3;i++){const p=cp.spawnSync(process.execPath,['--expose-gc',__filename,'--child='+i,'--tag='+tag],{cwd:process.cwd(),encoding:'utf8',maxBuffer:1048576});if(p.status!==0)throw Error('CHILD_FAILED');console.log(p.stdout.trim());}
 const processes=[1,2,3].map(i=>JSON.parse(fs.readFileSync(path.join(out,'process-'+i+'.json'),'utf8'))),all=processes.flatMap(p=>p.rows),groups=[];
 for(const size of sizes)for(const layout of layouts){const arm=strategy=>{const r=all.filter(r=>r.size===size&&r.layout===layout&&r.strategy===strategy&&!r.firstFixOnly);return {totalMs:stats(r.map(r=>r.totalMs)),fixMs:stats(r.flatMap(r=>r.fixMs)),buildMs:stats(r.map(r=>r.buildMs)),
  cpuUserMs:r.reduce((n,r)=>n+r.cpuUserMs,0),cpuSystemMs:r.reduce((n,r)=>n+r.cpuSystemMs,0),heapDelta:stats(r.map(r=>r.heapAfter-r.heapBefore)),numericBytes:Math.max(...r.map(r=>r.retainedNumericBytes)),
  firstFixTotalMs:stats(all.filter(r=>r.size===size&&r.layout===layout&&r.strategy===strategy&&r.firstFixOnly).map(r=>r.totalMs)),
  perProcess:[1,2,3].map(process=>({process,totalMs:stats(r.filter(r=>r.process===process).map(r=>r.totalMs)),cpuMs:r.filter(r=>r.process===process).reduce((n,r)=>n+r.cpuUserMs+r.cpuSystemMs,0)}))};};
  const a=arm('original'),b=arm('indexed');groups.push({size,layout,before:a,indexed:b,totalP50GainPercent:100*(a.totalMs.p50-b.totalMs.p50)/a.totalMs.p50,
   p95RegressingProcesses:b.perProcess.filter((p,i)=>p.totalMs.p95>a.perProcess[i].totalMs.p95*1.05).length});}
 write('summary.json',{generatedAt:new Date().toISOString(),environment,sources,config,groups,equivalence:'PASS',
  performanceGate:groups.every(g=>g.totalP50GainPercent>5&&g.p95RegressingProcesses<2)?'CANDIDATE_GO':'NO_GO',
  device:'NOT_RUN',reactProfiler:'NOT_RUN',renderProxy:'UNCHANGED: current snapshot/progress/map update path deliberately unchanged; no measured render saving',
  note:'Exact original source snapshot is control, not a reimplemented solver. Build and disposal included in total; fix timers exclude build. First-fix-only cold cost is separate. n=24 sequence samples/arm/group, p99 is sample maximum.'});
}
async function main(){if(process.argv.includes('--baseline')){assert.equal(h.hash(fs.readFileSync(h.filename,'utf8')),h.hash(h.original));const start=performance.now(),rows=golden();write('golden.json',{generatedAt:new Date().toISOString(),originalSourceHash:h.hash(h.original),rows,wallMs:performance.now()-start});console.log(JSON.stringify({baseline:'PASS',cases:rows.length}));return;}
 const c=process.argv.find(v=>v.startsWith('--child='))?.slice(8);if(c)return child(Number(c));if(process.argv.includes('--benchmark'))return parent();throw Error('Invalid mode');}
main().catch(()=>{console.error('MOBILE_NAVIGATION_MEASUREMENT_FAILED; raw GPS/SOC/route/error suppressed');process.exitCode=1;});
