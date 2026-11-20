import {energyEvaluationResultSchema,energySegmentObject,energyAuditSchema,usableCapacitySnapshotSchema,numericObservationSchema,checkEnergySegment} from '@chargeroad/shared';

/**
 * Copy-free energy result check (2026-11-20). finish() re-validated every engine result with a full Zod parse, which copies
 * all segments and audit rows (1.45 GB of 6.5 GB Zod allocations in 5 long plans). Returns true only for values the schema
 * accepts: shapes, ranges and strict keys are checked here, the segment rule is the schema's own checkEnergySegment, and the
 * result-level energy balance rules repeat energyEvaluationResultSchema's superRefine expression by expression. UUIDs,
 * timestamps, capacity snapshots and temperature observations use the schema's own leaf schemas. Anything else returns
 * false and the caller runs the full parse, which throws the same error (energy-result-check.spec compares both decisions).
 */
type Rec=Record<string,unknown>;
const RESULT=energyEvaluationResultSchema.shape,SEGMENT=energySegmentObject.shape,AUDIT=energyAuditSchema.shape;
const TOP=new Set(Object.keys(RESULT)),SEG=new Set(Object.keys(SEGMENT)),AUD=new Set(Object.keys(AUDIT));
const BREAKDOWN=new Set(['tractionKwh','baseAuxiliaryKwh','cabinAuxiliaryKwh','batteryThermalKwh','regeneratedKwh']),REASON=new Set(['code','segmentId']);
const STATUS=new Set(['estimated','charge_required','insufficient_data','computation_limit']),MODE=new Set(['physics','reference_corrected']);
const AUDIT_NONNEG=Object.keys(AUDIT).filter(k=>!['segmentId','mode','airDensityKgPerM3','integrationSteps','referenceIds'].includes(k));
const MEMO_LIMIT=20000,strings=new Map<string,boolean>(),objects=new WeakMap<object,boolean>();
function memoString(kind:string,schema:{safeParse(v:unknown):{success:boolean}},value:string){const key=kind+'\0'+value;let ok=strings.get(key);
  if(ok===undefined){ok=schema.safeParse(value).success;if(strings.size>=MEMO_LIMIT)strings.clear();strings.set(key,ok);}return ok;}
function memoObject(schema:{safeParse(v:unknown):{success:boolean}},value:object){let ok=objects.get(value);
  if(ok===undefined){ok=schema.safeParse(value).success;objects.set(value,ok);}return ok;}
