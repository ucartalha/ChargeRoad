const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto'),{PerformanceObserver,monitorEventLoopDelay}=require('perf_hooks');
const root=path.resolve(__dirname,'../../..'),out=path.join(root,'docs/validation/cr-lat-002-2026-11-16');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const sources=Object.fromEntries(['apps/api/src/planning/__tests__/state-shadow-equivalence.spec.ts','apps/api/src/planning/validation/state-dominance-validation.ts',
 'apps/api/src/planning/charge-stop-optimizer.ts','apps/api/src/energy/energy-engine.ts','apps/api/src/charging/charging-engine.ts','apps/api/scripts/diagnose-weather-regression.cjs'].map(p=>[p,hash(p)]));
const write=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const objectives=['minimum_total_duration','minimum_charging_stops','minimum_energy'];
async function child(objective,repeat){
 const RealDate=Date,epoch=Date.parse('2026-11-15T09:00:00Z');global.Date=class extends RealDate{constructor(v){super(v===undefined?epoch:v);}static now(){return epoch;}};
 let external=0;global.fetch=async()=>{external++;throw Error('External calls forbidden');};process.env.PLANNING_METRICS_ENABLED='false';
 const {validateStateCase}=require('../src/planning/validation/state-dominance-validation.ts');
 const gc=[],obs=new PerformanceObserver(list=>{for(const e of list.getEntries())gc.push({start:e.startTime,duration:e.duration,kind:e.detail?.kind});});obs.observe({entryTypes:['gc']});
 const lag=monitorEventLoopDelay({resolution:10});lag.enable();const pending=[],heapBefore=process.memoryUsage().heapUsed,cpu=process.cpuUsage(),start=performance.now();
 const sampler=setInterval(()=>pending.push({elapsedMs:performance.now()-start,resources:process.getActiveResourcesInfo()}),100);sampler.unref();
 let result,error;try{result=await validateStateCase('equal_alternatives',objective);}catch(e){error=/^[A-Z_]+(?:\/[a-z_]+)*$/.test(e.message)?e.message:'VALIDATION_ERROR';}
 const wallMs=performance.now()-start,used=process.cpuUsage(cpu);clearInterval(sampler);await new Promise(r=>setImmediate(r));lag.disable();obs.disconnect();
 write(`native-${repeat}-${objective}.json`,{generatedAt:new RealDate().toISOString(),mode:'opt-in native process, same original exported invariant function, fixed same wall clock; bootstrap excluded',
  sources,objective,repeat,original5000msGate:wallMs<5000&&!error&&result?.equivalent&&external===0?'PASS':'FAIL',wallMs,cpuUserMs:used.user/1000,cpuSystemMs:used.system/1000,
  heapBefore,heapAfter:process.memoryUsage().heapUsed,gc,eventLoop:{meanMs:Number.isFinite(lag.mean)?lag.mean/1e6:null,maxMs:lag.max/1e6},pendingSamples:pending,
  endResources:process.getActiveResourcesInfo(),externalCalls:external,dbPoolWait:'NOT_APPLICABLE: original synthetic ports, no DB',workerThreads:'none created',result,error});
}
async function main(){const c=process.argv.find(x=>x.startsWith('--objective='))?.slice(12);if(c)return child(c,Number(process.argv.find(x=>x.startsWith('--repeat='))?.slice(9)));
 const jestFile=require.resolve('jest/bin/jest');
 const j=cp.spawnSync(process.execPath,['--cpu-prof','--cpu-prof-dir='+out,'--trace-gc',jestFile,'--runInBand','--runTestsByPath','src/planning/__tests__/state-shadow-equivalence.spec.ts','--testNamePattern=equal_alternatives','--detectOpenHandles'],
  {cwd:path.resolve(__dirname,'..'),encoding:'utf8',timeout:90000,maxBuffer:10*1024*1024});
 const log=(j.stdout||'')+(j.stderr||'');fs.writeFileSync(path.join(out,'original-jest.log'),log,{flag:'wx'});
 write('original-jest.json',{generatedAt:new Date().toISOString(),sources,status:j.status===0?'PASS':'FAIL',exitCode:j.status,watchdog:j.error?.code??null,
  command:'node --cpu-prof --trace-gc jest --runInBand --runTestsByPath state-shadow-equivalence.spec.ts --testNamePattern=equal_alternatives --detectOpenHandles',testTimeoutChanged:false,
  aggregate:log.split(/\r?\n/).filter(v=>/^(Tests|Test Suites|Time):/.test(v)),logSha256:crypto.createHash('sha256').update(log).digest('hex')});
 console.log(JSON.stringify({originalJest:j.status===0?'PASS':'FAIL'}));
 for(let repeat=1;repeat<=3;repeat++)for(const objective of objectives){const p=cp.spawnSync(process.execPath,['-r',require.resolve('ts-node/register/transpile-only'),__filename,'--objective='+objective,'--repeat='+repeat],
  {cwd:path.resolve(__dirname,'..'),encoding:'utf8',timeout:30000,maxBuffer:1024*1024});if(p.status!==0)write(`native-failure-${repeat}-${objective}.json`,{status:'FAIL',exitCode:p.status,code:p.error?.code??null});}
 console.log(JSON.stringify({nativeProcesses:9,productionChanges:0}));
}
main().catch(()=>{console.error('REGRESSION_DIAGNOSTIC_FAILED; raw fields suppressed');process.exitCode=1;});
