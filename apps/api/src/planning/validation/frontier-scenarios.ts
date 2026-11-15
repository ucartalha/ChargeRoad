// Synthetic acceptance only. Never log raw states, user observations or replay payloads.
import {createHash} from 'node:crypto';
import {optimizerWorld} from '../__tests__/optimizer.fixtures';
import {ChargeStopOptimizer} from '../charge-stop-optimizer';
import {EvPlanningService} from '../ev-planning.service';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {ChargingCurveEngine} from '../../charging/charging-engine';
import type {PlanningContext,TransitionPort} from '../optimizer-types';

export const frontierObjectives=['minimum_total_duration','minimum_charging_stops','minimum_energy'] as const;
export const frontierCases=['complete','equal_priority','frontier_limit','state_limit','transition_limit','road_limit','weather_limit','deadline','cancel_before','cancel_during'] as const;
export function frontierHash(value:unknown){return createHash('sha256').update(JSON.stringify(value,(key,v)=>key==='elapsedMilliseconds'?undefined:v)).digest('hex');}
export async function frontierScenario(objective:typeof frontierObjectives[number],kind:typeof frontierCases[number]){
 const w=optimizerWorld(false),abort=new AbortController(),trace:unknown[]=[];let ticks=0;
 const roads:{routes:(...args:Parameters<typeof w.roads.routes>)=>ReturnType<typeof w.roads.routes>}={routes:w.roads.routes};
 w.request.policy.objective=objective;
 if(kind==='frontier_limit')w.options.maxFrontier=1;
 if(kind==='state_limit')w.options.maxStates=1;
 if(kind==='transition_limit')w.options.maxTransitions=1;
 if(kind==='road_limit')w.options.maxRoadQueries=1;
 if(kind==='weather_limit')w.options.maxWeatherQueries=1;
 if(kind==='cancel_before')abort.abort(new Error('synthetic_cancel'));
 if(kind==='equal_priority'){
  const original=w.roads.routes;w.preparation.road.alternatives=2;
  roads.routes=async request=>{const response=await original(request);return {...response,data:{...response.data,routes:response.data.routes.flatMap(r=>[r,{...structuredClone(r),id:r.id+'-twin'}])}};};
 }
 class ObservedOptimizer extends ChargeStopOptimizer {
  override solve(context:PlanningContext,port:TransitionPort,signal:AbortSignal){return super.solve(context,{
   issues:port.issues,counters:port.counters,remainingMilliseconds:()=>port.remainingMilliseconds?.()??Infinity,
   drive:async(state,to,preview,s)=>{trace.push(['drive',state,to.id,preview]);if(kind==='cancel_during')abort.abort(new Error('synthetic_cancel'));return port.drive(state,to,preview,s);},
   charge:async(state,target,s)=>{trace.push(['charge',state,target]);return port.charge(state,target,s);},
  },signal);}
 }
 const optimizer=new ObservedOptimizer(()=>kind==='deadline'&&++ticks>3?1e9:0);
 const service=new EvPlanningService(w.vehicles as never,roads as never,w.stations as never,w.weather as never,new EnergyConsumptionEngine(),new ChargingCurveEngine(),optimizer);
 const fixtureChecksum=frontierHash({request:w.request,vehicle:w.vehicle,options:w.options,preparation:w.preparation,candidates:w.candidates});
 try{const outcome=await service.plan(w.request,w.preparation,w.options,abort.signal);
  return {id:objective+'/'+kind,fixtureChecksum,resultChecksum:frontierHash(outcome),traceChecksum:frontierHash(trace),status:outcome.result.status,
   search:outcome.search?JSON.parse(JSON.stringify(outcome.search,(key,v)=>key==='elapsedMilliseconds'?undefined:v)):null};
 }catch(error){if(!abort.signal.aborted||error!==abort.signal.reason)throw error;return {id:objective+'/'+kind,fixtureChecksum,resultChecksum:frontierHash({error:'synthetic_cancel'}),traceChecksum:frontierHash(trace),status:'cancelled',search:null};}
}
