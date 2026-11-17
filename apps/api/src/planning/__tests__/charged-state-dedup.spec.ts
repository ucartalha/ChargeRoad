import {ChargeStopOptimizer,distinctChargedStates} from '../charge-stop-optimizer';
import {PlanningSession} from '../planning-session';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {ChargingCurveEngine} from '../../charging/charging-engine';
import type {PlanningContext,OptimizerState} from '../optimizer-types';
import {optimizerWorld} from './optimizer.fixtures';

// Optimizer 1.4.0: a charge returns one state per EVSE/connector. When those states are numerically identical for
// every later drive (same node, SOC, departure time, battery temperature, capacity) only the first is expanded.
const base=(over:Partial<OptimizerState>):OptimizerState=>({nodeId:'a',soc:80,temperature:{origin:'unknown',value:null},capacity:null,at:'2026-11-17T12:00:00Z',
  legs:[],stops:[],visited:['origin','a'],netKwh:1,seconds:600,distance:500,...over});

describe('Identical charged states',()=>{
  it('keeps the first of each numerically identical group and preserves order',()=>{
    const first=base({stops:[{stop:{evseId:'e1'}} as never]}),copy=base({stops:[{stop:{evseId:'e2'}} as never]}),
      other=base({soc:85,stops:[{stop:{evseId:'e3'}} as never]}),later=base({at:'2026-11-17T12:05:00Z',stops:[{stop:{evseId:'e4'}} as never]});
    expect(distinctChargedStates([first,copy,other,later])).toEqual([first,other,later]);
    expect(distinctChargedStates([])).toEqual([]);
  });
  it('treats different temperature or capacity as different states',()=>{
    const a=base({}),warm=base({temperature:{origin:'estimated',value:30} as never}),cap=base({capacity:{effectiveKwh:70} as never});
    expect(distinctChargedStates([a,warm,cap])).toHaveLength(3);
  });

  const timers=['hrtime','nextTick','performance','queueMicrotask','requestAnimationFrame','cancelAnimationFrame','requestIdleCallback','cancelIdleCallback',
    'setImmediate','clearImmediate','setInterval','clearInterval','setTimeout','clearTimeout'] as const;
  afterEach(()=>jest.useRealTimers());
  async function solve(evseCopies:number){
    jest.useFakeTimers({now:Date.parse('2026-11-17T09:00:00Z'),doNotFake:[...timers]});
    const w=optimizerWorld();
    for(const c of w.candidates.candidates){const evse=c.station.evses[0];
      c.station.evses=Array.from({length:evseCopies},(_,i)=>({...structuredClone(evse),id:i?evse.id+'-copy-'+i:evse.id}));}
    const context:PlanningContext={request:w.request,vehicle:w.vehicle,evaluatedAt:w.now,options:w.options,candidates:w.candidates,
      nodes:Object.entries(w.locations).map(([id,location])=>({id,location,stationId:['origin','destination'].includes(id)?null:id})),baseRoutes:[w.route('origin','destination')]};
    const session=new PlanningSession(context,w.roads as never,w.weather as never,new EnergyConsumptionEngine(),new ChargingCurveEngine(),w.preparation.road,performance.now()+60000,context.baseRoutes);
    let drives=0;const drive=session.drive.bind(session);session.drive=(...args:Parameters<typeof drive>)=>{if(!args[2])drives++;return drive(...args);};
    const outcome=await new ChargeStopOptimizer(()=>0).solve(context,session,new AbortController().signal);
    // The station snapshot checksum legitimately differs (the candidate really has more EVSEs); everything else must match.
    return {outcome:JSON.parse(JSON.stringify(outcome.result,(k,v)=>k==='elapsedMilliseconds'||k==='dataSnapshotChecksums'?undefined:v)),search:outcome.search,drives};
  }
  it('gives the same plan and the same search effort with three identical EVSEs as with one',async()=>{
    const one=await solve(1),three=await solve(3);
    expect(one.outcome.status).toBe('planned');
    expect(three.outcome).toStrictEqual(one.outcome);
    expect(three.drives).toBe(one.drives);
    expect(three.search?.evaluatedTransitions).toBe(one.search?.evaluatedTransitions);
  });
});
