import {WeatherAtlas,weatherExecutionMode} from '../weather-atlas';
import {MetNorwayAdapter} from '../met-norway.adapter';
import {config,document} from './fixtures';
const entry=()=>{
 const doc=document(),now=Date.now(),body=doc.body as any;
 doc.fetchedAt=doc.validatedAt=new Date(now).toISOString();body.properties.meta.updated_at=doc.fetchedAt;
 body.properties.timeseries.forEach((row:any,i:number)=>{row.time=new Date(now+(i===2?7:i)*3600000).toISOString();});
 return {series:new MetNorwayAdapter(config).parse(doc),expiresAt:now+60000};
};
describe('Job-local bounded WeatherAtlas',()=>{
 it('defaults invalid/missing configuration to legacy',()=>{expect(weatherExecutionMode('wrong')).toBe('legacy');expect(weatherExecutionMode('')).toBe('legacy');expect(weatherExecutionMode('atlas')).toBe('atlas');expect(weatherExecutionMode('atlas_adaptive')).toBe('atlas_adaptive');});
 it('joins concurrent loads, isolates caller cancellation, releases all references',async()=>{
  const atlas=new WeatherAtlas(performance.now()+10000),a=new AbortController(),b=new AbortController();let release!:(v:ReturnType<typeof entry>)=>void;
  const load=jest.fn(()=>new Promise<ReturnType<typeof entry>>(r=>{release=r;}));
  const first=atlas.resolve('key',a.signal,load);const rejected=expect(first).rejects.toBe('cancel');
  const second=atlas.resolve('key',b.signal,load);await Promise.resolve();a.abort('cancel');release(entry());await rejected;
  expect(await second).toBeDefined();expect(load).toHaveBeenCalledTimes(1);expect(atlas.counters.joins).toBe(1);
  atlas.dispose();expect(atlas.size).toBe(0);expect(atlas.retainedBytes).toBe(0);await expect(atlas.resolve('key',b.signal,load)).rejects.toThrow('disposed');
 });
 it('retries rejected loads and cannot exceed pending bound',async()=>{
  const atlas=new WeatherAtlas(performance.now()+10000,1),signal=new AbortController().signal;
  await expect(atlas.resolve('k',signal,async()=>{throw Error('fixture');})).rejects.toThrow('fixture');expect(atlas.size).toBe(0);
  const pending=atlas.resolve('k',signal,async()=>entry());await expect(atlas.resolve('other',signal,async()=>entry())).rejects.toThrow('pending bound');await pending;atlas.dispose();
 });
 it('evicts fulfilled entries by count/bytes and freezes series without freezing loader objects',async()=>{
  const atlas=new WeatherAtlas(performance.now()+10000,1),signal=new AbortController().signal,x=entry();
  x.series.sourceUpdatedAt=new Date().toISOString();const value=await atlas.resolve('a',signal,async()=>x);
  expect(Object.isFrozen(value.points)).toBe(true);expect(Object.isFrozen(x.series.points)).toBe(false);
  await atlas.resolve('b',signal,async()=>x);expect(atlas.size).toBe(1);expect(atlas.counters.evictions).toBe(1);atlas.dispose();
  const tiny=new WeatherAtlas(performance.now()+10000,1,1);await tiny.resolve('x',signal,async()=>x);expect(tiny.size).toBe(0);tiny.dispose();
 });
 it.each(['expiry','source_age'])('does not reuse an invalid %s representation',async invalid=>{
  const atlas=new WeatherAtlas(performance.now()+10000),signal=new AbortController().signal;
  const load=jest.fn(async()=>{const value=entry();if(invalid==='expiry')value.expiresAt=Date.now()-1;else value.series.sourceUpdatedAt=new Date(Date.now()-13*3600000).toISOString();return value;});
  await atlas.resolve('a',signal,load);await atlas.resolve('a',signal,load);expect(load).toHaveBeenCalledTimes(2);atlas.dispose();
 });
 it('reuses fresh immutable series, but checks the job deadline before a cache hit',async()=>{
  const atlas=new WeatherAtlas(performance.now()+10000),signal=new AbortController().signal;
  const load=jest.fn(async()=>{const value=entry();value.series.sourceUpdatedAt=new Date().toISOString();return value;});
  const a=await atlas.resolve('k',signal,load),b=await atlas.resolve('k',signal,load);expect(a).toBe(b);expect(load).toHaveBeenCalledTimes(1);atlas.dispose();
  const expired=new WeatherAtlas(performance.now()-1);await expect(expired.resolve('k',signal,load)).rejects.toThrow('deadline');expired.dispose();
 });
 it('different URL/product version keys cannot collide and jobs do not share L1',async()=>{
  const a=new WeatherAtlas(performance.now()+10000),b=new WeatherAtlas(performance.now()+10000),signal=new AbortController().signal,load=jest.fn(async()=>entry());
  await a.resolve('["p","v1","url"]',signal,load);await a.resolve('["p","v2","url"]',signal,load);await b.resolve('["p","v1","url"]',signal,load);expect(load).toHaveBeenCalledTimes(3);a.dispose();b.dispose();
 });
});
