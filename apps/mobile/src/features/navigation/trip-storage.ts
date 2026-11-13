import {planningApiRequestSchema} from '@chargeroad/shared';
import type {PlanningApiRequest} from '@chargeroad/shared';
import type {NavigationRoute,SocAnchor,NavigationProgress} from './navigation-core';
export const TRIP_STORAGE_KEY='chargeroad:foreground-trip:v1';
export type TripSnapshot={version:1;id:string;updatedAt:number;status:'active'|'paused';request:PlanningApiRequest;route:NavigationRoute;
 anchor:SocAnchor;progress:NavigationProgress|null;events:{id:string;sequence:number;at:number;planId:string;percent:number;predictedPercent:number;reason:'start'|'correction'|'after_charging'}[]};
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v);
const percent=(v:unknown)=>finite(v)&&(v as number)>=0&&(v as number)<=100;
export function decodeTrip(raw:string,now:number):TripSnapshot|null{
 try{if(raw.length>750000)return null;const data=JSON.parse(raw) as TripSnapshot,r=data.route;
  if(data.version!==1||typeof data.id!=='string'||!finite(data.updatedAt)||data.updatedAt>now+2000||now-data.updatedAt>86400000||!['active','paused'].includes(data.status)||
    !planningApiRequestSchema.safeParse(data.request).success||!r||typeof r.planId!=='string'||!finite(r.distanceMeters)||r.distanceMeters<=0||!Array.isArray(r.segments)||!r.segments.length||r.segments.length>10000||
    typeof r.algorithmVersion!=='string'||!Number.isInteger(r.revision)||r.revision<1||!Array.isArray(r.attributions)||r.attributions.some(a=>typeof a.text!=='string'||typeof a.url!=='string'||!/^https:\/\//.test(a.url))||!Array.isArray(r.stops)||!Array.isArray(r.maneuvers)||!percent(r.reserve)||!percent(r.arrivalTarget)||
    !data.anchor||!percent(data.anchor.percent)||!finite(data.anchor.observedAt)||!percent(data.anchor.percent)||!finite(data.anchor.distance)||data.anchor.distance<0||data.anchor.distance>r.distanceMeters||
    !Array.isArray(data.events)||data.events.length>128)return null;
  let end=0;for(const s of r.segments){if(!finite(s.start)||!finite(s.end)||Math.abs(s.start-end)>.1||s.end<=s.start||!percent(s.startSoc)||!percent(s.endSoc)||!finite(s.seconds)||s.seconds<=0||
    !Array.isArray(s.geometry)||s.geometry.length<2||s.geometry.some(p=>!finite(p.latitude)||Math.abs(p.latitude)>90||!finite(p.longitude)||Math.abs(p.longitude)>180))return null;end=s.end;}
  if(Math.abs(end-r.distanceMeters)>.1||r.stops.some(s=>typeof s.id!=='string'||!finite(s.distance)||s.distance<0||s.distance>r.distanceMeters||!percent(s.targetSoc)||!percent(s.arrivalSoc))||
    r.maneuvers.some(m=>typeof m.instruction!=='string'||!finite(m.startDistanceMeters)||!finite(m.endDistanceMeters))||
    data.events.some((e,i)=>typeof e.id!=='string'||!percent(e.percent)||!percent(e.predictedPercent)||!finite(e.at)||!Number.isInteger(e.sequence)||i>0&&e.sequence<=data.events[i-1].sequence))return null;
  // A restored trip always requires explicit resume and fresh GPS/SOC confirmation.
  return {...data,status:'paused',progress:null,request:planningApiRequestSchema.parse(data.request)};
 }catch{return null;}
}
