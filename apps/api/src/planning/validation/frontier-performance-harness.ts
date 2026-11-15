/** Offline validation seam only. No production module/cache/source is patched. */
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import * as ts from 'typescript';
import {ChargeStopOptimizer} from '../charge-stop-optimizer';
import {StablePriorityQueue} from '../stable-priority-queue';
import {optimizerWorld} from '../__tests__/optimizer.fixtures';
import {EvPlanningService} from '../ev-planning.service';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {ChargingCurveEngine} from '../../charging/charging-engine';
import {withPlanningMetrics,type PlanningMetricSnapshot} from '../../observability/planning-metrics';
import type {OptimizerState,PlanningContext,TransitionPort,OptimizerOutcome} from '../optimizer-types';
import type {RoadRoute,Coordinate} from '@chargeroad/shared';
export type Strategy='sort'|'heap';
export type Profile='small'|'medium'|'large';
export type Objective=PlanningContext['request']['policy']['objective'];
export const profiles:Profile[]=['small','medium','large'];
export const objectives:Objective[]=['minimum_total_duration','minimum_charging_stops','minimum_energy'];
export const normalized=(value:unknown)=>JSON.parse(JSON.stringify(value,(key,v)=>key==='elapsedMilliseconds'?undefined:v));
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface QueueObservation {peak:number;push:number;pop:number;comparisons:number;milliseconds:number;popHash:string;}
export interface Run {
 outcome:ReturnType<typeof normalized>;outputHash:string;traceHash:string;fixtureHash:string;traceCalls:number;
 queue:QueueObservation;wallMs:number;cpu:{userMs:number;systemMs:number};heap:{before:number;after:number};
 metrics:PlanningMetricSnapshot|null;
 window:{start:number;end:number};
}
export function assertEquivalent(a:Run,b:Run){
 if(!isDeepStrictEqual(a.outcome,b.outcome)||a.outputHash!==b.outputHash||a.traceHash!==b.traceHash||a.fixtureHash!==b.fixtureHash||a.traceCalls!==b.traceCalls)
  throw new Error('FRONTIER_EQUIVALENCE_FAILED');
 if(a.queue.pop&&b.queue.pop&&(a.queue.popHash!==b.queue.popHash||a.queue.peak!==b.queue.peak||a.queue.push!==b.queue.push||a.queue.pop!==b.queue.pop))throw new Error('FRONTIER_ORDER_FAILED');
}
export function compileOptimizer(queue:typeof StablePriorityQueue,source=readFileSync(resolve(__dirname,'../charge-stop-optimizer.ts'),'utf8')):typeof ChargeStopOptimizer {
 const filename=resolve(__dirname,'../charge-stop-optimizer.ts'),ast=ts.createSourceFile(filename,source,ts.ScriptTarget.ES2022,true);
 const imports=ast.statements.filter(ts.isImportDeclaration).filter(s=>ts.isStringLiteral(s.moduleSpecifier)&&s.moduleSpecifier.text==='./stable-priority-queue');
 if(imports.length===0){
  // CR-PERF-002 closure: production uses the stable array again. Adapt only the two
  // frontier expressions in memory so historical queue tests remain executable.
  const initial='const frontier=[initial];';
  const pop='frontier.sort((a,b)=>compareStates(a,b,objective));const current=frontier.shift()!;expanded++;';
  if(source.split(initial).length!==2||source.split(pop).length!==2)throw new Error('Unexpected production queue import; review seam');
  source="import {StablePriorityQueue} from './stable-priority-queue';\n"+source.replace(initial,'const frontier=new StablePriorityQueue<OptimizerState>((a,b)=>compareStates(a,b,objective),options.maxFrontier);frontier.push(initial);').replace(pop,'const current=frontier.pop()!;expanded++;');
 }else if(imports.length!==1)throw new Error('Unexpected production queue import; review seam');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 const requireFromSource=createRequire(filename),module={exports:{} as {ChargeStopOptimizer:typeof ChargeStopOptimizer}};
 // All algorithm/engine/provider imports resolve normally. Only this exact queue import is substituted.
 const isolatedRequire=(name:string)=>name==='./stable-priority-queue'?{StablePriorityQueue:queue}:requireFromSource(name);
 new Function('exports','require','module','__filename','__dirname',compiled.outputText)(module.exports,isolatedRequire,module,filename,dirname(filename));
 if(typeof module.exports.ChargeStopOptimizer!=='function')throw new Error('Optimizer compile failed');
 return module.exports.ChargeStopOptimizer;
}
function fixture(profile:Profile,objective:Objective){
 const w=optimizerWorld(false);w.request.policy.objective=objective;
 if(profile==='small')return w;
 const count=profile==='medium'?4:8,alternatives=profile==='medium'?3:6,positions:Record<string,number>={origin:0,destination:2};
 const locations:Record<string,Coordinate>={origin:w.request.origin,destination:w.request.destination};
 const template=structuredClone(w.candidates.candidates[0]),roadTemplate=w.route('origin','destination');
 w.candidates.candidates=Array.from({length:count},(_,index)=>{
  const id='synthetic-'+index,position=.5+index/(count-1),location={latitude:w.request.origin.latitude+(w.request.destination.latitude-w.request.origin.latitude)*position/2,longitude:w.request.origin.longitude};
  positions[id]=position;locations[id]=location;
  const candidate=structuredClone(template);candidate.station.id=id;candidate.station.location=location;
  candidate.routeMatches=[{routeId:'origin-destination',segmentId:'origin-destination-0',distanceMeters:0,segmentProgress:position/2}];return candidate;
 });
 w.preparation.road.alternatives=alternatives;w.options.maxStates=2;w.options.maxFrontier=2048;
 const route=(from:string,to:string,variant:number):RoadRoute=>{
  const distance=Math.abs(positions[to]-positions[from])*1000,point=(t:number)=>({latitude:locations[from].latitude+(locations[to].latitude-locations[from].latitude)*t,longitude:locations[from].longitude});
  const count=Math.max(1,Math.ceil(distance/1000)),span=distance/count;
  return {...structuredClone(roadTemplate),id:from+'-'+to+(variant?'-alt'+variant:''),distanceMeters:distance,drivingDurationSeconds:distance/1000*60,
   segments:Array.from({length:count},(_,i)=>({...structuredClone(roadTemplate.segments[0]),id:from+'-'+to+'-'+i,
    startDistanceMeters:i*span,endDistanceMeters:(i+1)*span,distanceMeters:span,drivingDurationSeconds:span/1000*60,
    geometry:[point(i/count),point((i+1)/count)],elevationProfile:[{distanceFromStartMeters:0,elevationMeters:0},{distanceFromStartMeters:span,elevationMeters:0}]}))};
 };
 const key=(p:Coordinate)=>Object.keys(locations).find(k=>Math.abs(locations[k].latitude-p.latitude)<1e-9&&Math.abs(locations[k].longitude-p.longitude)<1e-9)!;
 const roads={routes:async(request:{origin:Coordinate;destination:Coordinate})=>({data:{schemaVersion:'1.0.0' as const,routes:Array.from({length:alternatives},(_,i)=>route(key(request.origin),key(request.destination),i))},source:roadTemplate.source})};
 return {...w,roads,locations};
}
export function makeRunner(strategy:Strategy|'native'){
 let current:{queue:QueueObservation;pop:ReturnType<typeof createHash>}|null=null;
 class ObservedQueue<T> {
  private readonly array:T[]=[];private readonly heap:StablePriorityQueue<T>|null;private readonly observation= current!;
  constructor(compare:(a:T,b:T)=>number,capacity:number){
   const counted=(a:T,b:T)=>{this.observation.queue.comparisons++;return compare(a,b);};
   this.compare=counted;this.heap=strategy==='heap'?new StablePriorityQueue(counted,capacity):null;
  }
  private readonly compare:(a:T,b:T)=>number;
  get length(){return this.heap?this.heap.length:this.array.length;}
  push(value:T){const start=performance.now();if(this.heap)this.heap.push(value);else this.array.push(value);
   this.observation.queue.push++;this.observation.queue.peak=Math.max(this.observation.queue.peak,this.length);this.observation.queue.milliseconds+=performance.now()-start;}
  pop(){const start=performance.now();let value:T|undefined;if(this.heap)value=this.heap.pop();else{this.array.sort(this.compare);value=this.array.shift();}
   this.observation.queue.pop++;this.observation.queue.milliseconds+=performance.now()-start;
   // Hashing is outside queue timing, inside plan wall time, and identical for both strategies.
   this.observation.pop.update(JSON.stringify(normalized(value)));return value;}
 }
 const Optimizer=strategy==='native'?ChargeStopOptimizer:compileOptimizer(ObservedQueue as unknown as typeof StablePriorityQueue);
 return async(profile:Profile,objective:Objective,metricsEnabled:boolean):Promise<Run>=>{
  const w=fixture(profile,objective),trace=createHash('sha256');let traceCalls=0,snapshot:PlanningMetricSnapshot|null=null;
  const queue:QueueObservation={peak:0,push:0,pop:0,comparisons:0,milliseconds:0,popHash:''};current={queue,pop:createHash('sha256')};
  class ObservedOptimizer extends Optimizer {
   override solve(context:PlanningContext,port:TransitionPort,signal:AbortSignal){return super.solve(context,{
    issues:port.issues,counters:port.counters,remainingMilliseconds:()=>port.remainingMilliseconds?.()??Infinity,
    drive:async(state,to,preview,s)=>{traceCalls++;trace.update(JSON.stringify(normalized(['drive',state,to,preview])));return port.drive(state,to,preview,s);},
    charge:async(state,target,s)=>{traceCalls++;trace.update(JSON.stringify(normalized(['charge',state,target])));return port.charge(state,target,s);},
   },signal);}
  }
  const service=new EvPlanningService(w.vehicles as never,w.roads as never,w.stations as never,w.weather as never,new EnergyConsumptionEngine(),new ChargingCurveEngine(),new ObservedOptimizer());
  const fixtureHash=digest({profile,request:w.request,preparation:w.preparation,options:w.options,vehicle:w.vehicle,candidates:w.candidates,locations:w.locations});
  const before=process.memoryUsage().heapUsed,cpu=process.cpuUsage(),began=performance.now();
  const outcome:OptimizerOutcome=await withPlanningMetrics(w.request.requestId,()=>service.plan(w.request,w.preparation,w.options),{enabled:metricsEnabled,scope:'benchmark',sink:s=>{snapshot=s;}});
  const wallMs=performance.now()-began,used=process.cpuUsage(cpu),after=process.memoryUsage().heapUsed;
  queue.popHash=current.pop.digest('hex');current=null;
  return {outcome:normalized(outcome),outputHash:digest(normalized(outcome)),fixtureHash,traceHash:trace.digest('hex'),traceCalls,queue,wallMs,
   cpu:{userMs:used.user/1000,systemMs:used.system/1000},heap:{before,after},metrics:snapshot,window:{start:began,end:began+wallMs}};
 };
}
