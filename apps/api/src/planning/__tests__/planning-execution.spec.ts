import {PlanningExecution} from '../http/planning-execution';
import {PlanningAdmissionStore} from '../http/planning-admission.store';
const signal=new AbortController().signal;
function setup(budgetMs=1000){const store={acquire:jest.fn().mockResolvedValue({slot:1,token:'test-token'}),renew:jest.fn().mockResolvedValue(true),release:jest.fn().mockResolvedValue(undefined)};
  return {store,gate:new PlanningExecution(store as PlanningAdmissionStore,{budgetMs,localConcurrency:1})};}
const tick=()=>new Promise<void>(r=>setImmediate(r));
describe('Bounded planning execution and cleanup',()=>{
  it('rejects local overload before touching the shared database',async()=>{
    const {store,gate}=setup();let finish!:(value:string)=>void;const first=gate.run(()=>new Promise<string>(r=>finish=r),signal);await tick();
    await expect(gate.run(async()=>'second',signal)).rejects.toMatchObject({status:503});expect(store.acquire).toHaveBeenCalledTimes(1);
    finish('done');expect(await first).toBe('done');await tick();expect(store.release).toHaveBeenCalledTimes(1);
  });
  it('recovers admission after shared capacity or database failure',async()=>{
    const {store,gate}=setup();store.acquire.mockResolvedValueOnce(null);await expect(gate.run(async()=>'x',signal)).rejects.toMatchObject({status:503});
    store.acquire.mockRejectedValueOnce(new Error('DB down'));await expect(gate.run(async()=>'x',signal)).rejects.toMatchObject({status:503});
    expect(await gate.run(async()=>'available',signal)).toBe('available');await tick();
  });
  it('reserves outer deadline headroom so the solver can return its validated incumbent',async()=>{
    const {gate}=setup();let received=0;const result=await gate.run(async(_signal,budget)=>{received=budget;return 'validated incumbent';},signal);
    expect(result).toBe('validated incumbent');expect(received).toBeLessThan(1000);expect(received).toBeGreaterThan(0);await tick();
  });
  it('does not release admission for work that ignores its abort signal until it actually settles',async()=>{
    const {store,gate}=setup(100);let finish!:(value:string)=>void;
    const result=gate.run(()=>new Promise<string>(r=>finish=r),signal);await expect(result).rejects.toMatchObject({status:503});
    expect(store.release).not.toHaveBeenCalled();await expect(gate.run(async()=>'too early',signal)).rejects.toMatchObject({status:503});
    finish('late');await tick();expect(store.release).toHaveBeenCalledTimes(1);expect(await gate.run(async()=>'next',signal)).toBe('next');await tick();
  });
  it('aborts execution when its lease is lost rather than running with an expired owner',async()=>{
    jest.useFakeTimers();try{const {store,gate}=setup(20000);store.renew.mockResolvedValue(false);
      const work=gate.run(s=>new Promise((_resolve,reject)=>s.addEventListener('abort',()=>reject(s.reason),{once:true})),signal);
      const expectation=expect(work).rejects.toMatchObject({status:503});await jest.advanceTimersByTimeAsync(5001);await expectation;
      expect(store.release).toHaveBeenCalledTimes(1);
    }finally{jest.useRealTimers();}
  });
  it('bounds an admission adapter that ignores abort and releases a late-acquired slot',async()=>{
    const {store,gate}=setup(100);let acquire!:(value:{slot:number;token:string})=>void;
    store.acquire.mockImplementationOnce(()=>new Promise(r=>acquire=r));const run=jest.fn().mockResolvedValue('must not run');
    await expect(gate.run(run,signal)).rejects.toMatchObject({status:503});expect(run).not.toHaveBeenCalled();
    acquire({slot:1,token:'late'});await tick();expect(store.release).toHaveBeenCalledWith({slot:1,token:'late'});
    expect(await gate.run(async()=>'recovered',signal)).toBe('recovered');await tick();
  });
  it('ignores a late renewal result after work has completed and released ownership',async()=>{
    jest.useFakeTimers();try{
      const {store,gate}=setup(20000);let renew!:(ok:boolean)=>void,finish!:(value:string)=>void;
      store.renew.mockImplementationOnce(()=>new Promise(r=>renew=r));const work=gate.run(()=>new Promise<string>(r=>finish=r),signal);
      await jest.advanceTimersByTimeAsync(5001);finish('ready');await expect(work).resolves.toBe('ready');renew(false);await jest.advanceTimersByTimeAsync(0);
      expect(store.release).toHaveBeenCalledTimes(1);
    }finally{jest.useRealTimers();}
  });
});
