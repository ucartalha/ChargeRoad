import type {Coordinate} from '@chargeroad/shared';
import type {NavigationRoute} from './navigation-core';
import {distanceMeters,navigationModelSoc} from './navigation-core';

/** Navigation mode step 1 (2026-11-19): pure helpers for the full-screen navigation UI (camera, split line, maneuver
 *  card, bottom bar). Battery values stay estimates: a planned charge is never credited before the driver confirms it. */

/** Valhalla maneuver type → MaterialCommunityIcons glyph (Valhalla 3.9 DirectionsLeg_Maneuver_Type). Roundabouts turn
 *  counter-clockwise in right-hand traffic (Türkiye). Unknown or missing types fall back to straight. */
const ICONS:Record<number,string>={1:'navigation',2:'navigation',3:'navigation',4:'flag-checkered',5:'flag-checkered',6:'flag-checkered',
  9:'arrow-top-right',10:'arrow-right-top',11:'arrow-right-bottom',12:'arrow-u-right-top',13:'arrow-u-left-top',14:'arrow-left-bottom',15:'arrow-left-top',
  16:'arrow-top-left',18:'arrow-top-right',19:'arrow-top-left',20:'arrow-top-right',21:'arrow-top-left',23:'arrow-top-right',24:'arrow-top-left',
  25:'call-merge',26:'rotate-left',27:'rotate-left',28:'ferry',29:'ferry',37:'call-merge',38:'call-merge'};
export type ManeuverIcon='arrow-up'|'navigation'|'flag-checkered'|'arrow-top-right'|'arrow-right-top'|'arrow-right-bottom'|'arrow-u-right-top'|'arrow-u-left-top'|
  'arrow-left-bottom'|'arrow-left-top'|'arrow-top-left'|'call-merge'|'rotate-left'|'ferry';
export function maneuverIcon(type:number|null|undefined):ManeuverIcon{return (typeof type==='number'&&ICONS[type]?ICONS[type]:'arrow-up') as ManeuverIcon;}

/** "850 m", "1,2 km", "23 km": coarse enough to read at a glance while driving. */
export function formatDistance(meters:number){
  const m=Math.max(0,meters);
  if(m<975)return `${m<100?Math.round(m/10)*10:Math.round(m/50)*50} m`;
  return m<10000?`${(m/1000).toFixed(1).replace('.',',')} km`:`${Math.round(m/1000)} km`;
}
export function formatDuration(seconds:number){
  const minutes=Math.max(1,Math.round(seconds/60)),h=Math.floor(minutes/60),r=minutes%60;
  return h?(r?`${h} sa ${r} dk`:`${h} sa`):`${minutes} dk`;
}
export const formatClock=(at:number)=>{const d=new Date(at);return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;};

export type UpcomingManeuver={instruction:string;type:number|null;distance:number};
/** Same "next" rule as navigationProgress (first maneuver more than 12 m ahead), plus a follow-up shown when it starts within
 *  THEN_WINDOW_METERS after the next one, like "Ardından sola dönün". */
export const THEN_WINDOW_METERS=300;
export function upcomingManeuvers(route:NavigationRoute,distance:number):{next:UpcomingManeuver|null;then:UpcomingManeuver|null}{
  const index=route.maneuvers.findIndex(m=>m.startDistanceMeters>distance+12);if(index<0)return {next:null,then:null};
  const at=(i:number):UpcomingManeuver=>({instruction:route.maneuvers[i].instruction,type:route.maneuvers[i].type??null,distance:Math.max(0,route.maneuvers[i].startDistanceMeters-distance)});
  const following=route.maneuvers[index+1];
  return {next:at(index),then:following&&following.startDistanceMeters-route.maneuvers[index].startDistanceMeters<=THEN_WINDOW_METERS?at(index+1):null};
}

