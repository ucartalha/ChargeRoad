/** OFFLINE PROOF ONLY. No production module imports this file. No single-flight/provider/session caching. */
import {types} from 'node:util';
import type {EnergyEvaluationResult} from '@chargeroad/shared';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {ENERGY_ALGORITHM_VERSION,ENERGY_POLICY} from '../../energy/energy-policy';

export interface ProofStats {logicalCalls:number;physicalCalls:number;hits:number;misses:number;unsupported:number;ineligible:number;yielding:number;
 writes:number;evictions:number;entriesPeak:number;retainedUnits:number;retainedPeak:number;nodesPeak:number;fieldReads:number;
 keyMs:number;lookupMs:number;cloneReadMs:number;cloneWriteMs:number;entryMs:number;evictionMs:number;engineMs:number;}
export const freshProofStats=():ProofStats=>({logicalCalls:0,physicalCalls:0,hits:0,misses:0,unsupported:0,ineligible:0,yielding:0,writes:0,evictions:0,
 entriesPeak:0,retainedUnits:0,retainedPeak:0,nodesPeak:0,fieldReads:0,keyMs:0,lookupMs:0,cloneReadMs:0,cloneWriteMs:0,entryMs:0,evictionMs:0,engineMs:0});
function ordinaryObjectPrototype(p:object|null){
 if(p===Object.prototype)return true;if(p===null||Object.getPrototypeOf(p)!==null)return false;
 const c=Object.getOwnPropertyDescriptor(p,'constructor');return !!c&&'value'in c&&typeof c.value==='function'&&Function.prototype.toString.call(c.value)===Function.prototype.toString.call(Object);
}
function ordinaryArrayPrototype(p:object|null){
 if(p===Array.prototype)return true;if(p===null||!Array.isArray(p)||!ordinaryObjectPrototype(Object.getPrototypeOf(p)))return false;
 const c=Object.getOwnPropertyDescriptor(p,'constructor');return !!c&&'value'in c&&typeof c.value==='function'&&Function.prototype.toString.call(c.value)===Function.prototype.toString.call(Array);
}
/** Already-validated plain data only; preserve the actual realm/prototype and alias topology. */
export function cloneProofPlain<T>(value:T):T{
 const seen=new Map<object,unknown>();const copy=(v:unknown):unknown=>{
  if(v===null||typeof v!=='object')return v;const existing=seen.get(v);if(existing)return existing;
  const result=Array.isArray(v)?[]:Object.create(Object.getPrototypeOf(v));if(Array.isArray(v))Object.setPrototypeOf(result,Object.getPrototypeOf(v));seen.set(v,result);
  for(const key of Object.keys(v))Object.defineProperty(result,key,{value:copy(Object.getOwnPropertyDescriptor(v,key)!.value),enumerable:true,writable:true,configurable:true});return result;
 };return copy(value) as T;
}

