import type {Coordinate,PlanningApiRequest} from '@chargeroad/shared';
import type {ClientRoutePlan as RoutePlan} from '../../api/plan-view';

/** heading: device course over ground in degrees (expo-location coords.heading); trusted only while moving. */
export type GpsFix=Coordinate&{timestamp:number;accuracy:number|null;speed:number|null;heading?:number|null};
/** City navigation (2026-11-19). Below HEADING_MIN_SPEED m/s the GPS course is noise; a route piece whose direction differs from
 *  the course by more than WRONG_WAY_DEGREES is the other carriageway / wrong way. An aligned piece is preferred unless it is
 *  ALIGNED_EXTRA_METERS further than the nearest one. */
export const HEADING_MIN_SPEED=2,WRONG_WAY_DEGREES=120,ALIGNED_EXTRA_METERS=60;
const trustedHeading=(fix:GpsFix)=>typeof fix.heading==='number'&&Number.isFinite(fix.heading)&&fix.heading>=0&&typeof fix.speed==='number'&&fix.speed>=HEADING_MIN_SPEED;
const angleDiff=(a:number,b:number)=>{const d=Math.abs(((a-b)%360+360)%360);return d>180?360-d:d;};
export type NavigationRoute={planId:string;revision:number;algorithmVersion:string;distanceMeters:number;
  /** Energy model version of the plan (SOC feedback, 2026-11-19); absent in older saved trips. */
  energyModel?:string;
  attributions:{text:string;url:string;license:string}[];
  /** limit: posted speed limit only (km/h); road: plan road class; climb: rounded ascent (m). Optional: older saved trips lack them. */
  segments:{start:number;end:number;geometry:Coordinate[];startSoc:number;endSoc:number;seconds:number;limit?:number;road?:string;climb?:number}[];
  maneuvers:{instruction:string;type?:number;startDistanceMeters:number;endDistanceMeters:number}[];
  /** seconds (navigation step 1): planned time at the stop (charge+connection+preconditioning+known wait); absent in older saved trips. */
  stops:{id:string;distance:number;arrivalSoc:number;targetSoc:number;seconds?:number}[];reserve:number;arrivalTarget:number};
/** wrongWay: moving against the route direction (trusted course). */
export type NavigationProgress={distance:number;crossTrackMeters:number;soc:number;remainingMeters:number;wrongWay?:boolean;
  remainingDrivingSeconds:number;instruction:string;instructionDistance:number;offRoute:boolean;arrived:boolean;needsChargeConfirmation:boolean};
export type SocAnchor={distance:number;percent:number;observedAt:number;stopId:string|null};
const radians=(n:number)=>n*Math.PI/180;
export function distanceMeters(a:Coordinate,b:Coordinate){const lat=radians((a.latitude+b.latitude)/2);
 return Math.hypot(radians(a.latitude-b.latitude),radians(a.longitude-b.longitude)*Math.cos(lat))*6371000;}