const radians=(n:number)=>n*Math.PI/180;
export function bearingDegrees(a:Coordinate,b:Coordinate){
  const y=Math.sin(radians(b.longitude-a.longitude))*Math.cos(radians(b.latitude));
  const x=Math.cos(radians(a.latitude))*Math.sin(radians(b.latitude))-Math.sin(radians(a.latitude))*Math.cos(radians(b.latitude))*Math.cos(radians(b.longitude-a.longitude));
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}
/** Point at a route distance, with the same per-segment scaling as locateOnRoute (geometry length → segment distance). */
function locate(route:NavigationRoute,distance:number){
  const d=Math.max(0,Math.min(route.distanceMeters,distance));
  const si=Math.max(0,route.segments.findIndex(s=>d<=s.end)),segment=route.segments[si===-1?route.segments.length-1:si];
  const g=segment.geometry,lengths=g.slice(1).map((p,i)=>distanceMeters(g[i],p)),total=lengths.reduce((a,b)=>a+b,0);
  let target=total*(segment.end>segment.start?(d-segment.start)/(segment.end-segment.start):0),i=0;
  while(i<lengths.length-1&&target>lengths[i]){target-=lengths[i];i++;}
  const t=lengths[i]?Math.max(0,Math.min(1,target/lengths[i])):0,a=g[i],b=g[i+1]??a;
  return {segment:si,vertex:i,point:{latitude:a.latitude+(b.latitude-a.latitude)*t,longitude:a.longitude+(b.longitude-a.longitude)*t}};
}
/** Driven part, remaining part and the vehicle point snapped to the line; bearing looks BEARING_LOOKAHEAD_METERS ahead so a
 *  short kink does not swing the map. */
export const BEARING_LOOKAHEAD_METERS=30;
export function splitRoute(route:NavigationRoute,distance:number){
  const all:Coordinate[]=[],starts:number[]=[];
  for(const [i,s] of route.segments.entries()){starts.push(all.length);for(const [j,p] of s.geometry.entries())if(!(i>0&&j===0))all.push(p);}
  if(distance<=0)return {traveled:[all[0]],remaining:all,point:all[0],bearing:bearingDegrees(all[0],locate(route,BEARING_LOOKAHEAD_METERS).point)};
  if(distance>=route.distanceMeters){const last=all[all.length-1];return {traveled:all,remaining:[last],point:last,bearing:bearingDegrees(locate(route,route.distanceMeters-BEARING_LOOKAHEAD_METERS).point,last)};}
  const here=locate(route,distance),cut=starts[here.segment]+here.vertex+1;
  const ahead=locate(route,Math.min(route.distanceMeters,distance+BEARING_LOOKAHEAD_METERS)).point;
  const from=distanceMeters(here.point,ahead)>1?here.point:locate(route,Math.max(0,distance-BEARING_LOOKAHEAD_METERS)).point;
  return {traveled:[...all.slice(0,cut),here.point],remaining:[here.point,...all.slice(cut)],point:here.point,bearing:bearingDegrees(from,ahead)};
}

/** Follow camera: closer in town, further out on the motorway (speed in m/s; unknown speed = town view). */
export function followCamera(center:Coordinate,heading:number,speed:number|null|undefined){
  const s=typeof speed==='number'&&Number.isFinite(speed)&&speed>0?speed:0;
  return {center,heading,pitch:55,zoom:s<8?17.5:s<17?16.5:s<25?15.6:14.8};
}

/** Estimated SOC at the next unconfirmed charging stop, else at arrival: current estimate plus the plan's driving deltas only
 *  (charging discontinuities between segments are excluded, as in navigationProgress). */
export function socOutlook(route:NavigationRoute,progress:{distance:number;soc:number},confirmedStopId:string|null){
  const stop=route.stops.find(s=>s.id!==confirmedStopId&&s.distance>progress.distance+25),until=stop?stop.distance:route.distanceMeters;
  let soc=progress.soc;
  for(const s of route.segments){const a=Math.max(progress.distance,s.start),b=Math.min(until,s.end);if(b>a)soc+=(s.endSoc-s.startSoc)*(b-a)/(s.end-s.start);}
  const bounded=Math.max(0,Math.min(100,soc));
  return stop?{kind:'stop' as const,distance:stop.distance-progress.distance,soc:bounded,targetSoc:stop.targetSoc}:{kind:'arrival' as const,distance:until-progress.distance,soc:bounded,targetSoc:null};
}

