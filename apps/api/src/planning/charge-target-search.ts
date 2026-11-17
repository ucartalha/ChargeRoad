import type {DriveLeg,OptimizerState,PlanningContext,TransitionPort} from './optimizer-types';

/** Search heuristics only. All proposed SOCs must cross the real session/engine port. */
export const CHARGE_TARGET_SEARCH_POLICY={version:'charge-target-search/1.0.0',maxCalls:32,maxPasses:2,maxTargetRounds:5,
  remainingBudgetFraction:.4,beamWidth:2} as const;

/** Optimizer 1.4.0: a charge returns one state per EVSE/connector. States that are numerically identical for every
 *  later drive (node, SOC, departure time, battery temperature, capacity) are collapsed to the first one. Ties already
 *  keep the first-found state, so with non-binding budgets the plan is unchanged; only redundant expansion disappears. */
export function distinctChargedStates(states:readonly OptimizerState[]):OptimizerState[]{
  const seen=new Set<string>(),out:OptimizerState[]=[];
  for(const s of states){const key=JSON.stringify([s.nodeId,s.soc,s.at,s.temperature,s.capacity]);if(!seen.has(key)){seen.add(key);out.push(s);}}
  return out;
}
export function appendDrivingState(state:OptimizerState,leg:DriveLeg,context:PlanningContext):OptimizerState|null{
  const e=leg.energy,row=e.segments.at(-1),reserve=context.request.constraints.minimumReserveChargePercent;
  if(e.status!=='estimated'||e.partialSegmentId||!e.capacitySnapshot||!row||e.segments.length!==leg.route.segments.length||
    e.segments.some(s=>s.minimumChargePercent<reserve-1e-8)||
    leg.to==='destination'&&row.endChargePercent<context.request.constraints.targetArrivalChargePercent-1e-8)return null;
  return {...state,nodeId:leg.to,soc:row.endChargePercent,temperature:row.batteryTemperatureAtEndC,capacity:e.capacitySnapshot,at:leg.arrivalAt,
    legs:[...state.legs,leg],visited:[...state.visited,leg.to],netKwh:state.netKwh+e.netBatteryEnergyKwh,
    seconds:(Date.parse(leg.arrivalAt)-Date.parse(context.request.departureAt))/1000,distance:state.distance+leg.route.distanceMeters};
}

/** Full candidate set is retained; anchors and taper knees precede the uniform grid. No 80% cap. */
export function chargeTargetCandidates(context:PlanningContext,soc:number,anchors:number[]=[]){
  const values:number[]=[],add=(n:number)=>{if(Number.isFinite(n)&&n>soc+1e-7&&n<=100&&!values.some(v=>Math.abs(v-n)<1e-7))values.push(n);};
  for(const n of [...anchors].sort((a,b)=>a-b)){add(Math.ceil(n*100-1e-8)/100);add(Math.ceil(n/context.options.socStepPercent)*context.options.socStepPercent);}
  add(80);
  for(const curve of context.vehicle.dcChargingCurves){const points=curve.curve.points;
    const power=(p:typeof points[number])=>'powerKw'in p?p.powerKw:p.currentA*p.voltageV/1000;
    for(let i=0;i<points.length-1;i++)if(power(points[i+1])<power(points[i])*.9)add(points[i].socPercent);
  }
  add(100);
  for(const curve of context.vehicle.dcChargingCurves)for(const point of curve.curve.points)add(point.socPercent);
  for(let n=context.options.socStepPercent;n<=100;n+=context.options.socStepPercent)add(Math.min(100,n));
  return values;
}

export function seedChargeTargets(context:PlanningContext,soc:number){
  const fast=Math.min(80,Math.max(0,...context.vehicle.dcChargingCurves.map(c=>c.curve.points.at(-1)!.socPercent)));
  const targets=context.request.policy.objective==='minimum_charging_stops'?[100,fast]:[fast,100];
  return [...new Set(targets)].filter(v=>v>soc+1e-7&&v<=100);
}

