import {Injectable} from '@nestjs/common';
import {routePlanRequestSchema,optimizerOptionsSchema,roadRoutingResultSchema,vehicleEnergyProfileSchema,stationCandidateSetSchema,planningEvaluationSchema} from '@chargeroad/shared';
import type {RoutePlanRequest,OptimizerOptions,PlanningResult,StationCandidateSet} from '@chargeroad/shared';
import {VehicleEnergyProvider} from '../providers/vehicle-energy-provider';
import {RoutingProvider} from '../providers/routing-provider';
import {StationDataProvider} from '../providers/station-data-provider';
import {WeatherProvider} from '../providers/weather-provider';
import {EnergyConsumptionEngine} from '../energy/energy-engine';
import {ChargingCurveEngine} from '../charging/charging-engine';
import {preparationOptionsSchema} from './planning-coordinator';
import type {PreparationOptions} from './planning-coordinator';
import {ChargeStopOptimizer} from './charge-stop-optimizer';
import {PlanningSession} from './planning-session';
import {PlanningProviderFailure,PlanningDataLimit} from './optimizer-types';
import {meters} from '../roads/geometry';
import {OPTIMIZER_VERSION} from './optimizer-policy';
import {ENERGY_ALGORITHM_VERSION} from '../energy/energy-policy';
import {ENERGY_POLICY} from '../energy/energy-policy';
import {CHARGING_ALGORITHM_VERSION} from '../charging/charging-engine';
import {catalogueStationScenario,selectCatalogueCandidates} from './catalogue-station-scenario';
import {RoadProviderError} from '../roads/road-client';
import type {PlanningContext,OptimizerOutcome} from './optimizer-types';

