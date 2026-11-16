import {WeatherUnavailable} from './weather-ports';
import type {ForecastSeries} from './weather-ports';
import {WEATHER_POLICY} from './weather-policy';

export type WeatherExecutionMode='legacy'|'atlas'|'atlas_adaptive';
export function weatherExecutionMode(value=process.env.WEATHER_EXECUTION_MODE):WeatherExecutionMode {
  return value==='atlas'||value==='atlas_adaptive'?value:'legacy';
}
export interface WeatherSeriesEntry {series:ForecastSeries;expiresAt:number;}
function freeze<T>(value:T):T {
  if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;
}
function waitFor<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
  signal.throwIfAborted();return new Promise((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason);};signal.addEventListener('abort',abort,{once:true});
    work.then(v=>{signal.removeEventListener('abort',abort);resolve(v);},e=>{signal.removeEventListener('abort',abort);reject(e);});
  });
}
/** Job-local L1 of validated immutable series. PostgreSQL remains authoritative L2. */
export class WeatherAtlas {
  private readonly entries=new Map<string,{work:Promise<WeatherSeriesEntry>;value?:WeatherSeriesEntry;bytes:number}>();
  private readonly lifetime=new AbortController();private bytes=0;private disposed=false;
  readonly counters={loads:0,hits:0,joins:0,evictions:0};
  constructor(private readonly deadline:number,private readonly capacity=128,private readonly byteLimit=8*1024*1024){
    if(!Number.isSafeInteger(capacity)||capacity<1||!Number.isSafeInteger(byteLimit)||byteLimit<1)throw new Error('Invalid atlas bound');
  }
  get size(){return this.entries.size;}
  get retainedBytes(){return this.bytes;}
  private remove(key:string){const entry=this.entries.get(key);if(entry){this.bytes-=entry.bytes;this.entries.delete(key);}}
  async resolve(key:string,caller:AbortSignal,load:(signal:AbortSignal)=>Promise<WeatherSeriesEntry>):Promise<ForecastSeries>{
    caller.throwIfAborted();if(this.disposed)throw new WeatherUnavailable('provider_unavailable','Weather atlas disposed');
    const remaining=this.deadline-performance.now();if(remaining<=0)throw new WeatherUnavailable('provider_unavailable','Weather atlas deadline');
    let entry=this.entries.get(key);
    if(entry?.value){const now=Date.now(),age=now-Date.parse(entry.value.series.sourceUpdatedAt);
      if(!Number.isFinite(entry.value.expiresAt)||!Number.isFinite(age)||entry.value.expiresAt<=now||age<0||age>WEATHER_POLICY.maxAgeSeconds*1000){this.remove(key);entry=undefined;}
    }
    if(entry){entry.value?this.counters.hits++:this.counters.joins++;this.entries.delete(key);this.entries.set(key,entry);}
    else{
      while(this.entries.size>=this.capacity){const victim=[...this.entries].find(([,v])=>v.value);if(!victim)throw new WeatherUnavailable('budget_exhausted','Weather atlas pending bound');this.remove(victim[0]);this.counters.evictions++;}
      this.counters.loads++;
      const signal=AbortSignal.any([this.lifetime.signal,AbortSignal.timeout(Math.max(1,Math.ceil(Math.min(remaining,WEATHER_POLICY.deadlineMs))))]);
      const created:{work:Promise<WeatherSeriesEntry>;value?:WeatherSeriesEntry;bytes:number}={work:Promise.resolve().then(()=>{signal.throwIfAborted();return load(signal);}),bytes:0};
      this.entries.set(key,created);entry=created;
      created.work=created.work.then(value=>{
        const immutable={...value,series:freeze(structuredClone(value.series))},bytes=Buffer.byteLength(JSON.stringify(immutable.series));
        if(this.entries.get(key)===created&&!this.disposed){
          while(this.bytes+bytes>this.byteLimit){const victim=[...this.entries].find(([k,v])=>k!==key&&v.value);if(!victim)break;this.remove(victim[0]);this.counters.evictions++;}
          if(bytes<=this.byteLimit&&this.bytes+bytes<=this.byteLimit){created.value=immutable;created.bytes=bytes;this.bytes+=bytes;}else this.remove(key);
        }
        return immutable;
      }).catch(error=>{if(this.entries.get(key)===created)this.remove(key);throw error;});
    }
    return (await waitFor(entry.work,caller)).series;
  }
  dispose(){this.disposed=true;this.entries.clear();this.bytes=0;this.lifetime.abort(new Error('Weather atlas disposed'));}
}
