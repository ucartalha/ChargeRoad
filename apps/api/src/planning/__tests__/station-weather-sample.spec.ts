import {PlanningSession} from '../planning-session';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {ChargingCurveEngine} from '../../charging/charging-engine';
import type {PlanningContext} from '../optimizer-types';
import {optimizerWorld} from './optimizer.fixtures';

// Optimizer 1.6.1: a station/charging weather query may reuse an already acquired forecast series only inside the
// weather service's own provenance bound (10 km without a sampling resolution). Snapping to a 10-15 km sample made the
// service answer outside_horizon, so the station could never charge (phone İstanbul→Kelkit, 2026-11-19).
function session(){
  const w=optimizerWorld();
  const context:PlanningContext={request:w.request,vehicle:w.vehicle,evaluatedAt:w.now,options:w.options,candidates:w.candidates,
    nodes:Object.entries(w.locations).map(([id,location])=>({id,location,stationId:['origin','destination'].includes(id)?null:id})),baseRoutes:[w.route('origin','destination')]};
  const s=new PlanningSession(context,w.roads as never,w.weather as never,new EnergyConsumptionEngine(),new ChargingCurveEngine(),w.preparation.road,performance.now()+60000,context.baseRoutes);
  return {s:s as unknown as {climateSamples:Map<string,{latitude:number;longitude:number}>;weather:(q:unknown[],signal:AbortSignal)=>Promise<unknown[]>},w};
}
const station={latitude:39.9,longitude:32.8};
const north=(km:number)=>({latitude:station.latitude+km/111.2,longitude:station.longitude});
const query=()=>({id:'charge-weather-x',segmentId:'station:a',location:station,validAt:new Date(Date.now()+3600000).toISOString()});
describe('Station weather sample reuse bound (optimizer 1.6.1)',()=>{
  it('reuses a series sampled within 10 km',async()=>{
    const {s,w}=session();s.climateSamples.set('near',north(5));
    await s.weather([query()],new AbortController().signal);
    const sent=(w.weather.forecast as jest.Mock).mock.calls.at(-1)[0][0];
    expect(sent.sampleLocation).toEqual(north(5));
  });
  it('queries the station itself when the nearest sample is 10-15 km away',async()=>{
    const {s,w}=session();s.climateSamples.set('gap',north(12));
    await s.weather([query()],new AbortController().signal);
    const sent=(w.weather.forecast as jest.Mock).mock.calls.at(-1)[0][0];
    expect(sent.sampleLocation).toBeUndefined();expect(sent.location).toEqual(station);
  });
});
