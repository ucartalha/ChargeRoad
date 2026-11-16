/** Explicit opt-in setup only. Returns the original promise; no test/fixture/solver patch. */
const fs=require('fs'),path=require('path'),{monitorEventLoopDelay,PerformanceObserver}=require('perf_hooks');
const RealDate=Date,out=path.resolve(__dirname,'../../../../docs/validation/cr-lat-002-2026-11-16');
const validation=require('../../src/planning/validation/state-dominance-validation'),original=validation.validateStateCase,rows=[];
const spy=jest.spyOn(validation,'validateStateCase').mockImplementation((...args)=>{
 const row={caseNumber:rows.length+1,kind:args[0],objective:args[1],status:'pending',samples:[]};rows.push(row);
 const lag=monitorEventLoopDelay({resolution:10});lag.enable();const gc=[],obs=new PerformanceObserver(list=>{for(const e of list.getEntries())gc.push({duration:e.duration,start:e.startTime});});obs.observe({entryTypes:['gc']});
 const start=performance.now(),cpu=process.cpuUsage(),p=original(...args);
 const sample=()=>{const used=process.cpuUsage(cpu);row.samples.push({elapsedMs:performance.now()-start,pendingValidations:rows.filter(v=>v.status==='pending').length,
  cpuUserMs:used.user/1000,cpuSystemMs:used.system/1000,eventLoopMaxMs:lag.max/1e6,resources:process.getActiveResourcesInfo()});};
 const timer=setTimeout(sample,5000),ticker=setInterval(sample,500);ticker.unref();
 const end=(status,code)=>{clearTimeout(timer);clearInterval(ticker);sample();lag.disable();obs.disconnect();row.status=status;row.code=code;row.wallMs=performance.now()-start;row.gc=gc;
  fs.writeFileSync(path.join(out,`promise-completion-${row.caseNumber}.json`),JSON.stringify({generatedAt:new RealDate().toISOString(),scope:'opt-in observer overhead; not acceptance timing',...row},null,2)+'\n',{flag:'wx'});};
 p.then(()=>end('resolved'),e=>end('rejected',/^[A-Z_]+(?:\/[a-z_]+)*$/.test(e.message)?e.message:'ERROR_SUPPRESSED'));return p;
});
afterAll(()=>{spy.mockRestore();fs.writeFileSync(path.join(out,'promise-at-suite-end.json'),JSON.stringify({generatedAt:new RealDate().toISOString(),
 scope:'Jest suite ended; pending original promises may still unwind. No production worker or DB in this fixture.',rows},null,2)+'\n',{flag:'wx'});});