export function compactNavigationRoute(plan:RoutePlan):NavigationRoute{
 return {planId:plan.planId,revision:plan.revision,algorithmVersion:plan.algorithmVersion,distanceMeters:plan.roadRoute.distanceMeters,
  attributions:plan.roadRoute.metadata?.attributions??[],
  ...(plan.energySegments[0]?.modelVersion?{energyModel:plan.energySegments[0].modelVersion}:{}),
  segments:plan.roadRoute.segments.map((s,i)=>({start:s.startDistanceMeters,end:s.endDistanceMeters,geometry:s.geometry,
   startSoc:plan.energySegments[i].startChargePercent,endSoc:plan.energySegments[i].endChargePercent,seconds:s.drivingDurationSeconds,
   ...(s.speedLimitKind==='posted'&&typeof s.speedLimitKph==='number'?{limit:s.speedLimitKph}:{}),...(s.roadClass?{road:s.roadClass}:{}),
   ...(typeof s.elevationGainMeters==='number'?{climb:Math.round(s.elevationGainMeters)}:{})})),
  maneuvers:(plan.roadRoute.metadata?.maneuvers??[]).filter(m=>m.instruction.trim()).map(({instruction,type,startDistanceMeters,endDistanceMeters})=>({instruction,type,startDistanceMeters,endDistanceMeters})),
  stops:plan.chargingStops.map(s=>({id:s.id,distance:s.routeDistanceMeters,arrivalSoc:s.arrivalChargePercent,targetSoc:s.targetChargePercent,
   seconds:s.chargingDurationSeconds+s.connectionDurationSeconds+s.blockingPreconditioningSeconds+(s.waiting.seconds??0)})),
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
 type Candidate={distance:number;crossTrackMeters:number;score:number;headingDiff:number|null};
 let best:Candidate|null=null,aligned:Candidate|null=null;const course=trustedHeading(fix)?fix.heading!:null;
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
   const diff=course===null?null:angleDiff(course,(Math.atan2(dx,dy)*180/Math.PI+360)%360),candidate={distance,crossTrackMeters:cross,score,headingDiff:diff};
   if(!best||score<best.score)best=candidate;if(diff!==null&&diff<=WRONG_WAY_DEGREES&&(!aligned||score<aligned.score))aligned=candidate;offset+=lengths[i];
  }
 }
 return aligned&&best&&aligned.crossTrackMeters<=best.crossTrackMeters+ALIGNED_EXTRA_METERS?aligned:best;
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
  // Town roads: 25 m (1.5 x accuracy); motorway or unknown road class (older saved trips): 50 m (2 x accuracy).
  offRoute:position.crossTrackMeters>offRouteLimit(route,position.distance,fix.accuracy),wrongWay:position.headingDiff!==null&&position.headingDiff>WRONG_WAY_DEGREES,
  arrived:route.distanceMeters-distance<=40&&position.crossTrackMeters<=40,needsChargeConfirmation};
}
function offRouteLimit(route:NavigationRoute,distance:number,accuracy:number|null){
 const road=(route.segments.find(s=>distance<s.end)??route.segments[route.segments.length-1]).road,town=!!road&&road!=='motorway';
 return town?Math.max(25,(accuracy??50)*1.5):Math.max(50,(accuracy??50)*2);
}
/** Replan once a deviation (off route or wrong way) holds for 2 fixes and 4 s or 40 m; one good fix resets it. */
export type DeviationState={since:number;from:Coordinate;fixes:number};
export function trackDeviation(state:DeviationState|null,progress:{offRoute:boolean;wrongWay?:boolean},fix:GpsFix,now:number):[DeviationState|null,boolean]{
 if(!progress.offRoute&&!progress.wrongWay)return [null,false];
 const next={...(state??{since:now,from:{latitude:fix.latitude,longitude:fix.longitude},fixes:0})};next.fixes++;
 return [next,next.fixes>=2&&(now-next.since>=4000||distanceMeters(next.from,fix)>=40)];
}
export function replanFromNavigation(request:PlanningApiRequest,route:NavigationRoute,fix:GpsFix,progress:NavigationProgress,
 id:string,now:number,observedSoc?:number):PlanningApiRequest{
 if(!validFix(fix,now))throw new Error('Yeniden hesaplama için güncel ve kesin GPS konumu bekleniyor.');
 if(observedSoc!==undefined&&(!Number.isFinite(observedSoc)||observedSoc<0||observedSoc>100))throw new Error('Şarj yüzdesi 0–100 arasında olmalı.');
 return {...request,requestId:id,origin:{latitude:fix.latitude,longitude:fix.longitude},departureMode:'now',departureAt:new Date(now+60000).toISOString(),
  startingChargePercent:observedSoc??progress.soc,startingChargeObservedAt:new Date(now).toISOString(),startingChargeSource:observedSoc===undefined?'estimated':'user_input',
  startingChargeEstimate:observedSoc===undefined?{planId:route.planId,revision:route.revision,algorithmVersion:route.algorithmVersion,generatedAt:new Date(now).toISOString()}:undefined,
  // Start the new route on the carriageway the car is on; a previous request's heading is never reused.
  originHeading:trustedHeading(fix)?{degrees:fix.heading!%360,toleranceDegrees:45}:undefined};
}
export const navigationModelSoc=modelSoc;