const record=(v:unknown):v is Rec=>v!==null&&typeof v==='object'&&!Array.isArray(v);
// A key whose value is undefined is left to Zod: its output omits such keys, the fast path would keep them.
const only=(o:Rec,keys:ReadonlySet<string>)=>{for(const k of Object.keys(o))if(!keys.has(k)||o[k]===undefined)return false;return true;};
const fin=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const nonneg=(v:unknown)=>fin(v)&&v>=0,pos=(v:unknown)=>fin(v)&&v>0,pct=(v:unknown)=>fin(v)&&v>=0&&v<=100;
const id=(v:unknown)=>typeof v==='string'&&v.length>=1&&v.length<=200;
const ids=(v:unknown)=>Array.isArray(v)&&v.every(id),texts=(v:unknown)=>Array.isArray(v)&&v.every(x=>typeof x==='string');
const orNull=(check:(v:unknown)=>boolean)=>(v:unknown)=>v===null||check(v);
const ts=(v:unknown)=>typeof v==='string'&&memoString('ts',SEGMENT.departureAt,v);
function segmentOk(s:unknown){
  if(!record(s)||!only(s,SEG))return false;const b=s.breakdown;
  if(!(id(s.segmentId)&&orNull(ts)(s.departureAt)&&orNull(ts)(s.arrivalAt)&&pct(s.startChargePercent)&&pct(s.endChargePercent)&&pct(s.minimumChargePercent)&&
    fin(s.netBatteryEnergyKwh)&&(b===null||record(b)&&only(b,BREAKDOWN)&&nonneg(b.tractionKwh)&&(b.baseAuxiliaryKwh===undefined||nonneg(b.baseAuxiliaryKwh))&&
      nonneg(b.cabinAuxiliaryKwh)&&nonneg(b.batteryThermalKwh)&&nonneg(b.regeneratedKwh))&&
    record(s.batteryTemperatureAtEndC)&&memoObject(numericObservationSchema,s.batteryTemperatureAtEndC)&&ids(s.consumptionReferenceIds)&&ids(s.weatherQueryIds)&&id(s.modelVersion)))return false;
  let issue=false;checkEnergySegment(s as never,{addIssue:()=>{issue=true;}} as never);return !issue;
}
function auditOk(a:unknown){
  return record(a)&&only(a,AUD)&&id(a.segmentId)&&MODE.has(a.mode as string)&&AUDIT_NONNEG.every(k=>nonneg(a[k]))&&orNull(pos)(a.airDensityKgPerM3)&&
    Number.isInteger(a.integrationSteps)&&(a.integrationSteps as number)>=0&&ids(a.referenceIds);
}
export function energyResultFastCheck(v:unknown):boolean{
  if(!record(v)||!only(v,TOP))return false;
  if(!(STATUS.has(v.status as string)&&typeof v.requestId==='string'&&memoString('uuid',RESULT.requestId,v.requestId)&&id(v.routeId)&&id(v.algorithmVersion)&&
    typeof v.inputChecksumSha256==='string'&&/^[a-f0-9]{64}$/.test(v.inputChecksumSha256)&&id(v.vehicleProfileId)&&id(v.vehicleProfileVersion)&&
    orNull(id)(v.modelId)&&orNull(id)(v.modelVersion)&&orNull(pos)(v.capacityKwh)&&Array.isArray(v.segments)&&Array.isArray(v.audit)&&
    (v.capacitySnapshot===undefined||record(v.capacitySnapshot)&&memoObject(usableCapacitySnapshotSchema,v.capacitySnapshot))&&
    fin(v.netBatteryEnergyKwh)&&orNull(pct)(v.finalChargePercent)&&orNull(pct)(v.minimumChargePercent)&&nonneg(v.completedDistanceMeters)&&ids(v.referenceIds)&&
    orNull(id)(v.partialSegmentId)&&Array.isArray(v.reasons)&&v.reasons.every(r=>record(r)&&only(r,REASON)&&id(r.code)&&orNull(id)(r.segmentId))&&
    texts(v.assumptions)&&texts(v.warnings)))return false;
  const segments=v.segments as Rec[],audit=v.audit as Rec[];
  if(!segments.every(segmentOk)||!audit.every(auditOk))return false;
  // energyEvaluationResultSchema superRefine, same expressions and order.
  const n=(x:unknown)=>x as number;
  if(segments.length!==audit.length||segments.some((s,i)=>s.segmentId!==audit[i]?.segmentId))return false;
  if(Math.abs(segments.reduce((sum,s)=>sum+n(s.netBatteryEnergyKwh),0)-n(v.netBatteryEnergyKwh))>1e-8)return false;
  for(const [i,s] of segments.entries()){
    const a=audit[i];if(!a)continue;
    if(Math.abs(n(a.roadLoadDrawKwh)+n(a.referenceResidualKwh)+n(a.baseAuxiliaryKwh)+n(a.cabinKwh)+n(a.batteryThermalKwh)-n(a.regeneratedKwh)-n(s.netBatteryEnergyKwh))>1e-8)return false;
    if(Math.abs(n(a.availableBrakingKwh)-n(a.frictionBrakingKwh)-n(a.regeneratedKwh)-n(a.recoveryLossKwh))>1e-8)return false;
    if(v.capacityKwh&&Math.abs((n(s.startChargePercent)-n(s.endChargePercent))*n(v.capacityKwh)/100-n(s.netBatteryEnergyKwh))>1e-8)return false;
    if(i&&Math.abs(n(segments[i-1].endChargePercent)-n(s.startChargePercent))>1e-8)return false;
  }
  if(segments.length&&Math.abs(n(segments.at(-1)!.endChargePercent)-n(v.finalChargePercent))>1e-8)return false;
  if(v.status==='estimated'&&v.partialSegmentId!==null)return false;
  return true;
}
