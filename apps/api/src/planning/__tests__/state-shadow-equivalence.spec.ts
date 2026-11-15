import {stateCases,validateStateCase} from '../validation/state-dominance-validation';
import {objectives} from '../validation/frontier-performance-harness';
describe('Current versioned algorithm with/without bounded state shadow',()=>{
 const flag=process.env.PLANNING_METRICS_ENABLED;
 beforeAll(()=>{process.env.PLANNING_METRICS_ENABLED='false';jest.useFakeTimers({now:new Date('2026-11-15T09:00:00Z'),doNotFake:['performance','hrtime','nextTick','setImmediate','setTimeout','clearTimeout','setInterval','clearInterval']});});
 afterAll(()=>{jest.useRealTimers();if(flag===undefined)delete process.env.PLANNING_METRICS_ENABLED;else process.env.PLANNING_METRICS_ENABLED=flag;});
 it.each(objectives.flatMap(objective=>stateCases.map(kind=>[objective,kind] as const)))('preserves plan/input/replay/trace/budgets/003 counters: %s / %s',async(objective,kind)=>{
  const fetch=jest.spyOn(global,'fetch').mockRejectedValue(new Error('No external provider'));
  try{const row=await validateStateCase(kind,objective);expect(row.equivalent).toBe(true);expect(row.shadow.actual_pruned_states).toBe(0);expect(fetch).not.toHaveBeenCalled();}finally{fetch.mockRestore();}
 });
});
