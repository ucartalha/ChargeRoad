import {planningEvaluationSchema} from '@chargeroad/shared';
import {ARRIVAL_TARGET_FALLBACK,arrivalTargetSteps} from '../optimizer-policy';
import {optimizerWorld} from './optimizer.fixtures';

// User rule (2026-11-17): if no route reaches the requested arrival SOC, plan for the highest arrival target that works
// (in ARRIVAL_TARGET_FALLBACK.stepPercent steps, never below the reserve) and say so on the plan.
// Synthetic world: the last station (b) is 0.75 km before the destination at 50 %/km, so at most 62.5 % arrival.
describe('Arrival target fallback (optimizer 1.6.0)',()=>{
  it('steps down from the requested target to the reserve',()=>{
    expect(arrivalTargetSteps(80,10)).toEqual([80,75,70,65,60,55,50,45,40,35,30,25,20,15,10]);
    expect(arrivalTargetSteps(78,20)).toEqual([78,75,70,65,60,55,50,45,40,35,30,25,20]);
    expect(arrivalTargetSteps(12,10)).toEqual([12,10]);
    expect(arrivalTargetSteps(10,10)).toEqual([10]);
  });
  it('lowers an unreachable arrival target in steps and marks the plan',async()=>{
    const w=optimizerWorld();w.request.constraints={minimumReserveChargePercent:10,targetArrivalChargePercent:80};
    const r=await w.service.plan(w.request,w.preparation,w.options);
    expect(r.result.status).toBe('planned');if(r.result.status!=='planned')throw new Error(JSON.stringify(r.result));
    const plan=r.result.plan;
    expect(ARRIVAL_TARGET_FALLBACK.stepPercent).toBe(5);
    expect(plan.targetArrivalChargePercent).toBe(60);expect(plan.estimatedArrivalChargePercent).toBeGreaterThanOrEqual(60);
    expect(plan.minimumReserveChargePercent).toBe(10);
    const warning=plan.warnings.find(x=>x.code==='arrival_target_lowered');
    expect(warning?.explanation).toContain('80');
    // The evaluation checks the plan against the original request: a lower target is valid only with the warning.
    expect(r.validationInput!.request.constraints.targetArrivalChargePercent).toBe(80);
    expect(()=>planningEvaluationSchema.parse({input:r.validationInput,result:r.result})).not.toThrow();
    const tampered=structuredClone(r.result);tampered.plan.warnings=tampered.plan.warnings.filter(x=>x.code!=='arrival_target_lowered');
    expect(()=>planningEvaluationSchema.parse({input:r.validationInput,result:tampered})).toThrow();
  },60000);
  it('keeps a reachable arrival target unchanged and unmarked',async()=>{
    const w=optimizerWorld();w.request.constraints={minimumReserveChargePercent:10,targetArrivalChargePercent:60};
    const r=await w.service.plan(w.request,w.preparation,w.options);
    expect(r.result.status).toBe('planned');if(r.result.status!=='planned')return;
    expect(r.result.plan.targetArrivalChargePercent).toBe(60);
    expect(r.result.plan.warnings.some(x=>x.code==='arrival_target_lowered')).toBe(false);
  },60000);
});
