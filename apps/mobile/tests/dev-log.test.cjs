// Development-only mobile logs: silent outside __DEV__, primitives only, numbers rounded.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {devLog,devPayload,devLogEnabled}=require('../src/dev/dev-log.ts');
test('silent unless __DEV__ is true',()=>{
 const calls=[],orig=console.info;console.info=(...a)=>calls.push(a);
 try{delete globalThis.__DEV__;assert.equal(devLogEnabled(),false);devLog('x',{a:1});
  globalThis.__DEV__=false;devLog('x',{a:1});assert.equal(calls.length,0);
  globalThis.__DEV__=true;devLog('x',{a:1.234});assert.deepEqual(calls,[['[dev] x',{a:1.2}]]);}
 finally{console.info=orig;delete globalThis.__DEV__;}
});
test('payload keeps primitives only (no nested objects such as coordinates)',()=>{
 assert.deepEqual(devPayload({ms:12.345,ok:true,s:'planned',n:null,bad:NaN,loc:{latitude:1,longitude:2},list:[1]}),{ms:12.3,ok:true,s:'planned',n:null,bad:null});
});
