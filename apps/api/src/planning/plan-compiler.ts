import {createHash} from 'node:crypto';
import {planningEvaluationSchema,roadRouteSchema} from '@chargeroad/shared';
import type {PlanningContext,OptimizerState,OptimizerOutcome,TransitionPort} from './optimizer-types';
import type {OptimizerSearch,RoadRoute,EnergySegment,PlannedChargingStop,RoutePlan,WeatherForecast} from '@chargeroad/shared';
import {canonicalJson} from '../vehicles/knowledge/knowledge-package';
import {OPTIMIZER_VERSION} from './optimizer-policy';
export const checksum=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
export function compilePlan(context:PlanningContext,state:OptimizerState,search:OptimizerSearch,port:TransitionPort):OptimizerOutcome{
  const {request,vehicle,evaluatedAt}=context,segments:RoadRoute['segments']=[],energy:EnergySegment[]=[],weather:WeatherForecast[]=[],stops:PlannedChargingStop[]=[];
  const segmentTimes:{segmentId:string;departureAt:string;arrivalAt:string}[]=[],stopTimes:{stopId:string;arrivalAt:string;departureAt:string}[]=[];
  let offset=0,unknownTime=false;
  for(const [legIndex,leg] of state.legs.entries()){
    const weatherBySegment=new Map<string,WeatherForecast[]>();
    for(const forecast of leg.weather){const list=weatherBySegment.get(forecast.segmentId)??[];list.push(forecast);weatherBySegment.set(forecast.segmentId,list);}
    for(const [i,road] of leg.route.segments.entries()){
      const id='seg-'+checksum([legIndex,road.id]).slice(0,32),original=leg.energy.segments[i];
      segments.push({...road,id,startDistanceMeters:offset,endDistanceMeters:offset+road.distanceMeters,
        startsAtChargingAccess:i===0&&leg.from!=='origin',endsAtChargingAccess:i===leg.route.segments.length-1&&leg.to!=='destination'});
      segmentTimes.push({segmentId:id,departureAt:original.departureAt!,arrivalAt:original.arrivalAt!});
      const ids=new Map<string,string>();
      for(const w of weatherBySegment.get(road.id)??[]){const queryId='wx-'+checksum([id,w.queryId,w.validAt]).slice(0,32);
        ids.set(w.queryId,queryId);weather.push({...w,segmentId:id,queryId});}
      energy.push({...original,segmentId:id,departureAt:unknownTime?null:original.departureAt,arrivalAt:unknownTime?null:original.arrivalAt,
        weatherQueryIds:original.weatherQueryIds.map(id=>ids.get(id)!)});offset+=road.distanceMeters;
    }
    const item=state.stops.find(s=>Math.abs(s.stop.routeDistanceMeters-offset)<.001);
    if(item){const stop={...item.stop,arrivalAt:unknownTime?null:item.stop.arrivalAt,departureAt:null};
      stops.push(stop);stopTimes.push({stopId:stop.id,arrivalAt:item.arrivalAt,departureAt:item.departureAt});unknownTime=true;}
  }
  const routeId='composed-'+checksum(state.legs.map(l=>[l.route.id,checksum(l.route)])).slice(0,32);
  const source={sourceId:'chargeroad-route-composition',recordId:routeId,version:OPTIMIZER_VERSION,url:null,retrievedAt:evaluatedAt,publishedAt:null,
    license:[...new Set(state.legs.map(l=>l.route.source.license).filter(Boolean))].join(' AND ')||null};
  const road=roadRouteSchema.parse({id:routeId,distanceMeters:offset,drivingDurationSeconds:state.legs.reduce((n,l)=>n+l.route.drivingDurationSeconds,0),
    composition:state.legs.map(l=>({routeId:l.route.id,checksumSha256:checksum(l.route),source:l.route.source,departureAt:l.departureAt})),
    ...(state.legs.some(l=>l.route.metadata)?{metadata:{providerId:'chargeroad-composition',traffic:state.legs.every(l=>l.route.metadata?.traffic==='none')?'none':'unknown',
      departureUsedAt:request.departureAt,originTimeZone:state.legs[0].route.metadata?.originTimeZone??'Europe/Istanbul',
      warnings:[...new Set(state.legs.flatMap(l=>l.route.metadata?.warnings??[]))],
      attributions:[...new Map(state.legs.flatMap(l=>l.route.metadata?.attributions??[]).map(a=>[JSON.stringify(a),a])).values()],
      maneuvers:state.legs.flatMap((l,i)=>{const start=state.legs.slice(0,i).reduce((sum,x)=>sum+x.route.distanceMeters,0);return (l.route.metadata?.maneuvers??[]).map(m=>({...m,startDistanceMeters:m.startDistanceMeters+start,endDistanceMeters:m.endDistanceMeters+start}));}),
      speedLimitKnownMeters:state.legs.reduce((sum,l)=>sum+(l.route.metadata?.speedLimitKnownMeters??0),0),
      speedLimitUnknownMeters:state.legs.reduce((sum,l)=>sum+(l.route.metadata?.speedLimitUnknownMeters??l.route.distanceMeters),0),durationAllocation:'maneuver_weighted',
      usage:state.legs.some(l=>l.route.metadata?.usage==='development_pilot')?'development_pilot':'configured_service'}}:{}),
    segments,segmentationPolicy:{...state.legs[0].route.segmentationPolicy,
      maxDistanceMeters:Math.max(...state.legs.map(l=>l.route.segmentationPolicy.maxDistanceMeters)),maxDurationSeconds:Math.max(...state.legs.map(l=>l.route.segmentationPolicy.maxDurationSeconds))},source});
  const snapshots=[vehicle,context.candidates,...state.legs.flatMap(l=>[l.route,l.weather]),...state.stops.map(s=>s.stop)].map((data,i)=>({sourceId:'plan-snapshot-'+i,
    version:OPTIMIZER_VERSION,checksumSha256:checksum(data),capturedAt:evaluatedAt}));
  const seconds=road.drivingDurationSeconds+stops.reduce((n,s)=>n+s.chargingDurationSeconds+s.connectionDurationSeconds+s.blockingPreconditioningSeconds,0);
  const codeSet=new Set([...port.issues,...state.legs.flatMap(l=>l.energy.warnings)]);
  if(stops.some(s=>s.availabilitySnapshot.effectiveStatus==='unknown'))codeSet.add('unknown_availability');
  if(stops.length)codeSet.add('conditional_queue_no_guaranteed_eta');
  if(stops.some(s=>s.hardwareBasis==='catalogue_power_scenario'))codeSet.add('catalogue_power_scenario_not_verified_hardware');
  if(!search.searchComplete)codeSet.add('search_limited_best_validated_plan');
  if(!context.candidates.metadata.coverage.completeForQuery)codeSet.add('station_coverage_incomplete');
  codeSet.add('bounded_search_no_global_optimum_claim');
  const assumptions=[...new Set(state.legs.flatMap(l=>l.energy.assumptions))].map((code,i)=>({id:'energy-assumption-'+i,code,explanation:code}));
  if(request.startingChargeSource==='estimated')assumptions.push({id:'navigation-soc-estimate',code:'starting_soc_model_estimate',
    explanation:'Starting SOC is a navigation model estimate, not an observed battery reading. Confirm the vehicle display; this value must not be learned as ground truth.'});
  if(stops.length)assumptions.push({id:'queue-scenario',code:'unknown_queue_zero_wait_scenario',explanation:'Zero waiting is a conditional scenario; actual queues and ETA remain unknown.'},
    {id:'connection-policy',code:'connection_seconds_policy_assumption',explanation:'Per-stop connection seconds: '+context.options.connectionSeconds});
  if(vehicle.dataQuality?.quality==='engineering_estimate')assumptions.push({id:'engineering-model',code:'engineering_estimate',explanation:vehicle.dataQuality.verificationNote});
  if(stops.some(s=>s.hardwareBasis==='catalogue_power_scenario'))assumptions.push({id:'station-hardware-scenario',code:'catalogue_power_scenario_not_verified_hardware',
    explanation:'Catalogue DC connector type and rated power are known; grouping, selected voltage-path support and sustained power are assumptions. Confirm them with the operator. Charging durations are conditional.'});
  const plan:RoutePlan={schemaVersion:'1.0.0',planId:request.requestId,revision:1,requestId:request.requestId,supersedes:null,createdAt:evaluatedAt,
    vehicleVariantId:vehicle.vehicleVariantId,vehicleProfileId:vehicle.id,vehicleProfileVersion:vehicle.version,algorithmVersion:OPTIMIZER_VERSION,
    policyId:request.policy.id,policyVersion:request.policy.version,dataSnapshotChecksums:snapshots.map(s=>s.checksumSha256),stationSearch:context.candidates.metadata,
    roadRoute:road,minimumReserveChargePercent:request.constraints.minimumReserveChargePercent,targetArrivalChargePercent:request.constraints.targetArrivalChargePercent,
    estimatedArrivalChargePercent:state.soc,energySegments:energy,chargingStops:stops,estimatedArrivalAt:unknownTime?null:state.at,
    duration:{drivingSeconds:road.drivingDurationSeconds,chargingSeconds:stops.reduce((n,s)=>n+s.chargingDurationSeconds,0),connectionSeconds:stops.reduce((n,s)=>n+s.connectionDurationSeconds,0),
      blockingPreconditioningSeconds:0,waitingSeconds:unknownTime?null:0,totalSeconds:unknownTime?null:seconds},assumptions,
    warnings:[...codeSet].sort().map(code=>({code,explanation:code})),search:{...search,drivingNetBatteryKwh:state.netKwh,scenarioDurationSeconds:seconds},
    scenario:{kind:'conditional_timeline',queueAssumptionSeconds:0,departureAt:request.departureAt,arrivalAt:state.at,totalSeconds:seconds,segmentTimes,stopTimes,
      conditions:stops.length?['unknown_queue_zero_wait_scenario']:[]}};
  const input={request,vehicle,roadCandidates:[road],composedRoadLegs:state.legs.map(l=>l.route),weather,stations:context.candidates.candidates.map(c=>c.station),
    stationSearch:context.candidates.metadata,dataSnapshots:snapshots};
  const evaluated=planningEvaluationSchema.parse({input,result:{status:'planned',plan}});
  return {result:evaluated.result,validationInput:evaluated.input,replay:{context,state}};
}
