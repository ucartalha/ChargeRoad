import {roadRouteObject,roadSegmentObject,segmentationPolicySchema,sourceReferenceSchema,checkRoadRoute,checkRoadSegment} from '@chargeroad/shared';

/**
 * Copy-free road route check (2026-11-20). normalizeRoadTrip re-validated every normalized route with a full Zod parse, which
 * copies all segments, geometry and elevation points (1.1 GB of 6.5 GB Zod allocations in 5 long plans). Returns true only
 * for values the schema accepts: shapes, ranges and strict keys are checked here; the segment and route rules are the
 * schema's own checkRoadSegment and checkRoadRoute; timestamps, URLs, source references and the segmentation policy use the
 * schema's own leaf schemas. Anything else returns false and the caller runs the full parse, which throws the same error
 * (road-route-check.spec compares both decisions). A key whose value is undefined is left to Zod (its output omits it).
 */
type Rec=Record<string,unknown>;
const ROUTE=roadRouteObject.shape,SEGMENT=roadSegmentObject.shape,META=ROUTE.metadata.unwrap().shape;
const TOP=new Set(Object.keys(ROUTE)),SEG=new Set(Object.keys(SEGMENT)),METADATA=new Set(Object.keys(META));
const COORDINATE=new Set(['latitude','longitude']),ELEVATION=new Set(['distanceFromStartMeters','elevationMeters']),SPEED=new Set(['elapsedSeconds','speedKph']);
const ATTRIBUTION=new Set(['text','url','license']),MANEUVER=new Set(['instruction','type','startDistanceMeters','endDistanceMeters']);
const CLASS=new Set(['motorway','primary','secondary','local','ferry','unknown']),KIND=new Set(['unknown','posted','unlimited','conditional_unresolved','provider_derived']);
const QUALITY=new Set(['verified','modelled','unknown']),TRAFFIC=new Set(['none','historical','live','unknown']),USAGE=new Set(['development_pilot','configured_service']);
const MEMO_LIMIT=20000,strings=new Map<string,boolean>(),objects=new WeakMap<object,boolean>();
function memoString(kind:string,schema:{safeParse(v:unknown):{success:boolean}},value:string){const key=kind+'\0'+value;let ok=strings.get(key);
  if(ok===undefined){ok=schema.safeParse(value).success;if(strings.size>=MEMO_LIMIT)strings.clear();strings.set(key,ok);}return ok;}
function memoObject(schema:{safeParse(v:unknown):{success:boolean}},value:object){let ok=objects.get(value);
  if(ok===undefined){ok=schema.safeParse(value).success;objects.set(value,ok);}return ok;}
