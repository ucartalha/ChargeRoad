import { corridorQuerySegments } from '../db-station.provider';
import type { RoadRoute } from '@chargeroad/shared';

// 2026-11-19: long routes over the station query point budget used to fail (STATION_PROVIDER_FAILED); they are now
// simplified until they fit, while routes within the budget keep their exact geometry.
const route=(points:number):RoadRoute=>({id:'r',segments:[{id:'s1',geometry:Array.from({length:points},(_,i)=>({latitude:40+i*1e-4,longitude:29+(i%2)*1e-6}))}]} as never);
describe('Station corridor query geometry',()=>{
  it('keeps exact geometry within the budget',()=>{
    const r=route(50),out=corridorQuerySegments([r],100);
    expect(out[0].geometry.coordinates).toEqual(r.segments[0].geometry.map(p=>[p.longitude,p.latitude]));expect(out[0].segmentId).toBe('s1');
  });
  it('simplifies a nearly straight shape above the budget instead of failing',()=>{
    const out=corridorQuerySegments([route(5000)],100);
    expect(out[0].geometry.coordinates.length).toBeLessThanOrEqual(100);expect(out[0].segmentId).toBe('s1');
    expect(out[0].geometry.coordinates[0]).toEqual([29,40]);
  });
  it('still refuses a shape that cannot fit even at the largest tolerance',()=>{
    const zigzag={id:'r',segments:[{id:'s1',geometry:Array.from({length:500},(_,i)=>({latitude:40+i*1e-2,longitude:29+(i%2)*1e-2}))}]} as never;
    expect(()=>corridorQuerySegments([zigzag],10)).toThrow('Station geometry budget exceeded');
  });
});