@Injectable()
export class EvPlanningService {
  constructor(private readonly vehicles:VehicleEnergyProvider,private readonly roads:RoutingProvider,private readonly stations:StationDataProvider,
    private readonly weather:WeatherProvider,private readonly energy:EnergyConsumptionEngine,private readonly charging:ChargingCurveEngine,private readonly optimizer:ChargeStopOptimizer){}
  async plan(raw:RoutePlanRequest,rawPreparation:PreparationOptions,rawOptions:OptimizerOptions,caller:AbortSignal=new AbortController().signal):Promise<OptimizerOutcome>{
    caller.throwIfAborted();let request=routePlanRequestSchema.parse(raw);const preparation=preparationOptionsSchema.parse(rawPreparation),options=optimizerOptionsSchema.parse(rawOptions);
    options.maxWeatherQueries=Math.min(options.maxWeatherQueries,preparation.maxWeatherQueries);
    const began=performance.now(),deadline=began+request.policy.maxComputationMilliseconds,evaluatedAt=new Date().toISOString();
    const failure=(status:Exclude<PlanningResult['status'],'planned'>,code:string):OptimizerOutcome=>({result:{status,requestId:request.requestId,reasons:[{code,explanation:code}]}});
    const read=async<T>(role:string,operation:(s:AbortSignal)=>Promise<T>):Promise<T>=>{
      caller.throwIfAborted();const remaining=deadline-performance.now();if(remaining<=0)throw new PlanningDataLimit('PLANNING_PREPARATION_DEADLINE');
      const timeout=AbortSignal.timeout(Math.max(1,Math.ceil(remaining))),signal=AbortSignal.any([caller,timeout]);
      try{return await new Promise<T>((resolve,reject)=>{const cancel=()=>reject(signal.reason);signal.addEventListener('abort',cancel,{once:true});
        Promise.resolve().then(()=>{signal.throwIfAborted();return operation(signal);}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));});}
      catch(error){if(caller.aborted)throw caller.reason;if(timeout.aborted)throw new PlanningDataLimit('PLANNING_PREPARATION_DEADLINE');
        if(error instanceof RoadProviderError)throw new PlanningProviderFailure(error.code,error.retryAfterSeconds);throw new PlanningProviderFailure(role+'_PROVIDER_FAILED');}
    };
    try{
      const departureDelta=Date.parse(request.departureAt)-Date.parse(evaluatedAt);
      if(departureDelta<0||departureDelta>ENERGY_POLICY.departureWindowSeconds*1000)return failure('insufficient_data','DEPARTURE_OUTSIDE_72_HOUR_WINDOW');
      const id=await read('VEHICLE',s=>this.vehicles.resolveId(request.vehicleVariantId,s));request={...request,vehicleVariantId:id};
      const profile=await read('VEHICLE',s=>this.vehicles.profile(id,s,request.policy.vehicleDataQuality??'verified_only'));
      if(!profile.data)return failure('insufficient_data','VEHICLE_ENERGY_PROFILE_MISSING');
      const vehicleResult=vehicleEnergyProfileSchema.safeParse(profile.data);if(!vehicleResult.success)throw new PlanningProviderFailure('VEHICLE_PROVIDER_INVALID_DATA');
      const vehicle=vehicleResult.data;
      if(vehicle.vehicleVariantId!==id)throw new PlanningProviderFailure('VEHICLE_PROFILE_IDENTITY_MISMATCH');
      if(!vehicle.energyModel)return failure('insufficient_data','ENERGY_CALIBRATION_MISSING');
      if(request.policy.vehicleDataQuality!=='allow_engineering_estimates'&&(vehicle.dataQuality?.quality==='engineering_estimate'||vehicle.energyModel.quality==='engineering_estimate'))
        return failure('insufficient_data','ENGINEERING_ESTIMATE_NOT_ALLOWED');
      if(request.startingChargePercent<request.constraints.minimumReserveChargePercent)return failure('insufficient_data','INITIAL_RESERVE_NOT_MET');
      const response=await read('ROAD',s=>this.roads.routes({...preparation.road,schemaVersion:'1.0.0',origin:request.origin,destination:request.destination,departureAt:request.departureAt},s));
      const baseResult=roadRoutingResultSchema.nullable().safeParse(response.data);if(!baseResult.success)throw new PlanningProviderFailure('ROAD_PROVIDER_INVALID_DATA');
      let base=baseResult.data;if(!base)return failure('infeasible','ROAD_ROUTE_NOT_FOUND');
      if(base.routes.length>preparation.road.alternatives||base.routes.some(r=>!r.source.license))throw new PlanningProviderFailure('ROAD_PROVIDER_ENDPOINT_OR_SOURCE_INVALID');
      const matched=base.routes.filter(r=>meters(r.segments[0].geometry[0],request.origin)<=100&&meters(r.segments.at(-1)!.geometry.at(-1)!,request.destination)<=100);
      if(!matched.length){const nearby=base.routes.some(r=>meters(r.segments[0].geometry[0],request.origin)<=1000&&meters(r.segments.at(-1)!.geometry.at(-1)!,request.destination)<=1000);
        return failure('insufficient_data',nearby?'ROAD_ENDPOINT_CONFIRMATION_REQUIRED':'ROAD_ENDPOINT_NOT_REACHABLE');}
      base={...base,routes:matched};
      const context:PlanningContext={request,vehicle,evaluatedAt,options:{...options},candidates:null as unknown as StationCandidateSet,nodes:[],baseRoutes:base.routes};
      const session=new PlanningSession(context,this.roads,this.weather,this.energy,this.charging,preparation.road,deadline,base.routes);
      session.counters.roadQueries=1;session.replay.roads.push({from:'origin',to:'destination',at:request.departureAt,response});
      let previousStates=0,previousTransitions=0,last:OptimizerOutcome|undefined;
      const pinned=new Map<string,StationCandidateSet['candidates'][number]>();
      for(const corridor of options.corridorMeters){
        const found=await read('STATION',s=>this.stations.findAlongRoutes(base.routes,corridor,s,vehicle.supportedConnectors));
        const setResult=stationCandidateSetSchema.safeParse(found.data);if(!setResult.success)throw new PlanningProviderFailure('STATION_PROVIDER_INVALID_DATA');
        const set=setResult.data;
        if(set.candidates.some(c=>['origin','destination'].includes(c.station.id)||c.routeMatches.some(m=>!base.routes.some(r=>r.id===m.routeId&&r.segments.some(s=>s.id===m.segmentId)))))
          throw new PlanningProviderFailure('STATION_ROUTE_OR_NODE_ID_INVALID');
        for(const candidate of set.candidates)if(!['planned','removed','temporarily_closed'].includes(candidate.lifecycle)&&!pinned.has(candidate.station.id))pinned.set(candidate.station.id,candidate);
        const all=[...pinned.values()].map(c=>request.policy.stationDataQuality==='catalogue_power_scenario'?catalogueStationScenario(c):c)
          .sort((a,b)=>a.station.id<b.station.id?-1:1);
        const physical=all.filter(c=>c.station.evses.some(e=>e.connectors.some(p=>p.powerType==='dc'&&vehicle.supportedConnectors.includes(p.standard))));
        if(physical.length<all.length)session.issues.add('PHYSICAL_DC_EVSE_DATA_MISSING');
        const limit=Math.min(options.maxStations,set.metadata.search.maxCandidates),limited=physical.length>limit;
        context.candidates={candidates:request.policy.stationDataQuality==='catalogue_power_scenario'?selectCatalogueCandidates(physical,base.routes,limit):physical.slice(0,limit),metadata:structuredClone(set.metadata)};
        if(physical.length<all.length)context.candidates.metadata.coverage.completeForQuery=false;
        if(limited){context.candidates.metadata.search.truncated=true;context.candidates.metadata.coverage.completeForQuery=false;session.issues.add('STATION_CANDIDATE_LIMIT');}
        context.nodes=[{id:'origin',location:request.origin,stationId:null},{id:'destination',location:request.destination,stationId:null},
          ...context.candidates.candidates.map(c=>({id:c.station.id,location:c.station.location,stationId:c.station.id}))];
        const statesRemaining=options.maxStates-previousStates,transitionsRemaining=options.maxTransitions-previousTransitions;
        if(statesRemaining<=0||transitionsRemaining<=0)break;
        context.options={...options,maxStates:statesRemaining,maxTransitions:transitionsRemaining};
        last=await this.optimizer.solve(context,session,caller);
        const stageStates=last.search?.expandedStates??0,stageTransitions=last.search?.evaluatedTransitions??0;
        if(last.search){last.search.expandedStates+=previousStates;last.search.evaluatedTransitions+=previousTransitions;last.search.elapsedMilliseconds=performance.now()-began;}
        previousStates+=stageStates;previousTransitions+=stageTransitions;
        if(last.result.status==='planned'){
          if(last.validationInput)planningEvaluationSchema.parse({input:last.validationInput,result:last.result});
          return {...last,replay:{versions:{optimizer:OPTIMIZER_VERSION,energy:ENERGY_ALGORITHM_VERSION,charging:CHARGING_ALGORITHM_VERSION},context,providers:session.replay}};
        }
        if(last.result.status==='provider_error'||last.result.status==='computation_limit')break;
      }
      return {...(last??failure('computation_limit','NO_SEARCH_BUDGET')),replay:{versions:{optimizer:OPTIMIZER_VERSION,energy:ENERGY_ALGORITHM_VERSION,charging:CHARGING_ALGORITHM_VERSION},context,providers:session.replay}};
    }catch(error){if(caller.aborted)throw caller.reason;
      if(error instanceof PlanningDataLimit)return failure('computation_limit',error.message);
      if(error instanceof PlanningProviderFailure)return {...failure('provider_error',error.message),retryAfterSeconds:error.retryAfterSeconds};throw error;}
  }
}
