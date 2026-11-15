import {REPEAT_CASES,validateSessionRepeat} from '../validation/session-repeat-validation';
import {objectives} from '../validation/frontier-performance-harness';
describe('Read-only session audit vs production',()=>{
 const flag=process.env.PLANNING_METRICS_ENABLED;
 beforeAll(()=>{process.env.PLANNING_METRICS_ENABLED='false';jest.useFakeTimers({now:new Date('2026-11-15T09:00:00Z'),doNotFake:['performance','hrtime','nextTick','setImmediate','setTimeout','clearTimeout','setInterval','clearInterval']});});
 afterAll(()=>{jest.useRealTimers();if(flag===undefined)delete process.env.PLANNING_METRICS_ENABLED;else process.env.PLANNING_METRICS_ENABLED=flag;});
 it.each(objectives.flatMap(objective=>REPEAT_CASES.map(kind=>[objective,kind] as const)))('preserves outcomes/trace/001-004 counters: %s / %s',async(objective,kind)=>{
  const fetch=jest.spyOn(global,'fetch').mockRejectedValue(new Error('No external calls'));
  try{const row=await validateSessionRepeat(kind,objective);expect(row.equivalent).toBe(true);expect(row.savedPureComputations).toBe(0);expect(fetch).not.toHaveBeenCalled();}finally{fetch.mockRestore();}
 });
});
