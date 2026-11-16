const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('crypto');
const {setTimeout:delay}=require('timers/promises'),{candidateClass}=require('./validation/weather-wait-candidate.cjs');
const {WeatherCacheStore}=require('../src/weather/weather-cache.ts'),{document}=require('../src/weather/__tests__/fixtures.ts');
const SqlFixture=require('./validation/weather-sql-model.cjs')(Date),Candidate=candidateClass();
const secret='synthetic-owner-proof-secret-at-least-32-characters',provider='synthetic',version='v1',url='https://example.invalid/forecast';
const key=crypto.createHmac('sha256',secret).update('weather-cache/v1\0'+provider+'\0'+version+'\0'+url).digest('hex');
async function run(Cache,kind){
 const db=new SqlFixture(),doc=document();let calls=0,enter,release;
 const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
 const cache=new Cache({pool:db},async()=>{calls++;enter();await gate;return doc;},secret),other=new Cache({pool:db},async()=>{throw Error('SECOND_OWNER_FORBIDDEN');},secret);
 const caller=new AbortController(),shared=new AbortController(),budget={used:0,limit:2};
 const get=(c,s,b)=>c.get(provider,version,url,s,b,()=>{});
 if(kind==='fresh-zero-budget-quota'){
  db.rows.set(key,{provider,doc,expires:Date.now()+60000,retry:0,generation:0,token:null});db.state(provider).used=1000;
  assert.deepEqual(await get(cache,shared.signal,{used:0,limit:0}),doc);assert.equal(calls,0);return {kind,calls,saved:true};
 }
 const first=get(cache,caller.signal,budget);const firstSettled=first.then(v=>({v}),e=>({e}));await entered;
 if(kind==='expired-owner-fenced'){
  const row=db.rows.get(key);row.token='replacement';row.generation++;release();const result=await firstSettled;
  assert.ok(result.e);assert.equal(db.rows.get(key).token,'replacement');assert.equal(db.state(provider).blockedUntil,0);
  return {kind,calls,fencing:true,foreignOwnerUnchanged:true};
 }
 const second=kind==='cross-instance-zero-budget'?get(other,shared.signal,{used:0,limit:0}):get(cache,shared.signal,{used:0,limit:2});
 const secondSettled=second.then(v=>({v}),e=>({e}));
 caller.abort(new Error('synthetic_cancel'));release();
 const [a,b]=await Promise.all([firstSettled,secondSettled]);
 assert.equal(a.e,caller.signal.reason);assert.deepEqual(b.v,doc);assert.equal(calls,1);assert.equal(budget.used,1);
 const end=performance.now()+2000;while(cache.pending.size&&performance.now()<end)await delay(5);
 assert.equal(cache.pending.size,0);assert.equal(other.pending.size,0);
 return {kind,calls,cancelIndependent:true,saved:true,pendingAfter:0};
}
async function main(){const rows=[];
 for(const kind of ['shared-caller-cancel','cross-instance-zero-budget','fresh-zero-budget-quota','expired-owner-fenced']){
  let before,after,status='PASS';try{before=await run(WeatherCacheStore,kind);after=await run(Candidate,kind);assert.deepEqual(before,after);}catch{status='FAIL';}
  rows.push({kind,status,before,after});
 }
 fs.writeFileSync(path.resolve(__dirname,'../../../docs/validation/cr-lat-002r-2026-11-16/weather-owner.json'),JSON.stringify({modelOnly:true,realPg:'NOT_RUN',rows,status:rows.every(r=>r.status==='PASS')?'PASS':'FAIL'},null,2),{flag:'wx'});
 console.log(rows.map(r=>({kind:r.kind,status:r.status})));if(rows.some(r=>r.status==='FAIL'))process.exitCode=1;
}
main().catch(()=>{console.error('OWNER_MODEL_FAILED');process.exitCode=1;});
