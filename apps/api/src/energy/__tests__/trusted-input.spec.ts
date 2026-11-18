import {EnergyConsumptionEngine} from '../energy-engine';
import {optimizerWorld} from '../../planning/__tests__/optimizer.fixtures';

// Search-time evaluations assemble already-validated parts (request, vehicle profile, road, normalized weather).
// Skipping the composite re-parse must not change any result: capture every real session input and compare.
describe('Energy trusted search input',()=>{
  it('returns deep-equal results with and without the composite request parse for every session evaluation',async()=>{
    const captured:unknown[]=[],original=EnergyConsumptionEngine.prototype.evaluate;
    const spy=jest.spyOn(EnergyConsumptionEngine.prototype,'evaluate').mockImplementation(function(this:EnergyConsumptionEngine,raw:unknown,signal:AbortSignal,options?:never){
      captured.push(structuredClone(raw));return original.call(this,raw,signal,options as never);} as never);
    try{const w=optimizerWorld();const r=await w.service.plan(w.request,w.preparation,w.options);expect(r.result.status).toBe('planned');}
    finally{spy.mockRestore();}
    expect(captured.length).toBeGreaterThan(5);
    const engine=new EnergyConsumptionEngine(()=>0);
    for(const raw of captured){
      const parsed=await engine.evaluate(structuredClone(raw),new AbortController().signal,{inputChecksum:false});
      const trusted=await engine.evaluate(structuredClone(raw),new AbortController().signal,{inputChecksum:false,trustedComponents:true});
      expect(trusted).toStrictEqual(parsed);
    }
  },60000);
  it('still validates when the batch exceeds the schema weather bound',async()=>{
    const engine=new EnergyConsumptionEngine(()=>0);
    await expect(engine.evaluate({weather:new Array(10001).fill({})} as never,new AbortController().signal,{inputChecksum:false,trustedComponents:true})).rejects.toThrow();
  });
});
