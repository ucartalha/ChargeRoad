import {createHash} from 'node:crypto';
import {setImmediate as yieldLoop} from 'node:timers/promises';
import {roadRoutingResultSchema,weatherForecastSchema,weatherForecastIsUsable} from '@chargeroad/shared';
import type {RoadRoute,WeatherForecast,WeatherQuery,NumericObservation,PlannedChargingStop,ChargingStation,RoutePlanRequest} from '@chargeroad/shared';
import {RoutingProvider} from '../providers/routing-provider';
import {WeatherProvider} from '../providers/weather-provider';
import {EnergyConsumptionEngine} from '../energy/energy-engine';
import {ChargingCurveEngine} from '../charging/charging-engine';
import {batteryThermalStep} from '../energy/battery-thermal';
import {EnergyDataMissing} from '../energy/energy-policy';
import {sampleRouteWeather} from '../weather/weather-sampler';
import {meters} from '../roads/geometry';
import type {PreparationOptions} from './planning-coordinator';
import type {PlanningContext,PlanningNode,OptimizerState,DriveLeg,TransitionPort} from './optimizer-types';
import {PlanningDataLimit,PlanningProviderFailure} from './optimizer-types';
import {checksum} from './plan-compiler';
import type {ProviderResponse} from '../providers/provider-response';
import {WEATHER_POLICY} from '../weather/weather-policy';
import {Logger} from '@nestjs/common';
import {energyInputUsage} from '../energy/energy-input-budget';
import {RoadProviderError} from '../roads/road-client';

export interface SessionReplay {roads:{from:string;to:string;at:string;response:ProviderResponse<{schemaVersion:'1.0.0';routes:RoadRoute[]}|null>}[];
  weather:{queries:WeatherQuery[];response:ProviderResponse<WeatherForecast[]>}[];}

