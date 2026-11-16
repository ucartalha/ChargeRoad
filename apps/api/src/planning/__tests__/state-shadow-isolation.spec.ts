import {objectives} from '../validation/frontier-performance-harness';
const {runIsolated}=require('../../../scripts/validation/state-isolated-runner.cjs');
describe('State shadow heavy functional integration (separate from historical 5000ms gate)',()=>{
 it.each(objectives)('owns clock/fetch and closes child before teardown: %s',async objective=>{
  const row=await runIsolated(objective);
  expect(row.closed).toBe(true);expect(row.exitCode).toBe(0);
  expect(row.result.equivalent).toBe(true);
  expect(row.result.actualObjectives).toEqual([objective,objective,objective]);
  expect(new Set(row.result.phaseInputHashes).size).toBe(1);
  expect(row.result.shadow.actual_pruned_states).toBe(0);
  expect(row.externalCalls).toBe(0);
 // 30s child kill watchdog + 5s cleanup allowance, NOT a replacement 5s performance gate.
 },35000);
});