/** Remaining driving time plus the planned time at unconfirmed stops still ahead (for the arrival clock). */
export function remainingTripSeconds(route:NavigationRoute,progress:{distance:number;remainingDrivingSeconds:number},confirmedStopId:string|null){
  return progress.remainingDrivingSeconds+route.stops.filter(s=>s.id!==confirmedStopId&&s.distance>progress.distance+25).reduce((sum,s)=>sum+(s.seconds??0),0);
}

/** HUD (navigation step 1b): everything below reads the plan already on the phone; nothing is fetched or invented. */
const segmentAt=(route:NavigationRoute,distance:number)=>route.segments.find(s=>distance<s.end)??route.segments[route.segments.length-1];
/** Posted limits only; provider-derived or unknown limits are never shown as a sign. */
export function speedLimitAt(route:NavigationRoute,distance:number){return segmentAt(route,distance).limit??null;}
export const SPEED_TOLERANCE_KPH=5;
export function speedState(speed:number|null|undefined,limit:number|null){
  if(typeof speed!=='number'||!Number.isFinite(speed)||speed<0)return {kph:null,over:false};
  const kph=Math.round(speed*3.6);return {kph,over:limit!==null&&kph>limit+SPEED_TOLERANCE_KPH};
}
const ROADS:Record<string,string>={motorway:'Otoyol',primary:'Ana yol',secondary:'Tali yol',local:'Yerel yol',ferry:'Feribot'};
export function roadLabel(route:NavigationRoute,distance:number){const road=segmentAt(route,distance).road;return road&&ROADS[road]?ROADS[road]:null;}
/** Ascent (m) in the next windowMeters, prorated by segment overlap. */
export const CLIMB_WINDOW_METERS=10000,CLIMB_NOTICE_METERS=150;
export function climbAhead(route:NavigationRoute,distance:number,windowMeters=CLIMB_WINDOW_METERS){
  let sum=0;const end=distance+windowMeters;
  for(const s of route.segments){const a=Math.max(distance,s.start),b=Math.min(end,s.end);if(b>a&&s.climb)sum+=s.climb*(b-a)/(s.end-s.start);}
  return Math.round(sum);
}
/** Estimate vs plan at the same distance (positive = better than planned), reserve line and next-stop arrival estimate. */
export function socStrip(route:NavigationRoute,progress:{distance:number;soc:number},confirmedStopId:string|null){
  const outlook=socOutlook(route,progress,confirmedStopId);
  const confirmed=route.stops.findIndex(s=>s.id===confirmedStopId),skipped=route.stops.some((s,i)=>i>confirmed&&s.distance<=progress.distance+25);
  return {soc:progress.soc,reserve:route.reserve,planDelta:skipped?null:progress.soc-navigationModelSoc(route,progress.distance),nextStopSoc:outlook.kind==='stop'?outlook.soc:null};
}
export const STOP_CARD_METERS=20000;
export function stopCard(route:NavigationRoute,progress:{distance:number;soc:number},confirmedStopId:string|null){
  const index=route.stops.findIndex(s=>s.id!==confirmedStopId&&s.distance>progress.distance+25);
  if(index<0||route.stops[index].distance-progress.distance>STOP_CARD_METERS)return null;
  const stop=route.stops[index],outlook=socOutlook(route,progress,confirmedStopId);
  return {index:index+1,id:stop.id,distance:stop.distance-progress.distance,arrivalSoc:outlook.soc,targetSoc:stop.targetSoc,seconds:stop.seconds??null};
}
export type TimelineStop={id:string;index:number;status:'passed'|'next'|'later';distance:number;plannedArrivalSoc:number;targetSoc:number;seconds:number|null};
export function stopTimeline(route:NavigationRoute,progress:{distance:number},confirmedStopId:string|null):TimelineStop[]{
  let next=false;
  return route.stops.map((s,i)=>{const passed=s.id===confirmedStopId||s.distance<=progress.distance+25,status:TimelineStop['status']=passed?'passed':next?'later':(next=true,'next');
    return {id:s.id,index:i+1,status,distance:s.distance-progress.distance,plannedArrivalSoc:s.arrivalSoc,targetSoc:s.targetSoc,seconds:s.seconds??null};});
}
