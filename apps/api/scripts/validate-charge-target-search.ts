/** Small offline quality smoke, not a provider or latency benchmark. Historical evidence is never overwritten. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import * as ts from 'typescript';
import {optimizerWorld} from '../src/planning/__tests__/optimizer.fixtures';
import {analyticalStopReference} from '../src/planning/validation/optimizer-reference';
import {ChargeStopOptimizer} from '../src/planning/charge-stop-optimizer';
import {PlanningSession} from '../src/planning/planning-session';
import {EnergyConsumptionEngine} from '../src/energy/energy-engine';
import {ChargingCurveEngine} from '../src/charging/charging-engine';
import {CATALOGUE_SCENARIO_POLICY} from '../src/planning/catalogue-station-scenario';
import {planningEvaluationSchema} from '@chargeroad/shared';
import type {PlanningContext} from '../src/planning/optimizer-types';

async function main(){
 const output=resolve(__dirname,'../../../docs/validation/charge-target-quality-2026-11-15.json');if(existsSync(output))throw Error('Evidence exists');
 const realDate=Date,epoch=Date.parse('2026-11-15T09:00:00Z');
 class FixtureDate extends realDate{constructor(v?:string|number){super(v===undefined?epoch:v);}static now(){return epoch;}}
 globalThis.Date=FixtureDate as DateConstructor;globalThis.fetch=async()=>{throw Error('External provider forbidden');};
 const filename=resolve(__dirname,'../src/planning/charge-stop-optimizer.ts'),requireHere=createRequire(filename),module={exports:{} as {ChargeStopOptimizer:typeof ChargeStopOptimizer}};
 const source=execFileSync('git',['show','f5d16c8:apps/api/src/planning/charge-stop-optimizer.ts'],{encoding:'utf8'});
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('exports','require','module','__filename','__dirname',compiled)(module.exports,(name:string)=>name==='./catalogue-station-scenario'?
  {...requireHere(name),CATALOGUE_SCENARIO_POLICY:{...CATALOGUE_SCENARIO_POLICY,seedTargetSoc:100}}:requireHere(name),module,filename,dirname(filename));
 const rows:unknown[]=[];
 for(const objective of ['minimum_total_duration','minimum_charging_stops','minimum_energy'] as const)for(const limited of [true,false]){
  const pair:{strategy:string;wallMs:number;scenarioSeconds:number;netDrivingKwh:number;arrivalSoc:number;targets:number[];chargingSeconds:number;
   roadQueries:number;weatherQueries:number;stoppedReason:string;searchComplete:boolean;contractValid:boolean}[]=[];
  for(const [strategy,Optimizer] of [['before',module.exports.ChargeStopOptimizer],['after',ChargeStopOptimizer]] as const){
   const w=optimizerWorld(false);w.request.policy.objective=objective;w.request.policy.stationDataQuality='catalogue_power_scenario';
   if(limited)w.options.maxStates=2;
   const context:PlanningContext={request:w.request,vehicle:w.vehicle,evaluatedAt:w.now,options:w.options,candidates:w.candidates,
    nodes:Object.entries(w.locations).map(([id,location])=>({id,location,stationId:['origin','destination'].includes(id)?null:id})),baseRoutes:[w.route('origin','destination')]};
   const port=new PlanningSession(context,w.roads as never,w.weather as never,new EnergyConsumptionEngine(),new ChargingCurveEngine(),w.preparation.road,performance.now()+20000,context.baseRoutes);
   const start=performance.now(),outcome=await new Optimizer().solve(context,port,new AbortController().signal);
   if(outcome.result.status!=='planned')throw Error('Expected planned fixture');planningEvaluationSchema.parse({input:outcome.validationInput,result:outcome.result});
   const plan=outcome.result.plan;pair.push({strategy,wallMs:performance.now()-start,scenarioSeconds:plan.scenario!.totalSeconds,
    netDrivingKwh:plan.search!.drivingNetBatteryKwh,arrivalSoc:plan.estimatedArrivalChargePercent,targets:plan.chargingStops.map(s=>s.targetChargePercent),
    chargingSeconds:plan.duration.chargingSeconds,roadQueries:port.counters.roadQueries,weatherQueries:port.counters.weatherQueries,
    stoppedReason:plan.search!.stoppedReason,searchComplete:plan.search!.searchComplete,contractValid:true});
  }
  const [before,after]=pair,reference=analyticalStopReference(objective).answer!;
  console.log(JSON.stringify({objective,limited,pair})); // Synthetic aggregates only, also useful on a failed gate.
  if(Math.abs(after.netDrivingKwh-before.netDrivingKwh)>1e-8||after.arrivalSoc<20-1e-8||after.scenarioSeconds>before.scenarioSeconds+1e-5)throw Error('Quality regression');
  if(!limited&&Math.abs(after.scenarioSeconds-reference.seconds)>.01)throw Error('Exhaustive reference mismatch');
  rows.push({objective,limited,pair,exhaustiveReference:{seconds:reference.seconds,netDrivingKwh:reference.netKwh,stops:reference.stops.length},
   afterGapSeconds:after.scenarioSeconds-reference.seconds});
 }
 const paths=['src/planning/charge-stop-optimizer.ts','src/planning/charge-target-search.ts','src/planning/planning-replay.ts','src/planning/optimizer-policy.ts','src/energy/energy-engine.ts','src/charging/charging-engine.ts'];
 const hash=(s:Buffer|string)=>createHash('sha256').update(s).digest('hex');
 const sourceHashes=Object.fromEntries(paths.map(p=>[p,hash(readFileSync(resolve(__dirname,'../'+p)))]));
 const report={date:'2026-11-15',scope:'Synthetic in-memory quality smoke; no provider HTTP/PG; NOT real Hyundai calibration or full-plan latency acceptance',
  baseline:'f5d16c8 optimizer behavior compiled in memory; shared dependencies and metadata are current; old seedTargetSoc=100 supplied explicitly',
  rows,sourceHashes,globalOptimality:'NOT_PROVEN; independent optimum checked only in this small fixture',
  enginesUnchangedFromHead:['src/energy/energy-engine.ts','src/charging/charging-engine.ts'].every(p=>
   readFileSync(resolve(__dirname,'../'+p),'utf8').replace(/\r\n/g,'\n')===execFileSync('git',['show','HEAD:apps/api/'+p],{encoding:'utf8'}).replace(/\r\n/g,'\n'))};
 writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({cases:rows.length,quality:'PASS',enginesUnchanged:report.enginesUnchangedFromHead,rows},null,2));
}
void main().catch(error=>{const known=['Evidence exists','Expected planned fixture','Quality regression','Exhaustive reference mismatch'];
 console.error('CHARGE_TARGET_QUALITY_FAILED; '+(error instanceof Error&&known.includes(error.message)?error.message:'internal validation error')+'; no raw inputs are logged');process.exitCode=1;});
