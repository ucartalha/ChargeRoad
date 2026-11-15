import {eligibilityCases} from '../validation/eligibility-fixtures';
import {validateEligibilityCase} from '../validation/eligibility-validation';
import {objectives} from '../validation/frontier-performance-harness';
describe('Before/new shadow-only eligibility: plan/replay/trace/budget equivalence',()=>{
 const flag=process.env.PLANNING_METRICS_ENABLED;
 beforeAll(()=>{process.env.PLANNING_METRICS_ENABLED='false';jest.useFakeTimers({now:new Date('2026-11-15T09:00:00Z'),doNotFake:['performance','hrtime','nextTick','setImmediate','setTimeout','clearTimeout','setInterval','clearInterval']});});
 afterAll(()=>{jest.useRealTimers();if(flag===undefined)delete process.env.PLANNING_METRICS_ENABLED;else process.env.PLANNING_METRICS_ENABLED=flag;});
 it.each(objectives.flatMap(objective=>eligibilityCases.map(kind=>[objective,kind] as const)))('preserves %s / %s',async(objective,kind)=>{
  const fetch=jest.spyOn(global,'fetch').mockRejectedValue(new Error('No external provider'));
  try{const row=await validateEligibilityCase(kind,objective);expect(row.equivalent).toBe(true);expect(row.actualAvoidedProviderCalls).toBe(0);expect(fetch).not.toHaveBeenCalled();}
  finally{fetch.mockRestore();}
 });
});
