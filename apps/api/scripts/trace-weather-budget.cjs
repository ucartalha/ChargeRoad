const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const {WeatherCacheStore}=require('../src/weather/weather-cache.ts');
async function main(){let selects=0,locks=0,fetches=0,sqlCalls=0;
 const query=async(sql)=>{sqlCalls++;if(sql.includes('c.document')){selects++;return {rows:[]};}if(sql.includes('FOR UPDATE')){locks++;return {rows:[{today:true,used:0,blocked:false,paced:false}]};}return {rows:[],rowCount:0};};
 const db={pool:{query,connect:async()=>({query,release(){}})}},cache=new WeatherCacheStore(db,async()=>{fetches++;throw Error('UNEXPECTED_FETCH');},'synthetic-key-budget-diagnostic-secret');
 const budget={used:0,limit:0},kinds=[];
 for(let i=0;i<5;i++)try{await cache.get('synthetic','1','https://example.invalid/same-series',new AbortController().signal,budget,()=>{});}catch(e){kinds.push(e.kind);}
 assert.equal(fetches,0);assert.equal(cache.counters.misses,5);assert.ok(kinds.every(k=>k==='budget_exhausted'));
 const source=fs.readFileSync(path.resolve(__dirname,'../src/weather/weather-cache.ts'));
 const result={generatedAt:new Date().toISOString(),status:'PASS',sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),
  mode:'Stage A negative fixture, actual Cache.get/claim budget guard; synthetic SQL boundary, no PG mutation',repeatedGets:5,distinctSeriesKey:1,
  counters:cache.counters,cacheSelectIntents:selects,providerLockIntents:locks,fixtureSqlCalls:sqlCalls,realHttpCalls:0,failureKinds:kinds,
  inference:'PG miss counter increments once per acquire, not once per retry or distinct global key. Exhausted per-job budget may repeat misses across calls without HTTP. Not proof this caused all historical misses.'};
 fs.writeFileSync(path.resolve(__dirname,'../../../docs/validation/cr-lat-002-2026-11-16/budget-tree.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:'PASS',gets:5,misses:5,distinctSeriesKey:1,http:0}));}
main().catch(()=>{console.error('BUDGET_TRACE_FAILED (raw fields suppressed)');process.exitCode=1;});
