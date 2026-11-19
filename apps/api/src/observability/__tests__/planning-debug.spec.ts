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
// Final plan summary (2026-11-19, user item D): the chosen plan itself, so a phone route can be read from one log line.
import {PlanningDebugTrace} from '../planning-debug';
describe('Planning debug final plan summary',()=>{
  const stop=(km:number,arrival:number,target:number,minutes:number,kwh:number,over:Record<string,unknown>={})=>({stationId:'s'+km,routeDistanceMeters:km*1000,
    detourDistanceMeters:1200,arrivalChargePercent:arrival,targetChargePercent:target,chargingDurationSeconds:minutes*60,connectionDurationSeconds:120,
    blockingPreconditioningSeconds:0,energyDeliveredAtInletKwh:kwh,waiting:{seconds:0},...over});
  const sample={vehicleVariantId:'v',algorithmVersion:'chargeroad-optimizer/1.9.0',roadRoute:{distanceMeters:500000},estimatedArrivalChargePercent:21.04,
    energySegments:[{modelVersion:'energy/x'}],chargingStops:[stop(180,12.34,80,30,50),stop(242,61,70,5,6,{detourDistanceMeters:null,waiting:{seconds:null}})],
    duration:{drivingSeconds:18000,chargingSeconds:2100,connectionSeconds:240,blockingPreconditioningSeconds:0,waitingSeconds:null,totalSeconds:null}};
  it('summarizes totals and every stop without coordinates, and names the phase that found the plan',()=>{
    const t=new PlanningDebugTrace({requestId:'r'} as never);
    (t as any).corridors.push({incumbents:[{atMs:1,minutes:400,stops:2,arrivalSoc:30,phase:'seed'},{atMs:2,minutes:390,stops:2,arrivalSoc:21,phase:'final_trim'}]});
    t.finalPlan(sample as never);
    expect(t.final).toEqual({optimizer:'chargeroad-optimizer/1.9.0',energyModel:'energy/x',routeKm:500,stops:2,arrivalSoc:21,
      minutes:{driving:300,charging:35,connection:4,preconditioning:0,waiting:null,total:339,rankedWithStopPenalty:351},sourcePhase:'final_trim',
      chargingStops:[{km:180,gapKm:180,arrivalSoc:12.3,targetSoc:80,chargeMinutes:30,avgKw:100,detourKm:1.2,waitMinutes:0},
        {km:242,gapKm:62,arrivalSoc:61,targetSoc:70,chargeMinutes:5,avgKw:72,detourKm:null,waitMinutes:null}],lastLegKm:258});
  });
  it('is part of the planning_debug line of a planned request',async()=>{
    await withEnv({PLANNING_DEBUG_TRACE:'true',NODE_ENV:'development'},async()=>{
      const {r,lines}=await plan();if(r.result.status!=='planned')throw new Error('fixture must plan');
      const f=JSON.parse(lines[0]).finalPlan;expect(f.stops).toBe(r.result.plan.chargingStops.length);expect(f.chargingStops).toHaveLength(f.stops);
      expect(f.routeKm).toBeCloseTo(r.result.plan.roadRoute.distanceMeters/1000,0);expect(typeof f.sourcePhase==='string'||f.sourcePhase===null).toBe(true);
    });
  });
});
