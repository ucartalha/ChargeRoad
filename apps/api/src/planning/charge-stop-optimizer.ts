import {setImmediate as yieldLoop} from 'node:timers/promises';
import {ZodError} from 'zod';
import type {OptimizerSearch,PlanningResult} from '@chargeroad/shared';
import type {PlanningContext,OptimizerState,TransitionPort,OptimizerOutcome} from './optimizer-types';
import {PlanningDataLimit,PlanningProviderFailure} from './optimizer-types';
import {compilePlan} from './plan-compiler';
import {CATALOGUE_SCENARIO_POLICY as seedPolicy,candidateProgress} from './catalogue-station-scenario';
import {maxMetric} from '../observability/planning-metrics';
import {createStateShadow} from './state-dominance-shadow';
import {chargeTargetCandidates,seedChargeTargets,improveFixedStopTargets,distinctChargedStates,stopArrival,appendDrivingState} from './charge-target-search';
import {SOC_STOP_RULES,SEED_TRIM_POLICY,BROAD_SEARCH_POLICY,STOP_LIMIT_POLICY,STOP_PENALTY_POLICY,STOP_ELIMINATION_POLICY,seedingAllowed,reachPrefilterKm,eliminationTargets} from './optimizer-policy';

/** True when no planned stop is reached at or above the no-charge SOC (SOC_STOP_RULES). */
export function respectsStopRules(state:OptimizerState,noChargeAtOrAbove:number=SOC_STOP_RULES.noChargeAtOrAboveArrivalPercent){
  return state.stops.every(s=>s.stop.arrivalChargePercent<noChargeAtOrAbove);
}

export function compareStates(a:OptimizerState,b:OptimizerState,objective:PlanningContext['request']['policy']['objective']){
  // Optimizer 1.9.0 (user decision): shortest-time plans whose penalized times differ by less than tieSeconds are ranked by
  // stop count first (fewer wins). Not transitive across chains of near-ties; every use compares concrete plans/states.
  if(objective==='minimum_total_duration'&&a.stops.length!==b.stops.length){
    const pa=a.seconds+a.stops.length*STOP_PENALTY_POLICY.secondsPerStop,pb=b.seconds+b.stops.length*STOP_PENALTY_POLICY.secondsPerStop;
    if(Math.abs(pa-pb)<STOP_PENALTY_POLICY.tieSeconds)return a.stops.length-b.stops.length;
  }
  const key=(s:OptimizerState)=>objective==='minimum_charging_stops'?[s.stops.length,s.seconds,s.distance]:
    objective==='minimum_energy'?[Math.round(s.netKwh*1e8)/1e8,s.seconds,s.stops.length,s.distance]:
    // Optimizer 1.9.0 P1: shortest-time plans are ranked with STOP_PENALTY_POLICY per stop (displayed times stay physical).
    [s.seconds+s.stops.length*STOP_PENALTY_POLICY.secondsPerStop,s.stops.length,s.distance];
  const x=key(a),y=key(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]-y[i];
  const ax=a.visited.join('|'),by=b.visited.join('|');return ax<by?-1:ax>by?1:0;
}
export {distinctChargedStates};
/** Seed fallback (optimizer 1.3.0): after every range-hint seed attempt from a state depleted the battery, try untried
 *  stations inside the reach those failed legs actually showed, farthest first. Ordering only; every transition is still
 *  fully evaluated, nothing is certified or pruned. */
