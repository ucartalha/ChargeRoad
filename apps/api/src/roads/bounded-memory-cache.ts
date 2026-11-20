/**
 * Process-wide memory layer in front of a shared PostgreSQL cache (2026-11-20, user decision: many concurrent users must not
 * turn every plan into hundreds of PG reads). Values are deep-frozen and shared read-only. Each entry keeps its own expiry
 * (never longer than the PG row), a hit counter and a window start:
 *  - expired entries are dropped on read and on sweep;
 *  - an entry older than one window with fewer than minHitsPerWindow hits in that window is cold and dropped on sweep;
 *  - beyond maxBytes/maxEntries the least recently used entries are dropped.
 * Only aggregate statistics leave this class; keys and values are never logged.
 */
export interface BoundedMemoryCacheOptions {maxBytes:number;maxEntries:number;coldWindowMs:number;minHitsPerWindow:number;}
type Entry<V>={value:V;bytes:number;expiresAt:number;windowStart:number;windowHits:number};
function deepFreeze<T>(value:T):T{
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))deepFreeze(child);Object.freeze(value);}
  return value;
}
export class BoundedMemoryCache<V> {
  private readonly entries=new Map<string,Entry<V>>();private bytes=0;
  private readonly counters={hits:0,misses:0,evictedExpired:0,evictedCold:0,evictedSize:0};
  constructor(readonly options:BoundedMemoryCacheOptions,private readonly clock:()=>number=()=>Date.now()){}
  get(key:string):V|undefined{
    const entry=this.entries.get(key);if(!entry){this.counters.misses++;return undefined;}
    if(entry.expiresAt<=this.clock()){this.remove(key,entry);this.counters.evictedExpired++;this.counters.misses++;return undefined;}
    // Map order is recency order: move to the end.
    this.entries.delete(key);this.entries.set(key,entry);entry.windowHits++;this.counters.hits++;return entry.value;
  }
  set(key:string,value:V,bytes:number,expiresAt:number){
    const now=this.clock();if(!(expiresAt>now)||!(bytes>=0)||bytes>this.options.maxBytes)return;
    const old=this.entries.get(key);if(old)this.remove(key,old);
    this.entries.set(key,{value:deepFreeze(value),bytes,expiresAt,windowStart:now,windowHits:0});this.bytes+=bytes;
    while(this.bytes>this.options.maxBytes||this.entries.size>this.options.maxEntries){
      const [oldest,entry]=this.entries.entries().next().value as [string,Entry<V>];this.remove(oldest,entry);this.counters.evictedSize++;}
  }
  /** Drops expired and cold entries; an evaluated (kept) entry starts a new window. */
  sweep(){
    const now=this.clock();let expired=0,cold=0;
    for(const [key,entry] of [...this.entries]){
      if(entry.expiresAt<=now){this.remove(key,entry);expired++;continue;}
      if(now-entry.windowStart<this.options.coldWindowMs)continue;
      if(entry.windowHits<this.options.minHitsPerWindow){this.remove(key,entry);cold++;continue;}
      entry.windowStart=now;entry.windowHits=0;
    }
    this.counters.evictedExpired+=expired;this.counters.evictedCold+=cold;
    return {expired,cold,...this.stats()};
  }
  stats(){return {...this.counters,entries:this.entries.size,bytes:this.bytes};}
  private remove(key:string,entry:Entry<V>){this.entries.delete(key);this.bytes-=entry.bytes;}
}
