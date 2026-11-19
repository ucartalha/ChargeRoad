import {PlanningSession,ROAD_ENDPOINT_POLICY} from '../planning-session';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {ChargingCurveEngine} from '../../charging/charging-engine';
import type {PlanningContext} from '../optimizer-types';
import {optimizerWorld} from './optimizer.fixtures';

// Optimizer 1.7.1 (B6, 2026-11-19): a catalogue station coordinate can sit inside a service-area lot, ~100 m from the
// road Valhalla snaps to (station 3ffb3120: 100.0 m). The old 100 m endpoint check rejected every leg to it. Station
// nodes now accept up to ROAD_ENDPOINT_POLICY.stationMeters and the gap is reported; origin/destination stay at 100 m.
const north=(meters:number)=>meters/111195;
function session(shift:{node:string;end:'start'|'end';meters:number}){
  const w=optimizerWorld();
  const context:PlanningContext={request:w.request,vehicle:w.vehicle,evaluatedAt:w.now,options:w.options,candidates:w.candidates,
    nodes:Object.entries(w.locations).map(([id,location])=>({id,location,stationId:['origin','destination'].includes(id)?null:id})),baseRoutes:[w.route('origin','destination')]};
  const original=w.roads.routes;
  const roads={routes:async(...args:Parameters<typeof original>)=>{const r=await original(...args);const [request]=args as unknown as [{origin:unknown;destination:unknown}];
    const node=context.nodes.find(n=>n.id===shift.node)!;const touches=shift.end==='end'?request.destination===node.location:request.origin===node.location;
    if(touches)for(const route of r.data.routes){const g=shift.end==='end'?route.segments.at(-1)!.geometry:route.segments[0].geometry;
      const p=shift.end==='end'?g.length-1:0;g[p]={...g[p],latitude:g[p].latitude+north(shift.meters)};}
    return r;}};
  const s=new PlanningSession(context,{...w.roads,...roads} as never,w.weather as never,new EnergyConsumptionEngine(),new ChargingCurveEngine(),w.preparation.road,performance.now()+60000,context.baseRoutes);
  const route=(from:string,to:string)=>(s as unknown as {route:(f:string,t:unknown,at:string,sig:AbortSignal)=>Promise<unknown>}).route(from,context.nodes.find(n=>n.id===to)!,w.request.departureAt,new AbortController().signal);
  return {route,issues:(s as unknown as {issues:Set<string>}).issues};
}
describe('Station endpoint tolerance (B6)',()=>{
  it('keeps 100 m for trip endpoints and allows a bounded gap for stations',()=>{
    expect(ROAD_ENDPOINT_POLICY).toMatchObject({tripMeters:100});expect(ROAD_ENDPOINT_POLICY.stationMeters).toBeGreaterThan(100);
    expect(ROAD_ENDPOINT_POLICY.stationMeters).toBeLessThanOrEqual(300);
  });
  it('accepts a leg that ends 150 m from a station coordinate and reports the gap',async()=>{
    const {route,issues}=session({node:'a',end:'end',meters:150});
    expect(await route('origin','a')).not.toBeNull();
    expect(issues.has('ROAD_SOURCE_OR_ENDPOINT_INVALID')).toBe(false);expect(issues.has('station_road_endpoint_gap')).toBe(true);
  });
  it('accepts a leg that starts 150 m from a station coordinate',async()=>{
    const {route}=session({node:'a',end:'start',meters:150});expect(await route('a','destination')).not.toBeNull();
  });
  it('still rejects a station gap above the tolerance',async()=>{
    const {route,issues}=session({node:'a',end:'end',meters:ROAD_ENDPOINT_POLICY.stationMeters+50});
    expect(await route('origin','a')).toBeNull();expect(issues.has('ROAD_SOURCE_OR_ENDPOINT_INVALID')).toBe(true);
  });
  it('still rejects 150 m at the trip origin or destination',async()=>{
    expect(await session({node:'origin',end:'start',meters:150}).route('origin','a')).toBeNull();
    expect(await session({node:'destination',end:'end',meters:150}).route('a','destination')).toBeNull();
  });
});