export function seedFallbackCandidates<C extends {station:{id:string}}>(ranked:readonly C[],tried:ReadonlySet<string>,reachProgress:number,
  progressOf:(candidate:C)=>number,limit:number):C[]{
  if(!Number.isFinite(reachProgress))return [];
  return ranked.filter(c=>!tried.has(c.station.id)&&progressOf(c)<=reachProgress)
    .sort((a,b)=>progressOf(b)-progressOf(a)||a.station.id.localeCompare(b.station.id)).slice(0,limit);
}
/** Application-owned search. All roads/weather/energy transitions cross a bounded session port. */
export class ChargeStopOptimizer {
  constructor(private readonly clock:()=>number=()=>performance.now()){}
  /** Searches under SOC_STOP_RULES first. Only when that finds no plan and the rule actually blocked a charge, the search
   *  is repeated once without the rule (same deadline) and the plan says so: a plan must exist whenever one is possible. */
  async solve(context:PlanningContext,port:TransitionPort,signal:AbortSignal):Promise<OptimizerOutcome>{
    const began=this.clock(),trace={stopRuleBlocked:false};
    const strict=await this.search(context,port,signal,false,began,trace);
    if(strict.result.status==='planned'||!trace.stopRuleBlocked||strict.result.status==='provider_error')return strict;
    // Optimizer 1.9.0 P2: the relaxed search (charging allowed at >= 50 % arrival only because no strict plan exists) gets its own
    // road/weather budgets; before, the strict search had exhausted them and the relaxed one could not run.
    port.resetSearchBudgets?.();
    const relaxed=await this.search(context,port,signal,true,began,{stopRuleBlocked:false});
    if(relaxed.result.status!=='planned')return strict;
    relaxed.result.plan.warnings.push({code:'soc_stop_rule_relaxed',explanation:'No plan exists without a charging stop reached at or above '+
      SOC_STOP_RULES.noChargeAtOrAboveArrivalPercent+' %; this plan relaxes that comfort rule.'});
    return relaxed;
  }
  private async search(context:PlanningContext,port:TransitionPort,signal:AbortSignal,relaxStopRules:boolean,began:number,trace:{stopRuleBlocked:boolean}):Promise<OptimizerOutcome>{
    const deadline=began+context.request.policy.maxComputationMilliseconds,options=context.options,objective=context.request.policy.objective;
    const noChargeAbove=relaxStopRules?Infinity:SOC_STOP_RULES.noChargeAtOrAboveArrivalPercent;
    const blocked=()=>{trace.stopRuleBlocked=true;};
    port.debug?.enterPhase(relaxStopRules?'relaxed_seed':'seed',port.counters.weatherQueries);
    // Optimizer 1.9.0 P4: legs whose corridor distance exceeds the generous REACH_PREFILTER_POLICY bound are not driven.
    const routeKm=(context.baseRoutes?.[0]?.distanceMeters??0)/1000,reserveSoc=context.request.constraints.minimumReserveChargePercent;
    const progressOfNode=(id:string)=>{if(id==='origin')return 0;if(id==='destination')return 1;
      const c=context.candidates?.candidates.find(x=>x.station.id===id);return c&&context.baseRoutes?.length?candidateProgress(c,context.baseRoutes):null;};
    const unreachable=(fromId:string,soc:number,toId:string)=>{if(!routeKm)return false;const a=progressOfNode(fromId),b=progressOfNode(toId);if(a===null||b===null)return false;
      const skip=(b-a)*routeKm>reachPrefilterKm(context.weatherSampling?.rangeKm,soc,reserveSoc);if(skip)port.debug?.skippedUnreachable();return skip;};
    const initial:OptimizerState={nodeId:'origin',soc:context.request.startingChargePercent,temperature:context.request.initialBatteryTemperatureC,capacity:null,
      at:context.request.departureAt,legs:[],stops:[],visited:['origin'],netKwh:0,seconds:0,distance:0};
    const frontier=[initial];
    const observeState=createStateShadow();observeState(initial);
    const incumbent:{outcome:OptimizerOutcome|null;state:OptimizerState|null}={outcome:null,state:null};let expanded=0,transitions=0;
    maxMetric('frontier_peak',frontier.length);
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
      if(options.maxStops>0&&context.baseRoutes?.length){
        // A range hint orders candidates only; it never certifies a reachable transition.
        let fullBatteryProgress=Math.min(1,(context.weatherSampling?.rangeKm?context.weatherSampling.rangeKm*1000:200000)/context.baseRoutes[0].distanceMeters),reachFromDrive=false;
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
            if(segment&&initial.soc>context.request.constraints.minimumReserveChargePercent){
              fullBatteryProgress=segment.endDistanceMeters/direct.route.distanceMeters/((initial.soc-context.request.constraints.minimumReserveChargePercent)/100);reachFromDrive=true;}
          }
          if(direct.energy.status!=='estimated'||direct.energy.partialSegmentId)continue;
          const next=append(initial,direct);if(incumbent.state&&compareStates(next,incumbent.state,objective)>=0)continue;
          const previous=incumbent.state;incumbent.state=next;try{incumbent.outcome=compilePlan(context,next,metadata(),port);}
          catch(error){incumbent.state=previous;if(!(error instanceof ZodError))throw error;port.issues.add('FINAL_PLAN_CONTRACT_OR_ROAD_CONNECTION_INVALID');}
        }
        // Optimizer 1.5.0: one seed chain per reach strategy. A strategy stops at its first complete chain; a later
        // strategy may only replace the incumbent with a strictly better plan.
        const chains:OptimizerState[]=[];
        // Optimizer 1.7.0: charge-to-need. When the last stop of the state charged above the fast band and the validated
        // leg leaving it shows slack, recharge that stop only to what the leg needs (+margin) and re-drive it. Only an
        // engine-validated replacement is used; budget exhaustion keeps the untrimmed leg (a plan is never lost here).
        const fastBand=Math.max(0,...seedChargeTargets(context,0).filter(t=>t<100));
        const trim=async(state:OptimizerState,leg:import('./optimizer-types').DriveLeg):Promise<{state:OptimizerState;leg:import('./optimizer-types').DriveLeg}|null>=>{
          if(objective==='minimum_charging_stops'||!state.stops.length)return null;
          // Optimizer 1.8.0: the last stop before the destination is trimmed at any target (İstanbul→Erzurum: 80 % → 62 % arrival).
          const index=state.stops.length-1,stop=state.stops[index].stop;if(stop.targetChargePercent<=fastBand+1e-7&&leg.to!=='destination')return null;
          const rows=leg.energy.segments;if(!rows.length)return null;
          const reserve=context.request.constraints.minimumReserveChargePercent,required=leg.to==='destination'?context.request.constraints.targetArrivalChargePercent:reserve;
          const slack=Math.min(Math.min(...rows.map(r=>r.minimumChargePercent))-reserve,rows.at(-1)!.endChargePercent-required);
          // Same anchor as improveFixedStopTargets/chargeTargetCandidates: needed SOC + 0.05, rounded up to 0.01 %.
          if(!(slack>0))return null;
          const arrival=stopArrival(context,state,index),node=context.nodes.find(n=>n.id===leg.to);if(!arrival||!node)return null;
          for(const margin of [SEED_TRIM_POLICY.marginPercent,...SEED_TRIM_POLICY.retryMarginsPercent]){
            const target=Math.ceil((stop.targetChargePercent-slack+margin)*100-1e-8)/100;
            if(target>stop.targetChargePercent-SEED_TRIM_POLICY.minGainPercent)return null;if(target<=arrival.soc)continue;
            const before=stopped;
            try{await budget();for(const charged of distinctChargedStates(await port.charge(arrival,target,signal))){
              await budget();for(const next of await port.drive(charged,node,false,signal))if(appendDrivingState(charged,next,context))return {state:charged,leg:next};}}
            catch(error){if(!(error instanceof PlanningDataLimit))throw error;stopped=before;return null;}
          }
          return null;
        };
        const makeSeed=(reachFraction:number,stopCap:number)=>{let done=false;
        const seed=async(state:OptimizerState,progress:number):Promise<boolean>=>{
          if(done)return true;
          if(state.stops.length&&!unreachable(state.nodeId,state.soc,'destination')){await budget();for(const tail of await port.drive(state,context.nodes.find(n=>n.id==='destination')!,false,signal)){
            if(tail.energy.status!=='estimated'||tail.energy.partialSegmentId)continue;
            const trimmed=await trim(state,tail),next=trimmed?append(trimmed.state,trimmed.leg):append(state,tail);chains.push(next);if(incumbent.state&&compareStates(next,incumbent.state,objective)>=0){done=true;return true;}
            const previous=incumbent.state;incumbent.state=next;
            try{incumbent.outcome=compilePlan(context,next,metadata(),port);done=true;return true;}
            catch(error){incumbent.state=previous;if(!(error instanceof ZodError))throw error;port.issues.add('FINAL_PLAN_CONTRACT_OR_ROAD_CONNECTION_INVALID');}
          }}
          if(state.stops.length>=stopCap)return false;
          const target=progress+fullBatteryProgress*(state.soc-context.request.constraints.minimumReserveChargePercent)/100*reachFraction;
          const ranked=context.candidates.candidates.filter(c=>!state.visited.includes(c.station.id)&&candidateProgress(c,context.baseRoutes!)>progress)
            .sort((a,b)=>(reachFromDrive?Math.abs(candidateProgress(a,context.baseRoutes!)-target)-Math.abs(candidateProgress(b,context.baseRoutes!)-target):
              candidateProgress(a,context.baseRoutes!)-candidateProgress(b,context.baseRoutes!))||a.station.id.localeCompare(b.station.id));
          const seeds=ranked.slice(0,seedPolicy.seedAttempts);
          // Furthest base-route progress any failed (reserve/depletion) leg from this state still covered safely.
          let observedReach=Number.NEGATIVE_INFINITY;
          const attempt=async(candidate:typeof seeds[number]):Promise<boolean|null>=>{
            if(expanded>=options.maxStates){stopped='state_budget';return null;}
            // Optimizer 1.8.0: once a plan exists, keep IMPROVE_RESERVE_POLICY of the weather budget for improving it.
            if(!seedingAllowed(!!incumbent.state,port.weatherBudget?.()))return null;
            if(unreachable(state.nodeId,state.soc,candidate.station.id))return false;
            await budget();const node=context.nodes.find(n=>n.id===candidate.station.id)!;expanded++;
            for(const leg of await port.drive(state,node,false,signal)){
              if(leg.energy.status==='charge_required'){
                const rows=leg.energy.segments,firstUnsafe=rows.findIndex(r=>r.minimumChargePercent<context.request.constraints.minimumReserveChargePercent);
                const last=rows[(firstUnsafe<0?rows.length:firstUnsafe)-1],segment=leg.route.segments.find(s=>s.id===last?.segmentId);
                if(segment)observedReach=Math.max(observedReach,progress+segment.endDistanceMeters/context.baseRoutes![0].distanceMeters);
              }
              if(leg.energy.status!=='estimated'||leg.energy.partialSegmentId)continue;
              const trimmed=await trim(state,leg),atStation=trimmed?append(trimmed.state,trimmed.leg):append(state,leg);
              if(atStation.soc>=noChargeAbove){blocked();port.debug?.stopRuleBlock(context,atStation.nodeId,atStation.soc);continue;}
              for(const targetSoc of seedChargeTargets(context,atStation.soc)){
                await budget();for(const charged of distinctChargedStates(await port.charge(atStation,targetSoc,signal))){
                  if(await seed(charged,candidateProgress(candidate,context.baseRoutes!)))return true;
                }
              }
            }
            return false;
          };
          for(const candidate of seeds){const result=await attempt(candidate);if(result===null)return false;if(result)return true;}
          const fallback=seedFallbackCandidates(ranked,new Set(seeds.map(c=>c.station.id)),observedReach,c=>candidateProgress(c,context.baseRoutes!),seedPolicy.seedAttempts);
          for(const candidate of fallback){const result=await attempt(candidate);if(result===null)return false;if(result)return true;}
          return false;
        };
        return seed;};
        // Optimizer 1.8.0: every strategy may use the route stop cap (options.maxStops), and the other strategies also run when the
        // far chain found no plan. When the route cap is above the base cap (STOP_LIMIT_POLICY.min), one more far chain limited to the
        // base cap (fewer, longer legs) is compared while the improvement reserve allows; the best chain wins and is improved.
        const [farReach,...otherReaches]=seedPolicy.seedReachFractions,baseCap=Math.min(options.maxStops,STOP_LIMIT_POLICY.min);
        if(!incumbent.outcome)await makeSeed(farReach,options.maxStops)(initial,0);
        if(options.maxStops>baseCap&&incumbent.state?.stops.length)await makeSeed(farReach,baseCap)(initial,0);
        if(!incumbent.state||incumbent.state.stops.length)for(const reach of otherReaches)await makeSeed(reach,options.maxStops)(initial,0);
        // Improve every seed chain (best first), not only the winner: a weaker chain can improve past it.
        // Improve the known itineraries before broad branching can exhaust road/weather budgets.
        port.debug?.enterPhase(relaxStopRules?'relaxed_improve':'improve',port.counters.weatherQueries);
        for(const chain of [...new Set(chains)].filter(c=>c.stops.length).sort((a,b)=>compareStates(a,b,objective)))
          await improveFixedStopTargets(context,chain,port,signal,(a,b)=>compareStates(a,b,objective),budget,state=>{
            if(!respectsStopRules(state,noChargeAbove)||incumbent.state&&compareStates(state,incumbent.state,objective)>=0)return false;
            const previous=incumbent.state;incumbent.state=state;
            try{incumbent.outcome=compilePlan(context,state,metadata(),port);return true;}
            catch(error){incumbent.state=previous;if(!(error instanceof ZodError))throw error;port.issues.add('FINAL_PLAN_CONTRACT_OR_ROAD_CONNECTION_INVALID');return false;}
          },this.clock);
        // Optimizer 1.8.0: final charge-to-need on the last stop of the best plan (improvement may lower an earlier stop and leave
        // the last one at 80 %; İstanbul→Erzurum arrived with 62 % for a 20 % target). Engine-validated, kept only if strictly better.
        port.debug?.enterPhase(relaxStopRules?'relaxed_final_trim':'final_trim',port.counters.weatherQueries);
        const best=incumbent.state,tail=best?.legs.at(-1);
        if(best?.stops.length&&tail?.to==='destination'){const trimmed=await trim(best,tail);
          if(trimmed){const next=append(trimmed.state,trimmed.leg);
            if(respectsStopRules(next,noChargeAbove)&&compareStates(next,best,objective)<0){incumbent.state=next;
              try{incumbent.outcome=compilePlan(context,next,metadata(),port);}
              catch(error){incumbent.state=best;if(!(error instanceof ZodError))throw error;port.issues.add('FINAL_PLAN_CONTRACT_OR_ROAD_CONNECTION_INVALID');}}}}
        // Optimizer 1.9.0 P3: stop elimination. Cheapest charge first, remove a stop by charging the previous one for both legs
        // (STOP_ELIMINATION_POLICY margins); the rest of the trip is re-driven by the engine and kept only when strictly better.
        port.debug?.enterPhase(relaxStopRules?'relaxed_eliminate':'eliminate',port.counters.weatherQueries);
        const driveTo=async(state:OptimizerState,nodeId:string):Promise<OptimizerState|null>=>{const node=context.nodes.find(n=>n.id===nodeId);
          if(!node||unreachable(state.nodeId,state.soc,nodeId))return null;await budget();
          for(const leg of await port.drive(state,node,false,signal)){const next=appendDrivingState(state,leg,context);if(next)return next;}return null;};
        const chargeTo=async(state:OptimizerState,target:number):Promise<OptimizerState|null>=>{if(state.soc>=target-1e-9)return state;await budget();
          return distinctChargedStates(await port.charge(state,target,signal))[0]??null;};
        const withoutStop=async(best:OptimizerState,index:number):Promise<OptimizerState|null>=>{
          const stops=best.stops,nextId=index+1<stops.length?stops[index+1].stop.stationId:'destination';
          const required=nextId==='destination'?context.request.constraints.targetArrivalChargePercent:reserveSoc;
          const arrivalNext=index+1<stops.length?stops[index+1].stop.arrivalChargePercent:best.soc;
          const departures:(()=>Promise<OptimizerState|null>)[]=[];
          if(index===0)departures.push(async()=>initial);
          else{const arrival=stopArrival(context,best,index-1);if(!arrival)return null;const previous=stops[index-1].stop.targetChargePercent;
            for(const target of new Set(eliminationTargets(previous,stops[index].stop.arrivalChargePercent,stops[index].stop.targetChargePercent,arrivalNext,required).map(t=>Math.max(t,previous))))
              departures.push(()=>chargeTo(arrival,target));}
          for(const depart of departures){let state=await depart();if(!state)continue;state=await driveTo(state,nextId);
            for(let j=index+1;state&&j<stops.length;j++){const charged=await chargeTo(state,stops[j].stop.targetChargePercent);
              state=charged?await driveTo(charged,j+1<stops.length?stops[j+1].stop.stationId:'destination'):null;}
            if(state)return state;}
          return null;
        };
        try{let attempts=0;
          for(let round=0;round<STOP_ELIMINATION_POLICY.maxRounds&&incumbent.state?.stops.length&&attempts<STOP_ELIMINATION_POLICY.maxAttempts;round++){
            const base=incumbent.state;let improved=false;
            const order=base.stops.map((s,i)=>({i,charged:s.stop.targetChargePercent-s.stop.arrivalChargePercent})).sort((a,b)=>a.charged-b.charged||b.i-a.i);
            for(const {i} of order){if(attempts++>=STOP_ELIMINATION_POLICY.maxAttempts)break;
              const next=await withoutStop(base,i);
              if(next&&respectsStopRules(next,noChargeAbove)&&compareStates(next,base,objective)<0){incumbent.state=next;
                try{incumbent.outcome=compilePlan(context,next,metadata(),port);improved=true;break;}
                catch(error){incumbent.state=base;if(!(error instanceof ZodError))throw error;port.issues.add('FINAL_PLAN_CONTRACT_OR_ROAD_CONNECTION_INVALID');}}}
            if(!improved)break;}}
        catch(error){if(!(error instanceof PlanningDataLimit))throw error;}
      }
      const broadStart=port.counters.weatherQueries;port.debug?.enterPhase(relaxStopRules?'relaxed_broad':'broad',broadStart);
      while(frontier.length){
        signal.throwIfAborted();if(expanded>=options.maxStates){stopped='state_budget';break;}
        // Optimizer 1.7.0: once a validated plan exists, the broad improvement search has its own transition allowance.
        if(incumbent.state&&port.counters.weatherQueries-broadStart>=BROAD_SEARCH_POLICY.maxWeatherProjectionsWithIncumbent){stopped='data_budget';break;}
        frontier.sort((a,b)=>compareStates(a,b,objective));const current=frontier.shift()!;expanded++;
        if(expanded%8===0)await yieldLoop();
        // 1.9.0: the bound uses the same penalized time as the ranking (penalties only grow with more stops).
        const penalized=(x:OptimizerState)=>x.seconds+x.stops.length*STOP_PENALTY_POLICY.secondsPerStop;
        if(incumbent.state&&(objective==='minimum_total_duration'&&penalized(current)>penalized(incumbent.state)||objective==='minimum_charging_stops'&&current.stops.length>incumbent.state.stops.length))continue;
        const outgoing=context.nodes.filter(n=>n.id!==current.nodeId&&!current.visited.includes(n.id)).sort((a,b)=>a.id==='destination'?-1:b.id==='destination'?1:a.id<b.id?-1:1);
        const advance=async(departure:OptimizerState)=>{
          for(const target of outgoing){if(unreachable(departure.nodeId,departure.soc,target.id))continue;await budget();
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
              }else {if(frontier.length>=options.maxFrontier){stopped='frontier_budget';throw new PlanningDataLimit('FRONTIER_BUDGET');}frontier.push(next);maxMetric('frontier_peak',frontier.length);observeState(next);}
            }
          }
        };
        await advance(current);
        if(current.nodeId==='origin'||current.stops.length>=options.maxStops)continue;
        if(current.soc>=noChargeAbove){blocked();port.debug?.stopRuleBlock(context,current.nodeId,current.soc);continue;}
        const anchors:number[]=[];
        // Conservative access/arrival anchors from full-charge previews; every selected transition is re-evaluated at its actual scenario time/SOC.
        for(const target of outgoing){if(unreachable(current.nodeId,100,target.id))continue;await budget();for(const leg of await port.drive(current,target,true,signal))if(leg.energy.status==='estimated'&&leg.energy.capacityKwh){
          const reserve=100-leg.energy.minimumChargePercent!+context.request.constraints.minimumReserveChargePercent;
          const arrival=100-leg.energy.finalChargePercent!+(target.id==='destination'?context.request.constraints.targetArrivalChargePercent:context.request.constraints.minimumReserveChargePercent);
          anchors.push(Math.ceil(Math.max(reserve,arrival)*100-1e-8)/100);
        }}
        for(const soc of chargeTargetCandidates(context,current.soc,anchors)){
          await budget();for(const charged of distinctChargedStates(await port.charge(current,soc,signal)))await advance(charged);
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