/** Typed canonical STRING key: no cryptographic hash collision assumption on the lookup path. */
export function proofCanonical(value:unknown,maxChars=1024*1024,ownership=false,maxNodes=50000){
 const chunks:string[]=[],ancestors=new Set<object>();let nodes=0,fields=0,chars=0;
 const put=(v:string)=>{chars+=v.length;if(chars>maxChars)throw Error('proof_key_size');chunks.push(v);};
 const encode=(v:unknown,depth:number)=>{
  if(++nodes>maxNodes||depth>100)throw Error('proof_key_complexity');
  if(v===undefined){put('u;');return;}if(v===null){put('n;');return;}
  if(typeof v==='string'){put('s'+JSON.stringify(v)+';');return;}
  if(typeof v==='number'){if(!Number.isFinite(v))throw Error('proof_nonfinite');put('d'+(Object.is(v,-0)?'-0':String(v))+';');return;}
  if(typeof v==='boolean'){put(v?'t;':'f;');return;}
  if(typeof v!=='object'||types.isProxy(v)||Object.getOwnPropertySymbols(v).length)throw Error('proof_nonplain');
  if(ancestors.has(v))throw Error('proof_cycle');ancestors.add(v);
  const proto=Object.getPrototypeOf(v),array=Array.isArray(v);
  if(array?!ordinaryArrayPrototype(proto):!ordinaryObjectPrototype(proto)&&(ownership||proto!==null))throw Error('proof_prototype');
  const names=Object.getOwnPropertyNames(v),keys=array?names.filter(k=>k!=='length'):names.sort();
  if(array&&(keys.length!==v.length||keys.some((k,i)=>k!==String(i))))throw Error('proof_sparse_or_extra_array');
  put(array?'[':proto===null?'N{':'O{');
  for(const key of keys){const d=Object.getOwnPropertyDescriptor(v,key);if(!d||!d.enumerable||!('value'in d)||ownership&&(!d.writable||!d.configurable))throw Error('proof_accessor');
   fields++;if(!array)put(JSON.stringify(key)+':');encode(d.value,depth+1);}
  put(array?']':'}');ancestors.delete(v);
 };
 encode(value,0);return {key:chunks.join(''),nodes,fields};
}
function freezeOwned(v:unknown){if(v&&typeof v==='object'){for(const child of Object.values(v))freezeOwned(child);Object.freeze(v);}return v;}
export function ownedEnergyCopy(value:EnergyEvaluationResult){
 // Preserve -0, undefined, ordinary realm prototypes and alias topology.
 // Reject special graphs rather than silently converting a caller's domain object.
 const encoding=proofCanonical(value,1024*1024,true);return {value:cloneProofPlain(value),encoding};
}
interface Entry {value:EnergyEvaluationResult;units:number;nodes:number;}
export class ProofEnergyReuse {
 readonly stats=freshProofStats();private readonly entries=new Map<string,Entry>();private closed=false;private nodes=0;
 constructor(private readonly engine:EnergyConsumptionEngine,private readonly namespace:string,private readonly metrics=false,
  private readonly capacity=16,private readonly maxRetainedUnits=2*1024*1024,private readonly clockKind:'stock'|'custom'='stock'){
  if(!Number.isInteger(capacity)||capacity<1||capacity>64||maxRetainedUnits<1||maxRetainedUnits>8*1024*1024)throw Error('proof_invalid_bound');
 }
 private timed<T>(name:'keyMs'|'lookupMs'|'cloneReadMs'|'cloneWriteMs'|'entryMs'|'evictionMs',work:()=>T):T{
  if(!this.metrics)return work();const start=performance.now();try{return work();}finally{this.stats[name]+=performance.now()-start;}
 }
 evaluate(raw:unknown,signal:AbortSignal,absoluteDeadline=Infinity):Promise<EnergyEvaluationResult>{
  this.stats.logicalCalls++;
  // Never turn an already-aborted native call into a hit; keep the native exception identity.
  if(signal.aborted||this.closed||this.clockKind!=='stock')return this.compute(raw,signal,null);
  let key:string;try{key=this.timed('keyMs',()=>{const k=proofCanonical(raw);if(this.metrics)this.stats.fieldReads+=k.fields;
   return this.namespace+'\0'+ENERGY_ALGORITHM_VERSION+'\0'+k.key;});}catch{this.stats.unsupported++;return this.compute(raw,signal,null);}
  const entry=this.timed('lookupMs',()=>this.entries.get(key));
  // Boundary headroom is a conservative hit bypass, not a proof of production deadline equivalence.
  if(entry&&absoluteDeadline-performance.now()>5&&!signal.aborted){
   const copy=this.timed('cloneReadMs',()=>cloneProofPlain(entry.value));
   if(absoluteDeadline-performance.now()>0&&!signal.aborted){this.stats.hits++;return Promise.resolve(copy);}
  }
  this.stats.misses++;return this.compute(raw,signal,key);
 }
 private compute(raw:unknown,signal:AbortSignal,key:string|null){
  this.stats.physicalCalls++;const start=this.metrics?performance.now():0,pending=this.engine.evaluate(raw,signal);
  // Return the ORIGINAL promise. The write observer must not add a promise chain to
  // the caller's await path, replace exceptions or share work between callers.
  void pending.then(result=>{
   if(this.metrics)this.stats.engineMs+=performance.now()-start;
   if(key===null||this.closed||signal.aborted)return;
   const steps=result.audit.reduce((n,a)=>n+a.integrationSteps,0);
   if(result.status!=='estimated'||result.partialSegmentId||result.reasons.length||!result.capacitySnapshot||!result.segments.length||
     result.segments.some(s=>s.batteryTemperatureAtEndC.value===null)||steps<=0){this.stats.ineligible++;return;}
   // Reusing work that yielded would skip expected cancellation opportunities. This
   // conservative experiment therefore NEVER caches those expensive evaluations.
   if(steps>=ENERGY_POLICY.yieldEvery){this.stats.yielding++;return;}
   try{const measured=this.timed('cloneWriteMs',()=>{const owned=ownedEnergyCopy(result);freezeOwned(owned.value);return {encoded:owned.encoding,value:owned.value};});
    const units=2*(key.length+measured.encoded.key.length),nodes=measured.encoded.nodes;
    if(units>this.maxRetainedUnits)return;
    this.timed('entryMs',()=>{
     const previous=this.entries.get(key);if(previous){this.stats.retainedUnits-=previous.units;this.nodes-=previous.nodes;this.entries.delete(key);}
     this.timed('evictionMs',()=>{while(this.entries.size>=this.capacity||this.stats.retainedUnits+units>this.maxRetainedUnits){
      const oldest=this.entries.keys().next().value!;const value=this.entries.get(oldest)!;this.entries.delete(oldest);this.stats.retainedUnits-=value.units;this.nodes-=value.nodes;this.stats.evictions++;}});
     this.entries.set(key,{value:measured.value,units,nodes});this.stats.retainedUnits+=units;this.nodes+=nodes;this.stats.writes++;
     this.stats.entriesPeak=Math.max(this.stats.entriesPeak,this.entries.size);this.stats.retainedPeak=Math.max(this.stats.retainedPeak,this.stats.retainedUnits);this.stats.nodesPeak=Math.max(this.stats.nodesPeak,this.nodes);
    });
   }catch{this.stats.unsupported++;} // Diagnostics/unsupported ownership must not replace the native result.
  },()=>{if(this.metrics)this.stats.engineMs+=performance.now()-start;});
  return pending;
 }
 dispose(){this.closed=true;this.entries.clear();this.stats.retainedUnits=0;this.nodes=0;}
}
