import {BoundedMemoryCache} from '../bounded-memory-cache';

// Process-wide memory layer (2026-11-20, user decision): avoids re-reading the same rows from PostgreSQL on every plan, keeps
// per-entry hit counters, drops entries that stay cold, and never exceeds a byte/entry budget.
describe('Bounded memory cache',()=>{
  let now=0;const clock=()=>now;
  const make=(o:Partial<ConstructorParameters<typeof BoundedMemoryCache>[0]>={})=>new BoundedMemoryCache<{v:number}>({maxBytes:100,maxEntries:10,coldWindowMs:1000,minHitsPerWindow:1,...o},clock);
  beforeEach(()=>{now=0;});
  it('returns a stored value until its expiry and counts hits and misses',()=>{
    const c=make();c.set('a',{v:1},10,500);
    expect(c.get('a')).toEqual({v:1});now=499;expect(c.get('a')).toEqual({v:1});now=500;expect(c.get('a')).toBeUndefined();
    expect(c.stats()).toMatchObject({hits:2,misses:1,entries:0,bytes:0,evictedExpired:1});
  });
  it('freezes stored values so callers cannot change a shared entry',()=>{
    const c=make(),value={v:1,nested:{w:2}};c.set('a',value as never,10,1000);
    expect(()=>{(c.get('a') as unknown as {nested:{w:number}}).nested.w=3;}).toThrow();
  });
  it('evicts the least recently used entries beyond the byte or entry budget',()=>{
    const c=make({maxBytes:30});c.set('a',{v:1},10,9e9);c.set('b',{v:2},10,9e9);c.set('c',{v:3},10,9e9);
    c.get('a');c.set('d',{v:4},10,9e9);
    expect(c.get('b')).toBeUndefined();expect(c.get('a')).toEqual({v:1});expect(c.stats()).toMatchObject({entries:3,bytes:30,evictedSize:1});
    const e=make({maxEntries:2});e.set('a',{v:1},1,9e9);e.set('b',{v:2},1,9e9);e.set('c',{v:3},1,9e9);expect(e.stats().entries).toBe(2);
  });
  it('does not keep values that are larger than the whole budget or already expired',()=>{
    const c=make();c.set('big',{v:1},101,9e9);c.set('old',{v:1},1,0);expect(c.stats().entries).toBe(0);
  });
  it('sweep drops expired entries and entries with too few hits in the last window (cold), resetting the window',()=>{
    const c=make({minHitsPerWindow:2});c.set('hot',{v:1},10,9e9);c.set('cold',{v:2},10,9e9);c.set('gone',{v:3},10,100);
    c.get('hot');c.get('hot');c.get('cold');
    now=500;expect(c.sweep()).toMatchObject({expired:1,cold:0});   // younger than one window: kept
    now=1000;expect(c.sweep()).toMatchObject({expired:0,cold:1});  // cold had 1 hit < 2
    expect(c.get('cold')).toBeUndefined();expect(c.get('hot')).toEqual({v:1});
    now=2000;expect(c.sweep()).toMatchObject({cold:1}); // window was reset at 1000: only the one hit above < 2
  });
});