export class PlanningSession implements TransitionPort {
  readonly issues=new Set<string>();readonly counters={roadQueries:0,weatherQueries:0};readonly replay:SessionReplay={roads:[],weather:[]};
  private readonly roads=new Map<string,RoadRoute[]|null>();private readonly weatherCache=new Map<string,WeatherForecast[]>();
  private readonly climateSamples=new Map<string,WeatherQuery['location']>();
  private hardwareEvaluations=0;
  constructor(readonly context:PlanningContext,private readonly routing:RoutingProvider,private readonly climate:WeatherProvider,
    private readonly energy:EnergyConsumptionEngine,private readonly charging:ChargingCurveEngine,private readonly roadOptions:PreparationOptions['road'],
    private readonly deadline:number,baseRoutes:RoadRoute[]=[]){
    if(baseRoutes.length){this.roads.set('origin>destination@'+context.request.departureAt,baseRoutes);
      if(baseRoutes.every(r=>r.metadata?.traffic==='none'))this.roads.set('origin>destination@static',baseRoutes);}
  }
  remainingMilliseconds(){return this.deadline-performance.now();}
  private async call<T>(operation:(signal:AbortSignal)=>Promise<T>,caller:AbortSignal):Promise<T>{
    caller.throwIfAborted();const remaining=this.remainingMilliseconds();if(remaining<=0)throw new PlanningDataLimit('PLANNING_DEADLINE');
    const limit=AbortSignal.timeout(Math.max(1,Math.ceil(remaining))),signal=AbortSignal.any([caller,limit]);
    try{return await new Promise<T>((resolve,reject)=>{
      const cancel=()=>reject(signal.reason);signal.addEventListener('abort',cancel,{once:true});
      Promise.resolve().then(()=>{signal.throwIfAborted();return operation(signal);}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));
    });}catch(error){if(caller.aborted)throw caller.reason;if(limit.aborted)throw new PlanningDataLimit('PLANNING_DEADLINE');throw error;}
  }
  private async route(from:string,to:PlanningNode,at:string,signal:AbortSignal){
    const key=from+'>'+to.id+'@'+at,staticKey=from+'>'+to.id+'@static';
    if(this.roads.has(key))return this.roads.get(key)!;
    if(this.roads.has(staticKey)){this.issues.add('traffic_not_modelled_static_road_time');return this.roads.get(staticKey)!;}
    if(this.counters.roadQueries>=this.context.options.maxRoadQueries)throw new PlanningDataLimit('ROAD_QUERY_BUDGET');this.counters.roadQueries++;
    const node=this.context.nodes.find(n=>n.id===from)!;
    let response:ProviderResponse<{schemaVersion:'1.0.0';routes:RoadRoute[]}|null>;
    try{response=await this.call(s=>this.routing.routes({...this.roadOptions,schemaVersion:'1.0.0',origin:node.location,destination:to.location,departureAt:at},s),signal);}
    catch(error){if(signal.aborted||error instanceof PlanningDataLimit)throw error;
      if(error instanceof RoadProviderError)throw new PlanningProviderFailure(error.code,error.retryAfterSeconds);throw new PlanningProviderFailure('ROAD_PROVIDER_FAILED');}
    const parsed=roadRoutingResultSchema.nullable().safeParse(response.data);if(!parsed.success)throw new PlanningProviderFailure('ROAD_PROVIDER_INVALID_DATA');
    this.replay.roads.push({from,to:to.id,at,response});const routes=parsed.data?.routes??null;
    if(routes&&routes.length>this.roadOptions.alternatives)throw new PlanningProviderFailure('ROAD_ALTERNATIVE_BUDGET_EXCEEDED');
    if(routes?.some(r=>!r.source.license||meters(r.segments[0].geometry[0],node.location)>100||meters(r.segments.at(-1)!.geometry.at(-1)!,to.location)>100)){
      this.issues.add('ROAD_SOURCE_OR_ENDPOINT_INVALID');this.roads.set(key,null);return null;}
    this.roads.set(key,routes);if(routes?.every(r=>r.metadata?.traffic==='none'))this.roads.set(staticKey,routes);
    return routes;
  }
  private async weather(queries:WeatherQuery[],signal:AbortSignal){
    // Reuse already acquired forecast SERIES across charging legs, while evaluating each new passage time.
    // Original target coordinates remain unchanged and the existing 10 km provenance bound still applies.
    if(this.climateSamples.size)queries=queries.map(q=>{
      const nearest=[...this.climateSamples.values()].reduce((best,p)=>meters(q.location,p)<meters(q.location,best)?p:best);
      return meters(q.location,nearest)<=WEATHER_POLICY.sampleDistanceMeters?{...q,sampleLocation:nearest}:q;
    });
    const key=checksum(queries);if(this.weatherCache.has(key))return this.weatherCache.get(key)!;
    if(this.counters.weatherQueries+queries.length>this.context.options.maxWeatherQueries)throw new PlanningDataLimit('WEATHER_QUERY_BUDGET');
    this.counters.weatherQueries+=queries.length;let response:ProviderResponse<WeatherForecast[]>;
    try{response=await this.call(s=>this.climate.forecast(queries,s,{budgetScope:this.context}),signal);}catch(error){if(signal.aborted||error instanceof PlanningDataLimit)throw error;throw new PlanningProviderFailure('WEATHER_PROVIDER_FAILED');}
    let result:WeatherForecast[];try{result=response.data.map(v=>weatherForecastSchema.parse(v));}catch{throw new PlanningProviderFailure('WEATHER_PROVIDER_INVALID_DATA');}
    const requested=new Map(queries.map(q=>[q.id,q]));
    if(result.length!==queries.length||new Set(result.map(r=>r.queryId)).size!==queries.length||result.some(f=>{const q=requested.get(f.queryId);
      return !q||f.segmentId!==q.segmentId||Date.parse(f.validAt)!==Date.parse(q.validAt)||f.location.latitude!==q.location.latitude||f.location.longitude!==q.location.longitude;}))
      throw new PlanningProviderFailure('WEATHER_PROVIDER_INVALID_QUERY_MATCH');
    for(const f of result)if(weatherForecastIsUsable(f,Date.parse(this.context.evaluatedAt),this.context.request.policy.forecastMaxAgeSeconds)){
      const q=requested.get(f.queryId)!,p=q.sampleLocation??q.location;this.climateSamples.set(p.latitude+','+p.longitude,p);
    }
    this.replay.weather.push({queries,response});this.weatherCache.set(key,result);return result;
  }
  async drive(state:OptimizerState,to:PlanningNode,preview:boolean,signal:AbortSignal):Promise<DriveLeg[]>{
    const routes=await this.route(state.nodeId,to,state.at,signal),legs:DriveLeg[]=[];
    for(const route of routes??[]){
      let queries:WeatherQuery[];
      try{queries=sampleRouteWeather({route,departureAt:state.at,stops:[]}).queries;}catch{this.issues.add('WEATHER_SAMPLING_INCOMPLETE');continue;}
      const weather=await this.weather(queries,signal);
      const result=await this.energy.evaluate({request:this.context.request,vehicle:this.context.vehicle,route,weather,evaluatedAt:this.context.evaluatedAt,
        ...(state.capacity?{capacitySnapshot:state.capacity}:{}),continuation:{kind:preview?'upper_charge_preview':'modelled_leg',departureAt:state.at,
          startingChargePercent:preview?100:state.soc,batteryTemperatureC:state.temperature,targetArrivalChargePercent:preview?0:to.id==='destination'?
            this.context.request.constraints.targetArrivalChargePercent:this.context.request.constraints.minimumReserveChargePercent}},signal);
      if(result.status==='computation_limit'){
        if(result.reasons.some(r=>r.code==='ENERGY_INPUT_BUDGET'))new Logger('PlanningSession').warn(JSON.stringify({event:'energy_input_limit',requestId:this.context.request.requestId,...energyInputUsage(route)}));
        for(const reason of result.reasons)this.issues.add(reason.code);throw new PlanningDataLimit('ENERGY_COMPUTATION_BUDGET');}
      if(result.status==='insufficient_data'){for(const reason of result.reasons)this.issues.add(reason.code);}
      legs.push({from:state.nodeId,to:to.id,route,energy:result,weather,departureAt:state.at,
        arrivalAt:new Date(Date.parse(state.at)+route.drivingDurationSeconds*1000).toISOString()});
    }return legs;
  }
  async charge(state:OptimizerState,target:number,signal:AbortSignal):Promise<OptimizerState[]>{
    const c=this.context,station=c.candidates.candidates.find(s=>s.station.id===state.nodeId)?.station,model=c.vehicle.chargingModel;
    if(!station||!state.capacity)return [];
    if(!model||!c.vehicle.dcChargingCurves.length){this.issues.add('VEHICLE_CHARGING_PROFILE_MISSING');return [];}
    if(!station.evses.some(e=>e.connectors.some(p=>p.powerType==='dc'&&c.vehicle.supportedConnectors.includes(p.standard)))){
      this.issues.add('PHYSICAL_DC_EVSE_DATA_MISSING');return [];}
    if(station.access.publicAccess===false||station.access.membershipRequired===true&&c.request.policy.stationDataQuality!=='catalogue_power_scenario'){
      this.issues.add('STATION_ACCESS_NOT_AUTHORIZED');return [];}
    if(station.access.membershipRequired===true)this.issues.add('operator_membership_required');
    if(station.access.publicAccess===null||station.access.openingHours===null)this.issues.add('station_access_hours_unverified');
    const q:WeatherQuery={id:'charge-weather-'+checksum([station.id,state.at]).slice(0,24),segmentId:'station:'+station.id,location:station.location,validAt:state.at};
    const weather=(await this.weather([q],signal))[0];
    if(!weatherForecastIsUsable(weather,Date.parse(c.evaluatedAt),Math.min(c.request.policy.forecastMaxAgeSeconds,43200))){this.issues.add('STATION_WEATHER_UNAVAILABLE');return [];}
    const connection=c.options.connectionSeconds,connectionModel=model?.connectionModel;
    if(connection>0&&(!connectionModel?.source.license||weather.temperatureCelsius!<connectionModel.ambientRangeC.min||weather.temperatureCelsius!>connectionModel.ambientRangeC.max)){
      this.issues.add('CONNECTION_ENERGY_MODEL_MISSING');return [];}
    const connectionKwh=(connectionModel?.batteryKw??0)*connection/3600,startSoc=state.soc-connectionKwh/state.capacity.effectiveKwh*100;
    if(startSoc<c.request.constraints.minimumReserveChargePercent||target<=startSoc)return [];
    let temperature:NumericObservation=state.temperature;
    const startAt=new Date(Date.parse(state.at)+connection*1000).toISOString();
    if(connection>0){let thermal:ReturnType<typeof batteryThermalStep>;
      try{thermal=batteryThermalStep(c.vehicle.energyModel!,state.temperature.value,weather.temperatureCelsius!,connection/3600);}catch(error){
        if(error instanceof EnergyDataMissing){this.issues.add(error.code);return [];}throw error;}
      if(thermal.energyKwh>connectionKwh+1e-9){this.issues.add('CONNECTION_ENERGY_BELOW_THERMAL_LOAD');return [];}
      temperature=thermal.temperatureC===null?{origin:'unknown',value:null}:{origin:'estimated',value:thermal.temperatureC,estimatedAt:c.evaluatedAt,validAt:startAt,modelVersion:'connection/'+c.vehicle.energyModel!.version};}
    const states:OptimizerState[]=[];
    for(const evse of station.evses){
      const observed=evse.availability.sourceObservedAt,age=observed===null?Infinity:(Date.parse(c.evaluatedAt)-Date.parse(observed))/1000;
      const effective=age<0||age>c.request.policy.availabilityMaxAgeSeconds?'unknown':evse.availability.reportedStatus;
      if(['out_of_service','blocked','reserved'].includes(effective)||effective==='unknown'&&c.request.policy.unknownAvailability==='exclude')continue;
      if(evse.sharedPowerPoolId){this.issues.add('SHARED_POWER_ALLOCATION_MISSING');continue;}
      for(const connector of evse.connectors){if(connector.powerType!=='dc'||!c.vehicle.supportedConnectors.includes(connector.standard))continue;
        for(const curve of c.vehicle.dcChargingCurves){if(target>curve.curve.points.at(-1)!.socPercent||startSoc<curve.curve.points[0].socPercent)continue;
          signal.throwIfAborted();if(this.remainingMilliseconds()<=0)throw new PlanningDataLimit('PLANNING_DEADLINE');
          if(++this.hardwareEvaluations>c.options.maxTransitions)throw new PlanningDataLimit('CHARGING_HARDWARE_BUDGET');
          if(this.hardwareEvaluations%16===0){await yieldLoop();signal.throwIfAborted();}
          const result=await this.charging.evaluate({vehicle:c.vehicle,station,capacity:state.capacity,evseId:evse.id,connectorId:connector.id,curveId:curve.id,
            hardwarePolicy:c.request.policy.stationDataQuality,
            arrivalSocPercent:startSoc,targetSocPercent:target,qualityPolicy:c.request.policy.vehicleDataQuality??'verified_only',evaluatedAt:c.evaluatedAt,
            batteryTemperatureAtStartC:temperature,ambientTemperatureC:weather.temperatureCelsius,preconditioning:'unknown',sharedPowerAllocation:null,
            timing:{arrivalAt:state.at,connectionSeconds:connection,waitingSeconds:0,blockingPreconditioningSeconds:0}},signal);
          if(result.status==='computation_limit')throw new PlanningDataLimit('CHARGING_COMPUTATION_BUDGET');
          if(result.status!=='estimated'){result.reasons.forEach(r=>this.issues.add(r));continue;}
          try{if(!openThroughout(station,state.at,result.departureAt!)){this.issues.add('STATION_CLOSED_IN_SCENARIO');continue;}}
          catch{this.issues.add('STATION_OPENING_HOURS_INVALID');continue;}
          if(effective==='occupied')this.issues.add('occupied_station_queue_unknown');
          const stop:PlannedChargingStop={id:'stop-'+createHash('sha256').update(checksum([station.id,state.at,target,evse.id,connector.id,curve.id])).digest('hex').slice(0,24),
            hardwareBasis:evse.identityBasis==='catalogue_scenario'?'catalogue_power_scenario':'verified_hardware',
            stationId:station.id,evseId:evse.id,connectorId:connector.id,chargingPathId:curve.chargingPathId,location:station.location,routeDistanceMeters:state.distance,
            detourDistanceMeters:null,detourDrivingSeconds:null,detourBasis:'included_in_road_not_separately_quantified',arrivalChargePercent:state.soc,chargeStartPercent:startSoc,
            connectionBatteryEnergyKwh:connectionKwh,targetChargePercent:target,effectiveBatteryCapacityKwh:state.capacity.effectiveKwh,
            energyDeliveredAtInletKwh:result.energyDeliveredAtInletKwh!,energyStoredKwh:result.energyStoredKwh!,auxiliaryEnergyKwh:result.auxiliaryEnergyKwh!,conversionLossKwh:result.conversionLossKwh!,
            curveReference:{id:curve.id,version:curve.version,coveredSocPercent:{min:curve.curve.points[0].socPercent,max:curve.curve.points.at(-1)!.socPercent},extrapolation:'forbidden'},
            batteryTemperatureAtArrivalC:state.temperature,batteryTemperatureAtChargeStartC:temperature,batteryTemperatureAtDepartureC:result.batteryTemperatureAtDepartureC,thermalModelVersion:model?.temperatureEvolution?.version??null,
            chargingDurationSeconds:result.chargingSeconds!,connectionDurationSeconds:connection,blockingPreconditioningSeconds:0,waiting:{basis:'unknown',seconds:null,justificationId:null},
            arrivalAt:state.at,departureAt:null,availabilitySnapshot:{reportedStatus:evse.availability.reportedStatus,effectiveStatus:effective,sourceObservedAt:observed,
              receivedAt:evse.availability.receivedAt,evaluatedAt:c.evaluatedAt,maxAgeSeconds:c.request.policy.availabilityMaxAgeSeconds,sourceId:evse.availability.source.sourceId}};
          states.push({...state,soc:target,temperature:result.batteryTemperatureAtDepartureC,at:result.departureAt!,
            stops:[...state.stops,{stop,arrivalAt:state.at,departureAt:result.departureAt!}],seconds:(Date.parse(result.departureAt!)-Date.parse(c.request.departureAt))/1000});
        }
      }
    }return states;
  }
}

export function openThroughout(station:ChargingStation,from:string,to:string){
  const hours=station.access.openingHours;if(!hours)return true;
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:hours.timezone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const open=(at:number)=>{const p=Object.fromEntries(formatter.formatToParts(at).map(p=>[p.type,p.value]));
    const date=p.year+'-'+p.month+'-'+p.day,day=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(p.weekday)+1,minute=Number(p.hour)*60+Number(p.minute);
    const intervals=hours.exceptions.find(e=>e.date===date)?.intervals??hours.weekly.find(d=>d.isoWeekday===day)?.intervals??[];
    return intervals.some(i=>minute>=i.fromMinuteOfDay&&minute<i.toMinuteOfDay);};
  const start=Date.parse(from),end=Date.parse(to);if(end-start>86400000)return false;
  for(let at=start;at<end;at+=30000)if(!open(at))return false;return open(Math.max(start,end-1));
}
