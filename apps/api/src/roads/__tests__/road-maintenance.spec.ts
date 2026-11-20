import {cleanupRoadCache,ROAD_CACHE_CLEANUP_POLICY} from '../road-maintenance';

// Road cache cleanup (2026-11-20): expired rows were never deleted (local DB: 52 434 rows / 904 MB, 464 still valid).
// Expired, unleased rows are deleted in bounded batches so a sweep never holds a long lock.
const fakePool=(available:number)=>{const calls:{sql:string;params:unknown[]}[]=[];let left=available;
  return {calls,pool:{query:async(sql:string,params:unknown[])=>{calls.push({sql,params});const n=Math.min(left,params[0] as number);left-=n;return {rowCount:n};}}};};
describe('Road cache cleanup',()=>{
  it('policy: every 15 minutes, 5 000-row batches, at most 20 batches per sweep',()=>{
    expect(ROAD_CACHE_CLEANUP_POLICY).toMatchObject({intervalMs:15*60*1000,batchRows:5000,maxBatchesPerSweep:20});
  });
  it('deletes only expired rows that no request is filling, batch by batch until a short batch',async()=>{
    const {calls,pool}=fakePool(12000);
    expect(await cleanupRoadCache(pool)).toBe(12000);expect(calls).toHaveLength(3);
    for(const c of calls){expect(c.params).toEqual([5000]);expect(c.sql).toMatch(/expires_at<=now\(\)/);expect(c.sql).toMatch(/token IS NULL OR lease_until IS NULL OR lease_until<=now\(\)/);
      expect(c.sql).toMatch(/LIMIT \$1/);}
  });
  it('stops after the batch cap so one sweep stays short',async()=>{
    const {calls,pool}=fakePool(1_000_000);
    expect(await cleanupRoadCache(pool)).toBe(100000);expect(calls).toHaveLength(ROAD_CACHE_CLEANUP_POLICY.maxBatchesPerSweep);
  });
});
