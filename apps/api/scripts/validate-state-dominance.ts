import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {stateCases,validateStateCase} from '../src/planning/validation/state-dominance-validation';
import {objectives} from '../src/planning/validation/frontier-performance-harness';
import {STATE_SHADOW_COUNTERS} from '../src/planning/state-dominance';
import {STATE_SHADOW_LIMITS,createStateShadow} from '../src/planning/state-dominance-shadow';
import {withPlanningMetrics,type PlanningMetricSnapshot} from '../src/observability/planning-metrics';
import type {OptimizerState} from '../src/planning/optimizer-types';
import {loadReferenceSnapshot,replayCase} from '../src/planning/validation/replay';
async function main(){
 const tag=process.argv.find(a=>a.startsWith('--tag='))?.slice(6)??'';if(tag&&!/^[a-z0-9-]+$/.test(tag))throw new Error('Invalid tag');
 const output=resolve(__dirname,'../../../docs/validation/state-dominance-smoke-2026-11-15'+(tag?'-'+tag:'')+'.json');if(existsSync(output))throw new Error('Evidence already exists');
 const realDate=Date,epoch=Date.parse('2026-11-15T09:00:00Z');
 class FixtureDate extends realDate{constructor(value?:string|number){super(value===undefined?epoch:value);}static now(){return epoch;}}
 globalThis.Date=FixtureDate as DateConstructor;process.env.PLANNING_METRICS_ENABLED='false';globalThis.fetch=async()=>{throw new Error('External network forbidden');};
 const sources=['src/planning/charge-stop-optimizer.ts','src/planning/state-dominance.ts','src/planning/state-dominance-shadow.ts','src/observability/planning-metrics.ts',
  'src/planning/validation/state-dominance-validation.ts','src/planning/validation/eligibility-fixtures.ts','src/planning/planning-session.ts','src/planning/ev-planning.service.ts','src/planning/plan-compiler.ts',
  'src/energy/energy-engine.ts','src/charging/charging-engine.ts','scripts/validate-state-dominance.ts'];
 const hash=(file:string)=>createHash('sha256').update(readFileSync(file)).digest('hex');
 const sourceHashes=Object.fromEntries(sources.map(p=>[p,hash(resolve(__dirname,'../'+p))]));
 const rows:Awaited<ReturnType<typeof validateStateCase>>[]=[];
 for(const objective of objectives)for(const kind of stateCases)rows.push(await validateStateCase(kind,objective));
 const {snapshot,checksum}=loadReferenceSnapshot(),references=snapshot.cases.map(c=>replayCase(snapshot.base,c));if(references.some(r=>r.failures.length))throw new Error('Independent reference failed');
 let demo!:PlanningMetricSnapshot;
 await withPlanningMetrics('11111111-1111-4111-8111-111111111111',async()=>{
  const s:OptimizerState={nodeId:'synthetic',soc:50,at:new Date().toISOString(),temperature:{origin:'unknown',value:null},capacity:null,legs:[],stops:[],visited:['origin','synthetic'],netKwh:1,seconds:60,distance:1000};
  const observe=createStateShadow();observe(s);observe({...s});observe({...s,soc:50+1e-10});observe({...s,legs:[]});observe({...s,temperature:{origin:'user_input',value:30,observedAt:s.at}});
 },{enabled:true,scope:'benchmark',sink:s=>{demo=s;}});
 if(sources.some(p=>sourceHashes[p]!==hash(resolve(__dirname,'../'+p))))throw new Error('Sources changed during validation');
 const totals=Object.fromEntries(STATE_SHADOW_COUNTERS.map(k=>[k,k==='state_shadow_entries_peak'?Math.max(...rows.map(row=>row.shadow[k])):rows.reduce((n,row)=>n+row.shadow[k],0)]));
 const report={generatedAt:new realDate().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),
  scope:'Bounded offline shadow-only regression; current production vs byte-verified original optimizer; no performance acceptance/no HTTP/DB',fixtureClock:'2026-11-15T09:00Z',sourceHashes,
  limits:STATE_SHADOW_LIMITS,reference:{cases:references.length,snapshotChecksum:checksum},rows,totals,aggregation:'Event counters summed across plans; entries_peak is maximum, not sum',
  shadowEvaluationTotalMs:rows.reduce((n,r)=>n+(r.shadowEvaluationMs??0),0),shadowEvaluationMaxPerPlanMs:Math.max(...rows.map(r=>r.shadowEvaluationMs??0)),
  syntheticObserverProbe:{scope:'Artificial same-reference/scalar/history variations, NOT duplicate detections from route plans',counters:Object.fromEntries(STATE_SHADOW_COUNTERS.map(k=>[k,demo.counters[k]]))},
  actualPrunedStates:0,actualSavedProviderCalls:0,actualSavedEngineCalls:0,activePruning:'NO-GO',performanceAcceptance:'DEFERRED_UNTIL_AFTER_CR_PERF_005'};
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({equivalence:'PASS',cases:rows.length,referenceCases:references.length,totals,actualPrunedStates:0}));
}
void main().catch(()=>{console.error('STATE_DOMINANCE_VALIDATION_FAILED; no raw state/route/input is logged.');process.exitCode=1;});
