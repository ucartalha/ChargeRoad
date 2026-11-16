import {EvPlanningService} from '../ev-planning.service';
import {validateStateCase} from '../validation/state-dominance-validation';
import {objectives} from '../validation/frontier-performance-harness';

describe('State validator forwards the actual objective, not only its label',()=>{
 it.each(objectives)('%s reaches the planning port',async objective=>{
  const stop=new Error('OBJECTIVE_PORT_CAPTURE');
  const plan=jest.spyOn(EvPlanningService.prototype,'plan').mockRejectedValue(stop);
  try {
   await expect(validateStateCase('direct',objective)).rejects.toBe(stop);
   expect(plan).toHaveBeenCalledTimes(1);
   expect(plan.mock.calls[0][0].policy.objective).toBe(objective);
  } finally {plan.mockRestore();}
 });
 it('reports the first changed field without fixture values',async()=>{
  let calls=0;
  const plan=jest.spyOn(EvPlanningService.prototype,'plan').mockImplementation(async request=>({result:{status:'insufficient_data',requestId:request.requestId,
   reasons:[{code:++calls===1?'BEFORE':'AFTER',explanation:'synthetic'}]}}));
  try{await expect(validateStateCase('direct','minimum_energy')).rejects.toThrow('STATE_SHADOW_BEHAVIOR_CHANGED/direct/minimum_energy/after/outcome/result/reasons/0/code');}
  finally{plan.mockRestore();}
 });
});
