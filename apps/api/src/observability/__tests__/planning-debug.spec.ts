import {Logger} from '@nestjs/common';
import {planningDebugEnabled} from '../planning-debug';
import {optimizerWorld} from '../../planning/__tests__/optimizer.fixtures';

// Development-only planning trace (2026-11-19, user request): one `planning_debug` line per plan that shows where the search
// spent its budget and why candidates failed. Off by default, never in production, no coordinates. See docs/DEV_DIAGNOSTICS.md.
const withEnv=async(env:Record<string,string|undefined>,run:()=>Promise<void>)=>{
  const before=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));
  for(const [k,v] of Object.entries(env))if(v===undefined)delete process.env[k];else process.env[k]=v;
  try{await run();}finally{for(const [k,v] of Object.entries(before))if(v===undefined)delete process.env[k];else process.env[k]=v;}
};
async function plan(){
  const lines:string[]=[],spy=jest.spyOn(Logger.prototype,'log').mockImplementation(function(this:Logger,message:unknown){if(typeof message==='string'&&message.includes('"planning_debug"'))lines.push(message);});
  try{const w=optimizerWorld();const r=await w.service.plan(w.request,w.preparation,w.options);return {r,lines};}finally{spy.mockRestore();}
}
describe('Planning debug trace',()=>{
  it('is off unless PLANNING_DEBUG_TRACE=true, and always off in production',async()=>{
    await withEnv({PLANNING_DEBUG_TRACE:undefined,NODE_ENV:'development'},async()=>{expect(planningDebugEnabled()).toBe(false);expect((await plan()).lines).toEqual([]);});
    await withEnv({PLANNING_DEBUG_TRACE:'true',NODE_ENV:'production'},async()=>{expect(planningDebugEnabled()).toBe(false);expect((await plan()).lines).toEqual([]);});
  });
  it('logs one line per plan with corridors, phases, drives and incumbents but no coordinates',async()=>{
    await withEnv({PLANNING_DEBUG_TRACE:'true',NODE_ENV:'development'},async()=>{
      const {r,lines}=await plan();expect(r.result.status).toBe('planned');expect(lines).toHaveLength(1);
      expect(lines[0]).not.toMatch(/latitude|longitude/);
      const t=JSON.parse(lines[0]);
      expect(t).toMatchObject({event:'planning_debug',devOnly:true,outcome:'planned'});
      expect(t.request).toMatchObject({startingChargePercent:expect.any(Number),reserve:expect.any(Number),arrivalTarget:expect.any(Number),objective:expect.any(String)});
      const c=t.corridors[0];
      expect(c).toMatchObject({routeKm:expect.any(Number),maxStops:expect.any(Number),outcome:'planned',weather:{used:expect.any(Number)}});
      expect(Array.isArray(c.candidatesKm)).toBe(true);
      expect(c.drives.count).toBeGreaterThan(0);expect(Object.keys(c.drives.byStatus).length).toBeGreaterThan(0);
      expect(c.incumbents.length).toBeGreaterThan(0);expect(c.incumbents[0]).toMatchObject({minutes:expect.any(Number),stops:expect.any(Number)});
      expect(Object.keys(c.phases).length).toBeGreaterThan(0);
    });
  });
  it('does not change the plan',async()=>{
    let off:unknown,on:unknown;
    await withEnv({PLANNING_DEBUG_TRACE:undefined},async()=>{off=(await plan()).r.result;});
    await withEnv({PLANNING_DEBUG_TRACE:'true',NODE_ENV:'development'},async()=>{on=(await plan()).r.result;});
    // Two fixture worlds are built milliseconds apart: wall-clock timestamps and ids differ, everything else must be identical.
    const strip=(x:any)=>JSON.parse(JSON.stringify(x,(k,v)=>['planId','requestId','elapsedMilliseconds'].includes(k)?undefined:typeof v==='string'&&/^\d{4}-\d\d-\d\dT/.test(v)?'<time>':typeof v==='string'&&/^([a-z]+-)?[a-f0-9]{24,64}$/.test(v)?'<hash>':v));
    expect(strip(on)).toEqual(strip(off));
  });
});
