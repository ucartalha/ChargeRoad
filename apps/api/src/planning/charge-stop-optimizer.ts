import {setImmediate as yieldLoop} from 'node:timers/promises';
import {ZodError} from 'zod';
import type {OptimizerSearch,PlanningResult} from '@chargeroad/shared';
import type {PlanningContext,OptimizerState,TransitionPort,OptimizerOutcome} from './optimizer-types';
import {PlanningDataLimit,PlanningProviderFailure} from './optimizer-types';
import {compilePlan} from './plan-compiler';
import {CATALOGUE_SCENARIO_POLICY as seedPolicy,candidateProgress} from './catalogue-station-scenario';

export function compareStates(a:OptimizerState,b:OptimizerState,objective:PlanningContext['request']['policy']['objective']){
  const key=(s:OptimizerState)=>objective==='minimum_charging_stops'?[s.stops.length,s.seconds,s.distance]:
    objective==='minimum_energy'?[Math.round(s.netKwh*1e8)/1e8,s.seconds,s.stops.length,s.distance]:[s.seconds,s.stops.length,s.distance];
  const x=key(a),y=key(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]-y[i];
  const ax=a.visited.join('|'),by=b.visited.join('|');return ax<by?-1:ax>by?1:0;
}
/** Application-owned search. All roads/weather/energy transitions cross a bounded session port. */
export class ChargeStopOptimizer {
  constructor(private readonly clock:()=>number=()=>performance.now()){}
  async solve(context:PlanningContext,port:TransitionPort,signal:AbortSignal):Promise<OptimizerOutcome>{
    const began=this.clock(),deadline=began+context.request.policy.maxComputationMilliseconds,options=context.options,objective=context.request.policy.objective;
    const initial:OptimizerState={nodeId:'origin',soc:context.request.startingChargePercent,temperature:context.request.initialBatteryTemperatureC,capacity:null,
      at:context.request.departureAt,legs:[],stops:[],visited:['origin'],netKwh:0,seconds:0,distance:0};
    const frontier=[initial],incumbent:{outcome:OptimizerOutcome|null;state:OptimizerState|null}={outcome:null,state:null};let expanded=0,transitions=0;
    let stopped:OptimizerSearch['stoppedReason']='frontier_exhausted';
    const failure=(status:Exclude<PlanningResult['status'],'planned'>,code:string):OptimizerOutcome=>({result:{status,requestId:context.request.requestId,reasons:[{code,explanation:code}]},search:metadata()});
    const metadata=():OptimizerSearch=>({policyId:options.id,policyVersion:options.version,objective,scope:'bounded_corridor_no_repeated_stations_sampled_soc',optimality:'not_proven',
      searchComplete:stopped==='frontier_exhausted'&&!port.issues.size&&!context.candidates.metadata.search.truncated&&context.candidates.metadata.coverage.completeForQuery,
      stoppedReason:stopped,expandedStates:expanded,evaluatedTransitions:transitions,...port.counters,elapsedMilliseconds:Math.max(0,this.clock()-began),
      skippedData:[...port.issues].sort(),socStepPercent:options.socStepPercent,drivingNetBatteryKwh:incumbent.state?.netKwh??0,scenarioDurationSeconds:incumbent.state?.seconds??1});
    const budget=async()=>{signal.throwIfAborted();if(this.clock()>=deadline||(port.remainingMilliseconds?.()??Infinity)<=0){stopped='deadline';throw new PlanningDataLimit('deadline');}
      if(transitions>=options.maxTransitions){stopped='transition_budget';throw new PlanningDataLimit('transition_budget');}transitions++;
      if(transitions%32===0){await yieldLoop();signal.throwIfAborted();}};
    if(initial.soc<context.request.constraints.minimumReserveChargePercent)return failure('insufficient_data','INITIAL_RESERVE_NOT_MET');
    try{
      // Obtain a fully evaluated incumbent before broad branching consumes provider budgets.
      // This is only a search seed, never a geometric shortcut or an optimum claim.
      if(options.maxStops>0&&context.request.policy.stationDataQuality==='catalogue_power_scenario'&&context.baseRoutes?.length){
        let fullBatteryProgress=seedPolicy.seedProgress;
        const append=(state:OptimizerState,leg:import('./optimizer-types').DriveLeg):OptimizerState=>{
          const row=leg.energy.segments.at(-1)!;
          return {...state,nodeId:leg.to,soc:row.endChargePercent,temperature:row.batteryTemperatureAtEndC,capacity:leg.energy.capacitySnapshot!,at:leg.arrivalAt,
            legs:[...state.legs,leg],visited:[...state.visited,leg.to],netKwh:state.netKwh+leg.energy.netBatteryEnergyKwh,
            seconds:(Date.parse(leg.arrivalAt)-Date.parse(context.request.departureAt))/1000,distance:state.distance+leg.route.distanceMeters};};
        // A direct trip must win over an unnecessary charging seed whenever it is feasible.
        await budget();for(const direct of await port.drive(initial,context.nodes.find(n=>n.id==='destination')!,false,signal)){
          if(direct.energy.status==='charge_required'){
            const rows=direct.energy.segments,firstUnsafe=rows.findIndex(r=>r.minimumChargePercent<context.request.constraints.minimumReserveChargePercent);
            const last=rows[(firstUnsafe<0?rows.length:firstUnsafe)-1],segment=direct.route.segments.find(s=>s.id===last?.segmentId);
            if(segment&&initial.soc>context.request.constraints.minimumReserveChargePercent)
              fullBatteryProgress=segment.endDistanceMeters/direct.route.distanceMeters/((initial.soc-context.request.constraints.minimumReserveChargePercent)/100);
          }
          if(direct.energy.status!=='estimated'||direct.energy.partialSegmentId)continue;
          const next=append(initial,direct);if(incumbent.state&&compareStates(next,incumbent.state,objective)>=0)continue;
          const previous=incumbent.state;incumbent.state=next;try{incumbent.outcome=compilePlan(context,next,metadata(),port);}
          catch(error){incumbent.state=previous;if(!(error instanceof ZodError))throw error;port.issues.add('FINAL_PLAN_CONTRACT_OR_ROAD_CONNECTION_INVALID');}
        }
        const seed=async(state:OptimizerState,progress:number):Promise<boolean>=>{
          if(incumbent.outcome)return true;
          if(state.stops.length){await budget();for(const tail of await port.drive(state,context.nodes.find(n=>n.id==='destination')!,false,signal)){
            if(tail.energy.status!=='estimated'||tail.energy.partialSegmentId)continue;
            const next=append(state,tail),previous=incumbent.state;incumbent.state=next;
            try{incumbent.outcome=compilePlan(context,next,metadata(),port);return true;}
            catch(error){incumbent.state=previous;if(!(error instanceof ZodError))throw error;port.issues.add('FINAL_PLAN_CONTRACT_OR_ROAD_CONNECTION_INVALID');}
          }}
          if(state.stops.length>=options.maxStops)return false;
          const target=progress+fullBatteryProgress*(state.soc-context.request.constraints.minimumReserveChargePercent)/100*seedPolicy.seedReachFraction;
          const seeds=context.candidates.candidates.filter(c=>!state.visited.includes(c.station.id)&&candidateProgress(c,context.baseRoutes!)>progress)
            .sort((a,b)=>Math.abs(candidateProgress(a,context.baseRoutes!)-target)-Math.abs(candidateProgress(b,context.baseRoutes!)-target)||a.station.id.localeCompare(b.station.id))
            .slice(0,seedPolicy.seedAttempts);
          for(const candidate of seeds){if(expanded>=options.maxStates){stopped='state_budget';return false;}
          await budget();const node=context.nodes.find(n=>n.id===candidate.station.id)!;expanded++;
          for(const leg of await port.drive(state,node,false,signal)){
            if(leg.energy.status!=='estimated'||leg.energy.partialSegmentId)continue;
            const atStation=append(state,leg);await budget();
            for(const charged of await port.charge(atStation,seedPolicy.seedTargetSoc,signal)){
              if(await seed(charged,candidateProgress(candidate,context.baseRoutes!)))return true;
            }
          }}return false;
        };
        if(!incumbent.outcome)await seed(initial,0);
      }
      while(frontier.length){
        signal.throwIfAborted();if(expanded>=options.maxStates){stopped='state_budget';break;}
        frontier.sort((a,b)=>compareStates(a,b,objective));const current=frontier.shift()!;expanded++;
        if(expanded%8===0)await yieldLoop();
        if(incumbent.state&&(objective==='minimum_total_duration'&&current.seconds>incumbent.state.seconds||objective==='minimum_charging_stops'&&current.stops.length>incumbent.state.stops.length))continue;
        const outgoing=context.nodes.filter(n=>n.id!==current.nodeId&&!current.visited.includes(n.id)).sort((a,b)=>a.id==='destination'?-1:b.id==='destination'?1:a.id<b.id?-1:1);
        const advance=async(departure:OptimizerState)=>{
          for(const target of outgoing){await budget();
            for(const leg of await port.drive(departure,target,false,signal)){
              if(leg.energy.status!=='estimated'||leg.energy.partialSegmentId||leg.energy.segments.length!==leg.route.segments.length)continue;
              const row=leg.energy.segments.at(-1)!;
              const next:OptimizerState={...departure,nodeId:target.id,soc:row.endChargePercent,temperature:row.batteryTemperatureAtEndC,
                capacity:leg.energy.capacitySnapshot!,at:leg.arrivalAt,legs:[...departure.legs,leg],visited:[...departure.visited,target.id],
                netKwh:departure.netKwh+leg.energy.netBatteryEnergyKwh,seconds:(Date.parse(leg.arrivalAt)-Date.parse(context.request.departureAt))/1000,
                distance:departure.distance+leg.route.distanceMeters};
              if(target.id==='destination'){
                if(!incumbent.state||compareStates(next,incumbent.state,objective)<0){
                  const previous=incumbent.state;incumbent.state=next;
                  try{const candidate=compilePlan(context,next,metadata(),port);incumbent.outcome=candidate;}
                  catch(error){incumbent.state=previous;if(!(error instanceof ZodError))throw error;port.issues.add('FINAL_PLAN_CONTRACT_OR_ROAD_CONNECTION_INVALID');}
                }
              }else {if(frontier.length>=options.maxFrontier){stopped='frontier_budget';throw new PlanningDataLimit('FRONTIER_BUDGET');}frontier.push(next);}
            }
          }
        };
        await advance(current);
        if(current.nodeId==='origin'||current.stops.length>=options.maxStops)continue;
        const points=new Set<number>();
        for(const curve of context.vehicle.dcChargingCurves)for(const point of curve.curve.points)points.add(point.socPercent);
        for(let soc=options.socStepPercent;soc<=100;soc+=options.socStepPercent)points.add(Math.min(100,soc));
        points.add(100);
        // Conservative access/arrival anchors from full-charge previews; every selected transition is re-evaluated at its actual scenario time/SOC.
        for(const target of outgoing){await budget();for(const leg of await port.drive(current,target,true,signal))if(leg.energy.status==='estimated'&&leg.energy.capacityKwh){
          const reserve=100-leg.energy.minimumChargePercent!+context.request.constraints.minimumReserveChargePercent;
          const arrival=100-leg.energy.finalChargePercent!+(target.id==='destination'?context.request.constraints.targetArrivalChargePercent:context.request.constraints.minimumReserveChargePercent);
          points.add(Math.ceil(Math.max(reserve,arrival)*100-1e-8)/100);
        }}
        for(const soc of [...points].filter(v=>v>current.soc+1e-7&&v<=100).sort((a,b)=>a-b)){
          await budget();for(const charged of await port.charge(current,soc,signal))await advance(charged);
        }
      }
    }catch(error){if(signal.aborted)throw signal.reason;
      if(error instanceof PlanningProviderFailure){port.issues.add(error.message);if(!incumbent.outcome)return {...failure('provider_error',error.message),retryAfterSeconds:error.retryAfterSeconds};stopped='data_budget';}
      else if(!(error instanceof PlanningDataLimit))throw error;
      if(stopped==='frontier_exhausted')stopped=error.message.includes('DEADLINE')?'deadline':'data_budget';port.issues.add(error.message);}
    if(incumbent.outcome&&incumbent.state){
      const search=metadata();const plan=incumbent.outcome.result.status==='planned'?incumbent.outcome.result.plan:null;
      if(plan){plan.search={...search,drivingNetBatteryKwh:incumbent.state.netKwh,scenarioDurationSeconds:incumbent.state.seconds};
        if(!search.searchComplete&&!plan.warnings.some(w=>w.code==='search_limited_best_validated_plan'))plan.warnings.push({code:'search_limited_best_validated_plan',explanation:'Best fully validated plan found within the reported search scope/budget.'});}
      return {...incumbent.outcome,search:plan?.search};
    }
    if(stopped!=='frontier_exhausted')return failure('computation_limit','NO_VALID_PLAN_WITHIN_'+stopped.toUpperCase());
    // A bounded corridor and sampled SOC graph cannot prove global physical infeasibility.
    const incomplete=failure('insufficient_data',port.issues.size?'PLANNING_DATA_INCOMPLETE':'NO_FEASIBLE_PLAN_IN_BOUNDED_SEARCH');
    // Only public, actionable codes are exposed; internal provider diagnostics stay in search metadata.
    const publicIssues=['PHYSICAL_DC_EVSE_DATA_MISSING','ROAD_TIME_OR_TRACE_EXCEEDS_SPEED_LIMIT','WEATHER_CORE_OR_FRESHNESS_MISSING'];
    const reasons=publicIssues.filter(code=>port.issues.has(code)).map(code=>({code,explanation:code}));
    if(reasons.length&&incomplete.result.status!=='planned')incomplete.result.reasons=reasons;
    return incomplete;
  }
}
