import type {ClientRoutePlan as RoutePlan} from '../../api/plan-view';

/** What the collapsed sheet shows while the planner works or after it answered (pure, testable). */
export type TripState=
  |{phase:'idle'}
  |{phase:'planning';queued:boolean;preview:{distanceMeters:number;drivingSeconds:number}|null}
  |{phase:'planned';plan:RoutePlan;requestedArrival:number|null}
  |{phase:'failed';title:string;message:string};
export type TripActions={cancel:()=>void;reset:()=>void};

export function formatDuration(seconds:number){
  const total=Math.max(0,Math.round(seconds/60)),hours=Math.floor(total/60),minutes=total%60;
  return hours?`${hours} sa${minutes?` ${minutes} dk`:''}`:`${minutes} dk`;
}
export const formatKm=(meters:number)=>`${(meters/1000).toLocaleString('tr-TR',{maximumFractionDigits:meters<100000?1:0})} km`;
/** Total trip time: published duration when the ETA is known, else the conditional scenario. */
export const tripSeconds=(plan:RoutePlan)=>plan.duration.totalSeconds??plan.scenario?.totalSeconds??
  plan.duration.drivingSeconds+plan.duration.chargingSeconds+plan.duration.connectionSeconds;

export type SkylineBar={soc:number;stop:boolean};
/** Battery level along the route sampled into `bars` columns: a saw-tooth that jumps up at every charging stop.
 *  A bar holding a stop shows the post-charge level and is marked. */
export function socSkyline(plan:RoutePlan,bars:number):SkylineBar[]{
  const length=plan.roadRoute.distanceMeters,start=plan.energySegments[0]?.startChargePercent??plan.chargingStops[0]?.arrivalChargePercent??plan.estimatedArrivalChargePercent;
  const points:{d:number;soc:number}[]=[{d:0,soc:start}];
  for(const s of [...plan.chargingStops].sort((a,b)=>a.routeDistanceMeters-b.routeDistanceMeters))
    points.push({d:s.routeDistanceMeters,soc:s.arrivalChargePercent},{d:s.routeDistanceMeters,soc:s.targetChargePercent});
  points.push({d:length,soc:plan.estimatedArrivalChargePercent});
  const at=(d:number)=>{for(let i=points.length-1;i>0;i--){const a=points[i-1],b=points[i];
    if(d>=a.d&&d<=b.d)return b.d===a.d?b.soc:a.soc+(b.soc-a.soc)*(d-a.d)/(b.d-a.d);}return points[0].soc;};
  const width=length/Math.max(1,bars);
  return Array.from({length:bars},(_,i)=>{
    const from=i*width,to=from+width,here=plan.chargingStops.filter(s=>s.routeDistanceMeters>=from&&(s.routeDistanceMeters<to||i===bars-1));
    return {soc:Math.max(0,Math.min(100,here.length?Math.max(...here.map(s=>s.targetChargePercent)):at(from+width/2))),stop:here.length>0};
  });
}

/** One-line plan facts for the summary card. */
export function tripFacts(plan:RoutePlan){
  const stops=plan.chargingStops.length;
  return {duration:formatDuration(tripSeconds(plan)),distance:formatKm(plan.roadRoute.distanceMeters),
    stops:stops?`${stops} şarj molası`:'Şarjsız varış',arrival:`%${Math.round(plan.estimatedArrivalChargePercent)}`,
    charging:formatDuration(plan.duration.chargingSeconds)};
}
