import {Logger} from '@nestjs/common';
import type {PlanningContext} from '../planning/optimizer-types';
import {candidateProgress} from '../planning/catalogue-station-scenario';
import {STOP_PENALTY_POLICY} from '../planning/optimizer-policy';
import type {RoutePlan} from '@chargeroad/shared';

/**
 * DEVELOPMENT-ONLY planning trace (2026-11-19, user request). Enabled only with PLANNING_DEBUG_TRACE=true and never when
 * NODE_ENV=production. Emits one `planning_debug` JSON line per plan: where the search spent its budget, which drives failed
 * and why candidates were rejected. Contains SOC/reserve/arrival values (normally excluded from logs by CLAUDE.md) but never
 * coordinates; positions are kilometres along the corridor route. Listed for removal in docs/DEV_DIAGNOSTICS.md.
 */
export function planningDebugEnabled(){return process.env.PLANNING_DEBUG_TRACE==='true'&&process.env.NODE_ENV!=='production';}

type Drive={fromKm:number;toKm:number;startSoc:number;status:string;projections:number};
type Corridor={routeIndex:number;routeKm:number;segments:number;corridorMeters:number|null;rangeKm:number|null;maxStops:number;
  candidatesKm:string[];phases:Record<string,number>;drives:{count:number;byStatus:Record<string,number>;projectionsByStatus:Record<string,number>;top:Drive[];skippedUnreachable?:number};
  charges:{ok:number;failed:number};stopRuleBlocks:{count:number;examples:{km:number;arrivalSoc:number}[]};contractFailures:Record<string,number>;
  incumbents:{atMs:number;minutes:number;stops:number;arrivalSoc:number;phase?:string}[];outcome?:string;stoppedReason?:string;states?:number;transitions?:number;
  weather:{used:number;limit:number|null};roadQueries?:number};
const round=(n:number,d=1)=>Math.round(n*10**d)/10**d;

