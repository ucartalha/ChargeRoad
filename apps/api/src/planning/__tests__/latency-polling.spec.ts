import {latencyPilotPollHint} from '../validation/latency-poll-pilot';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
function pair(ready:number,kind='normal'){
 // Keep the virtual clock and dynamic client compiler outside Jest's VM/timer context.
 const filename=resolve(__dirname,'../../../scripts/benchmark-polling-latency.cjs');
 const script=`const {scenario}=require(${JSON.stringify(filename)});(async()=>{const a=await scenario(false,${ready},${JSON.stringify(kind)}),b=await scenario(true,${ready},${JSON.stringify(kind)});console.log(JSON.stringify({a,b}));})().catch(()=>{process.exitCode=1;});`;
 const child=spawnSync(process.execPath,['-e',script],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
 if(child.status!==0)throw new Error('BOUNDED_POLL_SEMANTIC_CHILD_FAILED (raw data suppressed)');
 return JSON.parse(child.stdout);
}
describe('CR-LAT-001 offline polling hypothesis; production default unchanged',()=>{
 it('is off by default and cannot enable in production or outside bounded active-job age',()=>{
  expect(latencyPilotPollHint('queued',0)).toBe(5000);
  expect(latencyPilotPollHint('queued',0,true,'production')).toBe(5000);
  for(const age of [-1,NaN,Infinity,10000,60000])expect(latencyPilotPollHint('running',age,true,'development')).toBe(5000);
  for(const status of ['completed','failed','cancelled'])expect(latencyPilotPollHint(status,100,true,'development')).toBe(5000);
  expect(latencyPilotPollHint('queued',0,true,'development')).toBe(2000);expect(latencyPilotPollHint('running',9999,true,'development')).toBe(2000);
 });
 it.each(['quota','unavailable','network','expired','owner','failed','cancelled','malformed','mismatched_result','abort'])('preserves actual mobile client protocol/error behavior: %s',async kind=>{
  const {a,b}=pair(500,kind);
  expect(a.error).toEqual(b.error);expect(a.outcomeHash).toBe(b.outcomeHash);expect(a.resultGets).toBe(b.resultGets);
  if(kind==='quota')expect(a.error).toMatchObject({status:429,retryAfterSeconds:60});
  if(kind==='owner'||kind==='expired')expect(a.error.status).toBe(404);
  if(kind==='unavailable')expect(a.error.status).toBe(503);
 });
 it('honors server hint and reduces only response delivery for an early ready job',async()=>{
  const {a,b}=pair(500);expect(a.outcomeHash).toBe(b.outcomeHash);
  // Long-poll client (2026-11-19): the first status read is sent at once with ?waitMs. This synthetic server ignores waitMs
  // (like an old API), so the client reads once immediately and once after the server's hint: 2 reads, hint gap unchanged.
  expect(a.readyToObservedMs-b.readyToObservedMs).toBe(3000);expect(a.statusGets).toBe(2);expect(b.statusGets).toBe(2);
  expect(b.visiblePaint).toBe('NOT_RUN');
 });
 it('exposes additional status reads and does not claim a long-job latency improvement',async()=>{
  const {a,b}=pair(60000);expect(b.outcomeHash).toBe(a.outcomeHash);
  expect(b.statusGets).toBeGreaterThan(a.statusGets);expect(b.finalResponseAcceptedAt).toBeGreaterThanOrEqual(a.finalResponseAcceptedAt);
 });
});