const record=(v:unknown):v is Rec=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const only=(o:Rec,keys:ReadonlySet<string>)=>{for(const k of Object.keys(o))if(!keys.has(k)||o[k]===undefined)return false;return true;};
const fin=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const nonneg=(v:unknown)=>fin(v)&&v>=0,pos=(v:unknown)=>fin(v)&&v>0;
const id=(v:unknown)=>typeof v==='string'&&v.length>=1&&v.length<=200;
const texts=(v:unknown)=>Array.isArray(v)&&v.every(x=>typeof x==='string');
const orNull=(check:(v:unknown)=>boolean)=>(v:unknown)=>v===null||check(v);
const ts=(v:unknown)=>typeof v==='string'&&memoString('ts',META.departureUsedAt,v);
const url=(v:unknown)=>typeof v==='string'&&memoString('url',META.attributions.element.shape.url,v);
const source=(v:unknown)=>record(v)&&memoObject(sourceReferenceSchema,v);
const coordinate=(v:unknown)=>record(v)&&only(v,COORDINATE)&&fin(v.latitude)&&v.latitude>=-90&&v.latitude<=90&&fin(v.longitude)&&v.longitude>=-180&&v.longitude<=180;
function rule(check:(value:never,ctx:never)=>void,value:unknown){let issue=false;check(value as never,{addIssue:()=>{issue=true;}} as never);return !issue;}
function segmentOk(s:unknown){
  if(!record(s)||!only(s,SEG))return false;
  const e=s.elevationProfile,p=s.speedProfile;
  return id(s.id)&&Array.isArray(s.sourceEdgeIds)&&s.sourceEdgeIds.length>=1&&s.sourceEdgeIds.every(id)&&nonneg(s.startDistanceMeters)&&pos(s.endDistanceMeters)&&
    pos(s.distanceMeters)&&pos(s.drivingDurationSeconds)&&Array.isArray(s.geometry)&&s.geometry.length>=2&&s.geometry.every(coordinate)&&CLASS.has(s.roadClass as string)&&
    nonneg(s.bearingDegrees)&&(s.bearingDegrees as number)<360&&pos(s.expectedSpeedKph)&&orNull(pos)(s.speedLimitKph)&&
    (s.speedLimitKind===undefined||KIND.has(s.speedLimitKind as string))&&(s.speedLimitSource===undefined||orNull(source)(s.speedLimitSource))&&
    (s.speedLimitRaw===undefined||s.speedLimitRaw===null||typeof s.speedLimitRaw==='string')&&(s.expectedSpeedBasis===undefined||s.expectedSpeedBasis==='travel_time_average')&&
    (s.elevationQuality===undefined||QUALITY.has(s.elevationQuality as string))&&
    (p===undefined||Array.isArray(p)&&p.length>=2&&p.length<=1000&&p.every(x=>record(x)&&only(x,SPEED)&&nonneg(x.elapsedSeconds)&&nonneg(x.speedKph)))&&
    (e===null||Array.isArray(e)&&e.length>=2&&e.every(x=>record(x)&&only(x,ELEVATION)&&nonneg(x.distanceFromStartMeters)&&fin(x.elevationMeters)))&&
    orNull(nonneg)(s.elevationGainMeters)&&orNull(nonneg)(s.elevationLossMeters)&&typeof s.startsAtChargingAccess==='boolean'&&typeof s.endsAtChargingAccess==='boolean'&&
    rule(checkRoadSegment,s);
}
function metadataOk(m:unknown){
  if(m===undefined)return true;if(!record(m)||!only(m,METADATA))return false;
  return id(m.providerId)&&TRAFFIC.has(m.traffic as string)&&ts(m.departureUsedAt)&&typeof m.originTimeZone==='string'&&texts(m.warnings)&&
    Array.isArray(m.attributions)&&m.attributions.every(a=>record(a)&&only(a,ATTRIBUTION)&&typeof a.text==='string'&&url(a.url)&&typeof a.license==='string')&&
    Array.isArray(m.maneuvers)&&m.maneuvers.every(x=>record(x)&&only(x,MANEUVER)&&typeof x.instruction==='string'&&Number.isInteger(x.type)&&
      nonneg(x.startDistanceMeters)&&nonneg(x.endDistanceMeters))&&
    nonneg(m.speedLimitKnownMeters)&&nonneg(m.speedLimitUnknownMeters)&&m.durationAllocation==='maneuver_weighted'&&USAGE.has(m.usage as string);
}
export function roadRouteFastCheck(v:unknown):boolean{
  // Composed routes (composition) stay on the full parse; normalizeRoadTrip never emits them.
  if(!record(v)||!only(v,TOP)||v.composition!==undefined)return false;
  return id(v.id)&&pos(v.distanceMeters)&&pos(v.drivingDurationSeconds)&&Array.isArray(v.segments)&&v.segments.length>=1&&v.segments.every(segmentOk)&&
    record(v.segmentationPolicy)&&memoObject(segmentationPolicySchema,v.segmentationPolicy)&&source(v.source)&&metadataOk(v.metadata)&&rule(checkRoadRoute,v);
}