export class PlanningDebugTrace {
  private readonly started=performance.now();
  readonly request:Record<string,unknown>;
  readonly corridors:Corridor[]=[];
  /** Summary of the plan that was returned (planned outcomes only). */
  final:Record<string,unknown>|null=null;
  private current:Corridor|null=null;private phase='seed';private phaseMark=0;
  constructor(raw:{requestId?:string;startingChargePercent?:number;departureMode?:string;constraints?:{minimumReserveChargePercent:number;targetArrivalChargePercent:number};policy?:{objective?:string}}){
    this.request={requestId:raw?.requestId??null,startingChargePercent:raw?.startingChargePercent??null,reserve:raw?.constraints?.minimumReserveChargePercent??null,
      arrivalTarget:raw?.constraints?.targetArrivalChargePercent??null,objective:raw?.policy?.objective??null,departureMode:raw?.departureMode??null};
  }
  kmOf(context:PlanningContext,id:string){
    const route=context.baseRoutes?.[0];if(!route)return -1;if(id==='origin')return 0;if(id==='destination')return round(route.distanceMeters/1000,0);
    const c=context.candidates?.candidates.find(x=>x.station.id===id);return c?round(candidateProgress(c,context.baseRoutes!)*route.distanceMeters/1000,0):-1;
  }
  beginCorridor(context:PlanningContext,routeIndex:number,weatherUsed:number){
    const route=context.baseRoutes![0],access=context.stationAccess??{};
    this.current={routeIndex,routeKm:round(route.distanceMeters/1000),segments:route.segments.length,corridorMeters:context.candidates?.metadata.search?.corridorMeters??null,
      rangeKm:context.weatherSampling?.rangeKm?round(context.weatherSampling.rangeKm,0):null,maxStops:context.options.maxStops,
      candidatesKm:(context.candidates?.candidates??[]).map(c=>{const km=this.kmOf(context,c.station.id),d=access[c.station.id]?.additionalMeters;
        const kw=Math.max(0,...c.station.evses.flatMap(e=>e.connectors.map(p=>p.maxPowerKw??0)));return `${km}km/${kw}kW${d!=null&&d>3000?`/+${round(d/1000,0)}km`:''}`;})
        .sort((a,b)=>parseFloat(a)-parseFloat(b)),
      phases:{},drives:{count:0,byStatus:{},projectionsByStatus:{},top:[]},charges:{ok:0,failed:0},stopRuleBlocks:{count:0,examples:[]},contractFailures:{},incumbents:[],
      weather:{used:0,limit:null}};
    this.corridors.push(this.current);this.phase='seed';this.phaseMark=weatherUsed;
  }
  /** Phase boundary: projections since the previous boundary are booked to the previous phase. */
  enterPhase(name:string,weatherUsed:number){if(!this.current)return;const c=this.current;
    c.phases[this.phase]=(c.phases[this.phase]??0)+Math.max(0,weatherUsed-this.phaseMark);this.phase=name;this.phaseMark=weatherUsed;}
  drive(context:PlanningContext,fromId:string,toId:string,startSoc:number,legs:{energy:{status:string;partialSegmentId?:string|null}}[]|undefined,projections:number){
    const c=this.current;if(!c)return;c.drives.count++;
    const status=!legs?'error':!legs.length?'no_route':legs.map(l=>l.energy.status+(l.energy.partialSegmentId?'_partial':'')).sort().join('+');
    c.drives.byStatus[status]=(c.drives.byStatus[status]??0)+1;c.drives.projectionsByStatus[status]=(c.drives.projectionsByStatus[status]??0)+projections;
    if(projections>0){c.drives.top.push({fromKm:this.kmOf(context,fromId),toKm:this.kmOf(context,toId),startSoc:round(startSoc),status,projections});
      c.drives.top.sort((a,b)=>b.projections-a.projections);c.drives.top.length=Math.min(c.drives.top.length,5);}
  }
  skippedUnreachable(){const c=this.current;if(c)c.drives.skippedUnreachable=(c.drives.skippedUnreachable??0)+1;}
  charge(ok:boolean){if(this.current){if(ok)this.current.charges.ok++;else this.current.charges.failed++;}}
  stopRuleBlock(context:PlanningContext,nodeId:string,arrivalSoc:number){const c=this.current;if(!c)return;c.stopRuleBlocks.count++;
    if(c.stopRuleBlocks.examples.length<5)c.stopRuleBlocks.examples.push({km:this.kmOf(context,nodeId),arrivalSoc:round(arrivalSoc)});}
  contractFailure(issues:{path:PropertyKey[];message:string}[]){const c=this.current;if(!c)return;
    const key=issues.slice(0,2).map(i=>i.path.map(String).join('.')+': '+i.message).join(' | ')||'unknown';c.contractFailures[key]=(c.contractFailures[key]??0)+1;}
  /** A planned incumbent; the first one splits the seed phase into before/after the first plan. */
  incumbent(minutes:number,stops:number,arrivalSoc:number,weatherUsed:number){if(this.current&&!this.current.incumbents.length&&this.phase.endsWith("seed"))this.enterPhase(this.phase+"_after_first_plan",weatherUsed);
    this.current?.incumbents.push({atMs:round(performance.now()-this.started,0),minutes:round(minutes),stops,arrivalSoc:round(arrivalSoc),phase:this.phase});}
  /** Item D (2026-11-19): the chosen plan. Kilometres along the route only; no coordinates, station or user ids. */
  finalPlan(plan:RoutePlan){
    const d=plan.duration,m=(sec:number|null)=>sec===null?null:round(sec/60);
    const known=d.drivingSeconds+d.chargingSeconds+d.connectionSeconds+d.blockingPreconditioningSeconds+(d.waitingSeconds??0);
    const stops=plan.chargingStops,arrival=round(plan.estimatedArrivalChargePercent,0);
    // The incumbent that matches the plan (stop count and arrival SOC) tells which search phase produced it.
    const source=this.corridors.flatMap(c=>c.incumbents).filter(i=>i.stops===stops.length&&Math.round(i.arrivalSoc)===arrival).at(-1);
    let previous=0;
    this.final={optimizer:plan.algorithmVersion,energyModel:plan.energySegments[0]?.modelVersion??null,routeKm:round(plan.roadRoute.distanceMeters/1000,0),
      stops:stops.length,arrivalSoc:arrival,
      minutes:{driving:m(d.drivingSeconds),charging:m(d.chargingSeconds),connection:m(d.connectionSeconds),preconditioning:m(d.blockingPreconditioningSeconds),
        waiting:m(d.waitingSeconds),total:m(known),rankedWithStopPenalty:m(known+stops.length*STOP_PENALTY_POLICY.secondsPerStop)},
      sourcePhase:source?.phase??null,
      chargingStops:stops.map(s=>{const km=round(s.routeDistanceMeters/1000,0),gap=km-previous;previous=km;
        return {km,gapKm:round(gap,0),arrivalSoc:round(s.arrivalChargePercent),targetSoc:round(s.targetChargePercent),chargeMinutes:m(s.chargingDurationSeconds),
          avgKw:round(s.energyDeliveredAtInletKwh/(s.chargingDurationSeconds/3600),0),detourKm:s.detourDistanceMeters===null?null:round(s.detourDistanceMeters/1000),
          waitMinutes:m(s.waiting.seconds)};}),
      lastLegKm:round(plan.roadRoute.distanceMeters/1000-previous,0)};
  }
  endCorridor(result:{status:string},search:{stoppedReason?:string;expandedStates?:number;evaluatedTransitions?:number}|undefined,weather:{used:number;limit:number},roadQueries:number){
    const c=this.current;if(!c)return;this.enterPhase('end',weather.used);delete c.phases.end;
    Object.assign(c,{outcome:result.status,stoppedReason:search?.stoppedReason,states:search?.expandedStates,transitions:search?.evaluatedTransitions,
      weather:{used:weather.used,limit:Number.isFinite(weather.limit)?weather.limit:null},roadQueries});this.current=null;
  }
  log(outcome:string){new Logger('PlanningDebug').log(JSON.stringify({event:'planning_debug',devOnly:true,requestId:this.request.requestId,
    elapsedMs:round(performance.now()-this.started,0),outcome,request:this.request,finalPlan:this.final,corridors:this.corridors}));}
}
