import type {Coordinate,RoutePlan,PlanningApiRequest} from '@chargeroad/shared';

export type GpsFix=Coordinate&{timestamp:number;accuracy:number|null;speed:number|null};
export type NavigationRoute={planId:string;revision:number;algorithmVersion:string;distanceMeters:number;
  attributions:{text:string;url:string;license:string}[];
  segments:{start:number;end:number;geometry:Coordinate[];startSoc:number;endSoc:number;seconds:number}[];
  maneuvers:{instruction:string;startDistanceMeters:number;endDistanceMeters:number}[];
  stops:{id:string;distance:number;arrivalSoc:number;targetSoc:number}[];reserve:number;arrivalTarget:number};
export type NavigationProgress={distance:number;crossTrackMeters:number;soc:number;remainingMeters:number;
  remainingDrivingSeconds:number;instruction:string;instructionDistance:number;offRoute:boolean;arrived:boolean;needsChargeConfirmation:boolean};
export type SocAnchor={distance:number;percent:number;observedAt:number;stopId:string|null};
const radians=(n:number)=>n*Math.PI/180;
export function distanceMeters(a:Coordinate,b:Coordinate){const lat=radians((a.latitude+b.latitude)/2);
 return Math.hypot(radians(a.latitude-b.latitude),radians(a.longitude-b.longitude)*Math.cos(lat))*6371000;}
export function compactNavigationRoute(plan:RoutePlan):NavigationRoute{
 return {planId:plan.planId,revision:plan.revision,algorithmVersion:plan.algorithmVersion,distanceMeters:plan.roadRoute.distanceMeters,
  attributions:plan.roadRoute.metadata?.attributions??[],
  segments:plan.roadRoute.segments.map((s,i)=>({start:s.startDistanceMeters,end:s.endDistanceMeters,geometry:s.geometry,
   startSoc:plan.energySegments[i].startChargePercent,endSoc:plan.energySegments[i].endChargePercent,seconds:s.drivingDurationSeconds})),
  maneuvers:(plan.roadRoute.metadata?.maneuvers??[]).filter(m=>m.instruction.trim()).map(({instruction,startDistanceMeters,endDistanceMeters})=>({instruction,startDistanceMeters,endDistanceMeters})),
  stops:plan.chargingStops.map(s=>({id:s.id,distance:s.routeDistanceMeters,arrivalSoc:s.arrivalChargePercent,targetSoc:s.targetChargePercent})),
  reserve:plan.minimumReserveChargePercent,arrivalTarget:plan.targetArrivalChargePercent};
}
export function validFix(fix:GpsFix,now:number){return Number.isFinite(fix.latitude)&&Math.abs(fix.latitude)<=90&&Number.isFinite(fix.longitude)&&Math.abs(fix.longitude)<=180&&
 Number.isFinite(fix.timestamp)&&now-fix.timestamp<=15000&&now-fix.timestamp>=-2000&&fix.accuracy!==null&&Number.isFinite(fix.accuracy)&&fix.accuracy>=0&&fix.accuracy<=50;}
