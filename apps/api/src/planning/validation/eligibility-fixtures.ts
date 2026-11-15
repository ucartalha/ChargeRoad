import {optimizerWorld} from '../__tests__/optimizer.fixtures';
export const eligibilityCases=['normal','no_dc','wrong_standard','missing_evse','mixed_evse','unknown','stale','missing_observed','occupied','future_observed',
 'private','public_unknown','membership','membership_unknown','catalogue_membership','catalogue_claims','opening_hours','shared_pool','narrow_curve',
 'duplicate_id','invalid_match','endpoint_gap','corridors','limit','truncated','coverage_missing','bad_metadata','empty','direct','reserve_boundary','state_budget','weather_budget','road_budget','cancel','quota','timeout',
 'unknown_excluded','all_unavailable','source_conflict','sole_station','long_route','many_stations','deadline'] as const;
export type EligibilityCase=typeof eligibilityCases[number];
export function eligibilityWorld(kind:EligibilityCase){
 const w=optimizerWorld(false),published=new Date(Date.now()-60000).toISOString(),id='synthetic-eligibility';
 w.candidates.metadata.coverage.completeForQuery=true;
 const original=w.candidates.metadata.coverage.sources[0];
 w.candidates.metadata.coverage.sources=[{...original,sourceId:id,sourceSnapshotComplete:true,geographicCoverageVerified:true,stale:false,qualityExclusions:0,sourceUpdatedAt:published,retrievedAt:w.now}];
 w.candidates.metadata.search.truncated=false;
 for(const c of w.candidates.candidates){
  const source={...c.station.source,sourceId:id,publishedAt:published,retrievedAt:w.now};c.station.source=source;
  c.fieldEvidence={'access.publicAccess':source,'access.membershipRequired':source,lifecycle:source};
  c.station.access.publicAccess=true;c.station.access.membershipRequired=false;
  c.station.access.openingHours={timezone:'UTC',weekly:Array.from({length:7},(_,i)=>({isoWeekday:i+1,intervals:[{fromMinuteOfDay:0,toMinuteOfDay:1440}]})),exceptions:[]};
  for(const e of c.station.evses){e.identityBasis='provider_evse';e.availability.reportedStatus='available';e.availability.source=source;e.availability.sourceObservedAt=w.now;
   for(const k of e.connectors)k.source=source;
  }
 }
 const c=w.candidates.candidates[0],evse=c.station.evses[0];
 switch(kind){
  case 'no_dc':evse.connectors=[{id:'ac-only',powerType:'ac',standard:'type2',maxPowerKw:11,voltageV:230,phases:3,maxCurrentA:16,source:c.station.source}];break;
  case 'wrong_standard':evse.connectors[0].standard='gb_t_dc';break;
  case 'missing_evse':c.station.evses=[];break;
  case 'mixed_evse':{const bad=structuredClone(evse);bad.id='blocked-evse';bad.availability.reportedStatus='blocked';c.station.evses.unshift(bad);break;}
  case 'unknown':evse.availability.reportedStatus='unknown';break;
  case 'stale':evse.availability.sourceObservedAt=new Date(Date.now()-86400000).toISOString();evse.availability.reportedStatus='out_of_service';break;
  case 'missing_observed':evse.availability.sourceObservedAt=null;break;
  case 'occupied':evse.availability.reportedStatus='occupied';break;
  case 'future_observed':evse.availability.sourceObservedAt=new Date(Date.now()+60000).toISOString();break;
  case 'private':c.station.access.publicAccess=false;break;
  case 'public_unknown':c.station.access.publicAccess=null;break;
  case 'membership':c.station.access.membershipRequired=true;break;
  case 'membership_unknown':c.station.access.membershipRequired=null;break;
  case 'catalogue_membership':c.station.access.membershipRequired=true;w.request.policy.stationDataQuality='catalogue_power_scenario';break;
  case 'catalogue_claims':c.station.evses=[];c.connectorClaims=[{sourceConnectorId:'claim',standard:'ccs2',powerType:'dc',maxPowerKw:100,rawType:'synthetic'}];w.request.policy.stationDataQuality='catalogue_power_scenario';break;
  case 'opening_hours':c.station.access.openingHours!.exceptions=[{date:w.request.departureAt.slice(0,10),intervals:[{fromMinuteOfDay:0,toMinuteOfDay:541}]}];break;
  case 'shared_pool':evse.sharedPowerPoolId='pool';c.station.sharedPowerPools=[{id:'pool',ratedTotalPowerKw:100,availablePowerKw:{origin:'unknown',value:null}}];break;
  case 'narrow_curve':w.vehicle.dcChargingCurves[0].curve.points=w.vehicle.dcChargingCurves[0].curve.points.slice(0,2);break;
  case 'duplicate_id':w.candidates.candidates.push(structuredClone(c));break;
  case 'invalid_match':c.routeMatches[0].segmentId='unknown-segment';break;
  case 'endpoint_gap':{const fn=w.roads.routes;const roads={routes:async(...args:Parameters<typeof fn>)=>{const r=await fn(...args);r.data.routes[0].segments[0].geometry[0].latitude+=.1;return r;}};return {...w,roads};}
  case 'corridors':w.options.corridorMeters=[2000,5000,10000];w.candidates.candidates.forEach(c=>c.station.access.membershipRequired=true);break;
  case 'limit':w.options.maxStations=1;break;
  case 'truncated':w.candidates.metadata.search.truncated=true;w.candidates.metadata.coverage.completeForQuery=false;break;
  case 'coverage_missing':w.candidates.metadata.coverage.completeForQuery=false;break;
  case 'bad_metadata':w.candidates.metadata.coverage.completeForQuery=true;w.candidates.metadata.coverage.sources[0].stale=true;break;
  case 'empty':w.candidates.candidates=[];w.candidates.metadata.search.emptyReason='no_matches_in_known_data';break;
  case 'direct':w.request.startingChargePercent=100;w.request.constraints={minimumReserveChargePercent:0,targetArrivalChargePercent:0};break;
  case 'reserve_boundary':w.request.constraints={minimumReserveChargePercent:w.request.startingChargePercent,targetArrivalChargePercent:w.request.startingChargePercent};break;
  case 'sole_station':w.candidates.candidates=[c];w.request.constraints.minimumReserveChargePercent=15;break;
  case 'unknown_excluded':evse.availability.reportedStatus='unknown';w.request.policy.unknownAvailability='exclude';break;
  case 'all_unavailable':{evse.availability.reportedStatus='out_of_service';const bad=structuredClone(evse);bad.id='blocked';bad.availability.reportedStatus='blocked';c.station.evses.push(bad);break;}
  case 'source_conflict':c.station.access.publicAccess=false;c.warnings.push('source_conflict:access.publicAccess');break;
  case 'long_route':{
   const origin=w.request.origin.latitude;for(const location of Object.values(w.locations))location.latitude=origin+(location.latitude-origin)*10;
   w.vehicle.capacity.referenceUsableBatteryKwh=40;const original=w.roads.routes;
   const roads={routes:async(...args:Parameters<typeof original>)=>{const result=await original(...args);for(const r of result.data.routes){r.distanceMeters*=10;r.drivingDurationSeconds*=10;
    r.segments=r.segments.flatMap(s=>Array.from({length:10},(_,i)=>{
     const from=s.geometry[0],to=s.geometry.at(-1)!,point=(t:number)=>({latitude:from.latitude+(to.latitude-from.latitude)*t,longitude:from.longitude+(to.longitude-from.longitude)*t});
     return {...structuredClone(s),id:i?s.id+'-part'+i:s.id,startDistanceMeters:s.startDistanceMeters*10+i*s.distanceMeters,endDistanceMeters:s.startDistanceMeters*10+(i+1)*s.distanceMeters,
      geometry:[point(i/10),point((i+1)/10)],elevationProfile:[{distanceFromStartMeters:0,elevationMeters:0},{distanceFromStartMeters:s.distanceMeters,elevationMeters:0}]};
    }));if(r.metadata){r.metadata.speedLimitKnownMeters*=10;r.metadata.speedLimitUnknownMeters*=10;}}
    return result;}};return {...w,roads};
  }
  case 'many_stations':{
   const locations:Record<string,{latitude:number;longitude:number}>={origin:w.request.origin,destination:w.request.destination},positions:Record<string,number>={origin:0,destination:2};
   w.candidates.candidates=Array.from({length:6},(_,i)=>{const clone=structuredClone(c),id='multi-'+i,position=.5+i/5;
    clone.station.id=id;clone.station.location={latitude:w.request.origin.latitude+(w.request.destination.latitude-w.request.origin.latitude)*position/2,longitude:w.request.origin.longitude};
    locations[id]=clone.station.location;positions[id]=position;clone.routeMatches[0].segmentProgress=position/2;return clone;});
   w.options.maxStates=2;const template=w.route('origin','destination');
   const key=(p:{latitude:number;longitude:number})=>Object.keys(locations).find(k=>Math.abs(locations[k].latitude-p.latitude)<1e-9&&Math.abs(locations[k].longitude-p.longitude)<1e-9)!;
   const roads={routes:async(request:{origin:{latitude:number;longitude:number};destination:{latitude:number;longitude:number}})=>{
    const from=key(request.origin),to=key(request.destination),distance=Math.abs(positions[to]-positions[from])*1000,count=Math.max(1,Math.ceil(distance/1000)),span=distance/count;
    const point=(t:number)=>({latitude:locations[from].latitude+(locations[to].latitude-locations[from].latitude)*t,longitude:locations[from].longitude});
    const route={...structuredClone(template),id:from+'-'+to,distanceMeters:distance,drivingDurationSeconds:distance/1000*60,
     segments:Array.from({length:count},(_,i)=>({...structuredClone(template.segments[0]),id:from+'-'+to+'-'+i,startDistanceMeters:i*span,endDistanceMeters:(i+1)*span,
      distanceMeters:span,drivingDurationSeconds:span/1000*60,geometry:[point(i/count),point((i+1)/count)],elevationProfile:[{distanceFromStartMeters:0,elevationMeters:0},{distanceFromStartMeters:span,elevationMeters:0}]}))};
    return {data:{schemaVersion:'1.0.0' as const,routes:[route]},source:route.source};}};return {...w,roads,locations};
  }
  case 'state_budget':w.options.maxStates=1;break;
  case 'weather_budget':w.options.maxWeatherQueries=1;break;
  case 'road_budget':w.options.maxRoadQueries=1;break;
 }
 return w;
}
