import type {StationCandidateSet,RoadRoute} from '@chargeroad/shared';
export const CATALOGUE_SCENARIO_POLICY={version:'catalogue-scenario/1.0.0',seedAttempts:3,seedProgress:.55,seedReachFraction:.9,seedTargetSoc:100,maxWeatherQueries:30000} as const;
export function candidateProgress(candidate:StationCandidateSet['candidates'][number],routes:RoadRoute[]){
  const match=[...candidate.routeMatches].sort((a,b)=>a.distanceMeters-b.distanceMeters)[0],route=routes.find(r=>r.id===match?.routeId),segment=route?.segments.find(s=>s.id===match.segmentId);
  return route&&segment?(segment.startDistanceMeters+segment.distanceMeters*match.segmentProgress)/route.distanceMeters:0;
}
export function selectCatalogueCandidates(candidates:StationCandidateSet['candidates'],routes:RoadRoute[],limit:number){
  if(!limit)return [];const bins=new Map<number,StationCandidateSet['candidates'][number]>();
  const power=(c:StationCandidateSet['candidates'][number])=>Math.max(0,...c.station.evses.flatMap(e=>e.connectors.filter(p=>p.powerType==='dc').map(p=>p.maxPowerKw??0)));
  const ranked=[...candidates].sort((a,b)=>Number(Math.min(...a.routeMatches.map(m=>m.distanceMeters))>100)-Number(Math.min(...b.routeMatches.map(m=>m.distanceMeters))>100)||power(b)-power(a)||a.station.id.localeCompare(b.station.id));
  for(const c of ranked){const bin=Math.min(limit-1,Math.floor(candidateProgress(c,routes)*limit));if(!bins.has(bin))bins.set(bin,c);}
  const chosen=[...bins.values()],ids=new Set(chosen.map(c=>c.station.id));
  return [...chosen,...ranked.filter(c=>!ids.has(c.station.id))].slice(0,limit);
}
/** An explicit planning resource, never a claim that the source supplied an EVSE grouping. */
export function catalogueStationScenario(raw:StationCandidateSet['candidates'][number]){
  const candidate=structuredClone(raw);if(candidate.station.evses.length)return candidate;
  const source=candidate.fieldEvidence?.connectorClaims??candidate.station.source;
  candidate.station.evses=candidate.connectorClaims.filter(c=>c.powerType==='dc'&&c.maxPowerKw!==null&&c.standard!=='other').map(c=>({
    id:'catalogue-scenario:'+source.sourceId+':'+c.sourceConnectorId,identityBasis:'catalogue_scenario' as const,
    availability:{reportedStatus:'unknown' as const,sourceObservedAt:null,receivedAt:source.retrievedAt,source},sharedPowerPoolId:null,
    connectors:[{id:c.sourceConnectorId,powerType:'dc' as const,standard:c.standard,maxPowerKw:c.maxPowerKw,
      maxCurrentA:c.maxCurrentA??null,outputVoltageRangeV:null,powerEnvelope:[],source,
      ...(source.sourceId==='epdk-stations'?{permissionBasis:'public_service' as const}:{})}]}));
  if(candidate.station.evses.length)candidate.warnings.push('catalogue_power_scenario_not_verified_hardware');
  return candidate;
}