function modelSoc(route:NavigationRoute,distance:number,afterBoundary=false){
 const segment=route.segments.find(s=>afterBoundary?distance<s.end-0.01:distance<=s.end)??route.segments.at(-1)!;
 const f=Math.max(0,Math.min(1,(distance-segment.start)/(segment.end-segment.start)));return segment.startSoc+(segment.endSoc-segment.startSoc)*f;
}
/** Projection uses progress continuity so a nearby motorway loop cannot skip kilometres. */
export function locateOnRoute(route:NavigationRoute,fix:GpsFix,previous?:{distance:number;timestamp:number}){
 let best:{distance:number;crossTrackMeters:number;score:number}|null=null;
 const elapsed=previous?Math.max(0,(fix.timestamp-previous.timestamp)/1000):0;
 for(const segment of route.segments){
  if(previous&&(segment.end<previous.distance-150||segment.start>previous.distance+Math.max(300,elapsed*60)))continue;
  const lengths=segment.geometry.slice(1).map((p,i)=>distanceMeters(segment.geometry[i],p)),total=lengths.reduce((a,b)=>a+b,0);let offset=0;
  for(let i=0;i<lengths.length;i++){
   const a=segment.geometry[i],b=segment.geometry[i+1],cos=Math.cos(radians(fix.latitude));
   const ax=radians(a.longitude-fix.longitude)*cos*6371000,ay=radians(a.latitude-fix.latitude)*6371000;
   const dx=radians(b.longitude-a.longitude)*cos*6371000,dy=radians(b.latitude-a.latitude)*6371000,den=dx*dx+dy*dy;
   const t=den?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/den)):0,cross=Math.hypot(ax+t*dx,ay+t*dy);
   const distance=segment.start+(total?(offset+t*lengths[i])/total:0)*(segment.end-segment.start),score=cross+(previous?Math.abs(distance-previous.distance)*.002:0);
   if(!best||score<best.score)best={distance,crossTrackMeters:cross,score};offset+=lengths[i];
  }
 }
 return best;
}
export function navigationProgress(route:NavigationRoute,fix:GpsFix,now:number,anchor:SocAnchor,previous?:{distance:number;timestamp:number}):NavigationProgress|null{
 if(!validFix(fix,now))return null;const position=locateOnRoute(route,fix,previous);if(!position)return null;
 const distance=Math.max(previous?.distance??0,position.distance),nextStop=route.stops.find(s=>s.id!==anchor.stopId&&s.distance>anchor.distance+25);
 // Never credit a planned charge until the driver confirms actual SOC after charging.
 let soc=anchor.percent,begin=anchor.distance;
 for(const s of route.segments){const start=Math.max(begin,s.start),end=Math.min(distance,s.end);if(end>start)soc+=(s.endSoc-s.startSoc)*(end-start)/(s.end-s.start);}
 const needsChargeConfirmation=!!nextStop&&distance>=nextStop.distance-80;
 const next=route.maneuvers.find(m=>m.startDistanceMeters>distance+12);
 return {distance,crossTrackMeters:position.crossTrackMeters,soc:Math.max(0,Math.min(100,soc)),remainingMeters:Math.max(0,route.distanceMeters-distance),
  remainingDrivingSeconds:route.segments.reduce((sum,s)=>sum+(distance<s.end?s.seconds*(1-Math.max(0,(distance-s.start)/(s.end-s.start))):0),0),
  instruction:next?.instruction??'Varış noktasına devam et',instructionDistance:Math.max(0,(next?.startDistanceMeters??route.distanceMeters)-distance),
  offRoute:position.crossTrackMeters>Math.max(50,(fix.accuracy??50)*2),
  arrived:route.distanceMeters-distance<=40&&position.crossTrackMeters<=40,needsChargeConfirmation};
}
export function replanFromNavigation(request:PlanningApiRequest,route:NavigationRoute,fix:GpsFix,progress:NavigationProgress,
 id:string,now:number,observedSoc?:number):PlanningApiRequest{
 if(!validFix(fix,now))throw new Error('Yeniden hesaplama için güncel ve kesin GPS konumu bekleniyor.');
 if(observedSoc!==undefined&&(!Number.isFinite(observedSoc)||observedSoc<0||observedSoc>100))throw new Error('Şarj yüzdesi 0–100 arasında olmalı.');
 return {...request,requestId:id,origin:{latitude:fix.latitude,longitude:fix.longitude},departureMode:'now',departureAt:new Date(now+60000).toISOString(),
  startingChargePercent:observedSoc??progress.soc,startingChargeObservedAt:new Date(now).toISOString(),startingChargeSource:observedSoc===undefined?'estimated':'user_input',
  startingChargeEstimate:observedSoc===undefined?{planId:route.planId,revision:route.revision,algorithmVersion:route.algorithmVersion,generatedAt:new Date(now).toISOString()}:undefined};
}
export const navigationModelSoc=modelSoc;
