import type {StationCandidateSet,RoadRoute} from '@chargeroad/shared';
// 1.2.0 (2026-11-17): candidate selection is access-aware (selectAccessibleCandidates, STATION_ACCESS_POLICY).
// seedReachFractions (optimizer 1.5.0): far strategy first (= seedReachFraction), then a nearer one.
export const CATALOGUE_SCENARIO_POLICY={version:'catalogue-scenario/1.2.0',seedAttempts:3,seedProgress:.55,seedReachFraction:.9,seedReachFractions:[.9,.6],maxWeatherQueries:30000} as const;
export function candidateProgress(candidate:StationCandidateSet['candidates'][number],routes:RoadRoute[]){
  const match=[...candidate.routeMatches].sort((a,b)=>a.distanceMeters-b.distanceMeters)[0],route=routes.find(r=>r.id===match?.routeId),segment=route?.segments.find(s=>s.id===match.segmentId);
  return route&&segment?(segment.startDistanceMeters+segment.distanceMeters*match.segmentProgress)/route.distanceMeters:0;
}
/** station-access/1.0.0 (2026-11-17, user decision): a candidate's access detour is measured in travel direction
 *  (approachMeters before the station -> station -> approachMeters after). A station next to the motorway can still cost a
 *  long U-turn when it is in the other direction's service area; such stations stay out when an acceptable one exists.
 *  station-access/1.1.0 (2026-11-19, optimizer 1.7.0): a bin without an acceptable station keeps its smallest detour only up
 *  to maxFallbackDetourSeconds; beyond it the station only fills free slots last (İzmir reference: a 90 km detour was seeded). */
export const STATION_ACCESS_POLICY={version:'station-access/1.1.0',maxDetourMeters:3000,maxDetourSeconds:180,maxFallbackDetourSeconds:900,perBin:3,extendedPerBin:6,
  concurrency:4,approachMeters:1000} as const;
async function pooled<T>(tasks:(()=>Promise<T>)[],limit:number):Promise<T[]>{
  const out=new Array<T>(tasks.length);let next=0;
  await Promise.all(Array.from({length:Math.min(limit,tasks.length)},async()=>{while(next<tasks.length){const i=next++;out[i]=await tasks[i]();}}));
  return out;
}
export interface StationAccessMeasure {additionalMeters:number;additionalSeconds:number;}
type Candidate=StationCandidateSet['candidates'][number];
const dcPower=(c:Candidate)=>Math.max(0,...c.station.evses.flatMap(e=>e.connectors.filter(p=>p.powerType==='dc').map(p=>p.maxPowerKw??0)));
const rankCandidates=(candidates:readonly Candidate[])=>[...candidates].sort((a,b)=>Number(Math.min(...a.routeMatches.map(m=>m.distanceMeters))>100)-
  Number(Math.min(...b.routeMatches.map(m=>m.distanceMeters))>100)||dcPower(b)-dcPower(a)||a.station.id.localeCompare(b.station.id));
export const accessAcceptable=(m:StationAccessMeasure|null|undefined)=>!!m&&m.additionalMeters<=STATION_ACCESS_POLICY.maxDetourMeters&&
  m.additionalSeconds<=STATION_ACCESS_POLICY.maxDetourSeconds;
const fallbackAcceptable=(m:StationAccessMeasure|null|undefined)=>!!m&&m.additionalSeconds<=STATION_ACCESS_POLICY.maxFallbackDetourSeconds;
/** One candidate per progress bin like selectCatalogueCandidates, but each bin keeps the best-ranked station whose measured
 *  access is acceptable; if none in the bin is, the smallest measured detour within maxFallbackDetourSeconds (a plan must stay
 *  possible). Stations over that ceiling are added last, only while the limit leaves room. */
export async function selectAccessibleCandidates(candidates:readonly Candidate[],routes:RoadRoute[],limit:number,
  measure:(candidate:Candidate)=>Promise<StationAccessMeasure|null>):Promise<{chosen:Candidate[];access:Record<string,StationAccessMeasure|null>}>{
  const access:Record<string,StationAccessMeasure|null>={};if(!limit)return {chosen:[],access};
  const ranked=rankCandidates(candidates),bins=new Map<number,Candidate[]>();
  for(const c of ranked){const bin=Math.min(limit-1,Math.floor(candidateProgress(c,routes)*limit));(bins.get(bin)??bins.set(bin,[]).get(bin)!).push(c);}
  const chosen:Candidate[]=[],detour=(c:Candidate)=>access[c.station.id]?.additionalSeconds??Infinity,order=[...bins.keys()].sort((a,b)=>a-b);
  const run=async(c:Candidate)=>{if(!(c.station.id in access))access[c.station.id]=await measure(c);};
  // First pass: perBin candidates of every bin, measured with bounded concurrency.
  await pooled(order.flatMap(bin=>bins.get(bin)!.slice(0,STATION_ACCESS_POLICY.perBin).map(c=>()=>run(c))),STATION_ACCESS_POLICY.concurrency);
  // Second pass, only for bins without an acceptable station: look deeper, one by one, until one is acceptable.
  const tried=new Map(order.map(bin=>[bin,bins.get(bin)!.slice(0,STATION_ACCESS_POLICY.perBin)]));
  await pooled(order.filter(bin=>!tried.get(bin)!.some(c=>accessAcceptable(access[c.station.id]))).map(bin=>async()=>{
    for(const c of bins.get(bin)!.slice(STATION_ACCESS_POLICY.perBin,STATION_ACCESS_POLICY.extendedPerBin)){
      tried.get(bin)!.push(c);await run(c);if(accessAcceptable(access[c.station.id]))break;}
  }),STATION_ACCESS_POLICY.concurrency);
  for(const bin of order){const list=tried.get(bin)!;
    const pick=list.find(c=>accessAcceptable(access[c.station.id]))??[...list].filter(c=>access[c.station.id]).sort((a,b)=>detour(a)-detour(b))[0]??list[0];
    if(!access[pick.station.id]||fallbackAcceptable(access[pick.station.id]))chosen.push(pick);}
  const taken=new Set(chosen.map(c=>c.station.id)),rest=ranked.filter(c=>!taken.has(c.station.id));
  const measured=rest.filter(c=>c.station.id in access);
  const near=(c:Candidate)=>!accessAcceptable(access[c.station.id])&&(!access[c.station.id]||fallbackAcceptable(access[c.station.id]));
  const fill=[...measured.filter(c=>accessAcceptable(access[c.station.id])),...measured.filter(near).sort((a,b)=>detour(a)-detour(b)),
    ...rest.filter(c=>!(c.station.id in access)),...measured.filter(c=>access[c.station.id]&&!fallbackAcceptable(access[c.station.id])).sort((a,b)=>detour(a)-detour(b))];
  return {chosen:[...chosen,...fill].slice(0,limit),access};
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
