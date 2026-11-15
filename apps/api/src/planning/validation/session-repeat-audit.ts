/** Validation-only counters/hash index. NEVER returns a saved result or skips work. */
import {createHash} from 'node:crypto';
export const AUDIT_OPERATIONS=['sample_weather','road_provider','weather_provider','energy_evaluate','charging_evaluate','session_drive','session_charge','session_route','session_weather'] as const;
export type AuditOperation=typeof AUDIT_OPERATIONS[number];
export interface RepeatStats {calls:number;fulfilled:number;thrown:number;exactArgumentRepeats:number;repeatedFulfilledDataInputs:number;outputConflicts:number;mutatedInputs:number;
 operationMs:number;fingerprintMs:number;keySkipped:number;evictions:number;keysPeak:number;}
type Entry={outputHash:string|null};
export function exactAuditKey(namespace:string,operation:AuditOperation,data:unknown,maxBytes=4*1024*1024){
 let nodes=0;const encode=(value:unknown,depth=0):unknown=>{
  if(++nodes>200000||depth>128)throw new Error('Diagnostic key size');
  if(value===null)return ['null'];if(value===undefined)return ['undefined'];
  if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('Nonfinite diagnostic input');return ['number',Object.is(value,-0)?'-0':String(value)];}
  if(typeof value==='string'||typeof value==='boolean')return [typeof value,value];
  if(typeof value!=='object'||Object.getOwnPropertySymbols(value).length)throw new Error('Unsupported diagnostic input');
  if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)throw new Error('Non-data diagnostic input');
  const read=(key:string)=>{const d=Object.getOwnPropertyDescriptor(value,key);if(!d)return ['hole'];if(!('value'in d))throw new Error('Accessor diagnostic input');return encode(d.value,depth+1);};
  if(Array.isArray(value)){
   if(value.length>200000||Object.keys(value).some(k=>!/^\d+$/.test(k)))throw new Error('Non-data diagnostic array');
   return ['array',Array.from({length:value.length},(_,i)=>read(String(i)))];
  }
  return ['object',Object.keys(value).sort().map(key=>[key,read(key)])];
 };
 const serialized=JSON.stringify([namespace,operation,encode(data)]);if(Buffer.byteLength(serialized)>maxBytes)throw new Error('Diagnostic key bytes');
 return createHash('sha256').update(serialized).digest('hex');
}
export class SessionRepeatAudit {
 private readonly seen=new Map<AuditOperation,Map<string,Entry>>();
 readonly stats=Object.fromEntries(AUDIT_OPERATIONS.map(name=>[name,{calls:0,fulfilled:0,thrown:0,exactArgumentRepeats:0,repeatedFulfilledDataInputs:0,outputConflicts:0,mutatedInputs:0,
  operationMs:0,fingerprintMs:0,keySkipped:0,evictions:0,keysPeak:0}])) as Record<AuditOperation,RepeatStats>;
 constructor(private readonly namespace:string,private readonly enabled=true,private readonly maxKeys=512){if(!Number.isSafeInteger(maxKeys)||maxKeys<1||maxKeys>2048)throw new Error('Invalid diagnostic bound');}
 private fingerprint(operation:AuditOperation,data:unknown){const s=this.stats[operation],start=performance.now();try{return exactAuditKey(this.namespace,operation,data);}catch{s.keySkipped++;return null;}finally{s.fingerprintMs+=performance.now()-start;}}
 private begin(operation:AuditOperation,input:unknown){
  const s=this.stats[operation];s.calls++;const key=this.fingerprint(operation,input);if(key===null)return {key:null,entry:null,previous:null};
  let keys=this.seen.get(operation);if(!keys){keys=new Map();this.seen.set(operation,keys);}
  let entry=keys.get(key);const previous=entry?.outputHash??null;
  if(entry)s.exactArgumentRepeats++;
  else{if(keys.size>=this.maxKeys){keys.delete(keys.keys().next().value!);s.evictions++;}entry={outputHash:null};keys.set(key,entry);s.keysPeak=Math.max(s.keysPeak,keys.size);}
  return {key,entry,previous};
 }
 private finish(operation:AuditOperation,input:unknown,result:unknown,token:ReturnType<SessionRepeatAudit['begin']>){
  const s=this.stats[operation];s.fulfilled++;
  const after=this.fingerprint(operation,input);if(token.key!==null&&after!==token.key)s.mutatedInputs++;
  const output=this.fingerprint(operation,result);
  if(token.entry&&output!==null){if(token.previous!==null){s.repeatedFulfilledDataInputs++;if(token.previous!==output)s.outputConflicts++;}token.entry.outputHash=output;}
 }
 sync<T>(operation:AuditOperation,input:unknown,work:()=>T):T{
  if(!this.enabled)return work();const token=this.begin(operation,input),start=performance.now();let value:T;
  try{value=work();}catch(error){this.stats[operation].operationMs+=performance.now()-start;this.stats[operation].thrown++;throw error;}
  this.stats[operation].operationMs+=performance.now()-start;this.finish(operation,input,value,token);return value;
 }
 async async<T>(operation:AuditOperation,input:unknown,work:()=>Promise<T>):Promise<T>{
  if(!this.enabled)return work();const token=this.begin(operation,input),start=performance.now();let value:T;
  try{value=await work();}catch(error){this.stats[operation].operationMs+=performance.now()-start;this.stats[operation].thrown++;throw error;}
  this.stats[operation].operationMs+=performance.now()-start;this.finish(operation,input,value,token);return value;
 }
}