function stopArrival(context:PlanningContext,plan:OptimizerState,index:number):OptimizerState|null{
  const station=plan.stops[index].stop.stationId,legIndex=plan.legs.findIndex(l=>l.to===station),leg=plan.legs[legIndex],row=leg?.energy.segments.at(-1);
  if(!row||!leg.energy.capacitySnapshot)return null;
  const legs=plan.legs.slice(0,legIndex+1);
  return {nodeId:station,soc:row.endChargePercent,temperature:row.batteryTemperatureAtEndC,capacity:leg.energy.capacitySnapshot,at:leg.arrivalAt,
    legs,stops:plan.stops.slice(0,index),visited:['origin',...legs.map(l=>l.to)],netKwh:legs.reduce((n,l)=>n+l.energy.netBatteryEnergyKwh,0),
    seconds:(Date.parse(leg.arrivalAt)-Date.parse(context.request.departureAt))/1000,distance:legs.reduce((n,l)=>n+l.route.distanceMeters,0)};
}

/** A validated incumbent is kept outside this helper. No physical result is edited/reused as a new result. */
export async function improveFixedStopTargets(context:PlanningContext,baseline:OptimizerState,port:TransitionPort,signal:AbortSignal,
  compare:(a:OptimizerState,b:OptimizerState)=>number,budget:()=>Promise<void>,accept:(state:OptimizerState)=>boolean,clock:()=>number){
  const policy=CHARGE_TARGET_SEARCH_POLICY,weatherStart=port.counters.weatherQueries,
    weatherAllowance=Math.max(0,Math.floor((context.options.maxWeatherQueries-weatherStart)*policy.remainingBudgetFraction)),
    remaining=Math.min(context.request.policy.maxComputationMilliseconds,port.remainingMilliseconds?.()??Infinity),end=clock()+remaining*policy.remainingBudgetFraction;
  let calls=0,best=baseline;
  class PhaseLimit extends Error{}
  const guard=async(expectedQueries=0)=>{signal.throwIfAborted();
    if(calls>=policy.maxCalls||clock()>=end||port.counters.weatherQueries-weatherStart+expectedQueries>weatherAllowance)throw new PhaseLimit();
    await budget();calls++;};
  const replay=async(base:OptimizerState,index:number,target:number)=>{
    const arrival=stopArrival(context,base,index);if(!arrival)return [];
    let states=[arrival];
    for(let i=index;i<base.stops.length;i++){
      const charged:OptimizerState[]=[];
      for(const state of states){const wanted=i===index?target:base.stops[i].stop.targetChargePercent;
        if(state.soc>=wanted){charged.push(state);continue;}
        await guard(1);charged.push(...distinctChargedStates(await port.charge(state,wanted,signal)));}
      const nodeId=i+1<base.stops.length?base.stops[i+1].stop.stationId:'destination',node=context.nodes.find(n=>n.id===nodeId);
      if(!node)return [];
      const driven:OptimizerState[]=[],oldLeg=base.legs.find(l=>l.from===base.stops[i].stop.stationId&&l.to===nodeId);
      for(const state of charged.sort(compare).slice(0,policy.beamWidth)){
        await guard(oldLeg?.weather.length??1);
        for(const leg of await port.drive(state,node,false,signal)){const next=appendDrivingState(state,leg,context);if(next)driven.push(next);}
      }
      states=driven.sort(compare).slice(0,policy.beamWidth);if(!states.length)break;
    }
    return states;
  };
  try{for(let pass=0;pass<policy.maxPasses;pass++){
    let improved=false;
    // Round-robin across stops: do not spend the whole allowance on the final stop.
    for(let round=0;round<policy.maxTargetRounds;round++)for(let i=best.stops.length-1;i>=0;i--){
      const stop=best.stops[i].stop,leg=best.legs.find(l=>l.from===stop.stationId),arrival=stopArrival(context,best,i);
      if(!leg||!arrival)continue;
      const minimum=Math.min(...leg.energy.segments.map(s=>s.minimumChargePercent)),last=leg.energy.segments.at(-1)!;
      const required=leg.to==='destination'?context.request.constraints.targetArrivalChargePercent:context.request.constraints.minimumReserveChargePercent;
      // A proposal from the previous validated leg, not a monotonicity assumption or a certificate.
      const anchor=stop.targetChargePercent-Math.min(minimum-context.request.constraints.minimumReserveChargePercent,last.endChargePercent-required)+.05;
      const targets=chargeTargetCandidates(context,arrival.soc,[anchor]).filter(v=>Math.abs(v-stop.targetChargePercent)>.01),target=targets[round];
      if(target===undefined)continue;
      for(const candidate of await replay(best,i,target))if(compare(candidate,best)<-1e-7&&accept(candidate)){best=candidate;improved=true;}
    }
    if(!improved)break;
  }}catch(error){if(!(error instanceof PhaseLimit))throw error;}
  return best;
}
