import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {cpus,platform,release} from 'node:os';
import {REPEAT_CASES,validateSessionRepeat} from '../src/planning/validation/session-repeat-validation';
import {AUDIT_OPERATIONS} from '../src/planning/validation/session-repeat-audit';
import {objectives} from '../src/planning/validation/frontier-performance-harness';
import {OPTIMIZER_VERSION} from '../src/planning/optimizer-policy';
import {ENERGY_ALGORITHM_VERSION} from '../src/energy/energy-policy';
import {CHARGING_ALGORITHM_VERSION} from '../src/charging/charging-engine';
async function main(){
 const tag=process.argv.find(a=>a.startsWith('--tag='))?.slice(6)??'';if(tag&&!/^[a-z0-9-]+$/.test(tag))throw new Error('Invalid tag');
 const output=resolve(__dirname,'../../../docs/validation/session-repeat-smoke-2026-11-15'+(tag?'-'+tag:'')+'.json');if(existsSync(output))throw new Error('Evidence already exists');
 const realDate=Date,epoch=Date.parse('2026-11-15T09:00:00Z');
 class FixtureDate extends realDate{constructor(value?:string|number){super(value===undefined?epoch:value);}static now(){return epoch;}}
 globalThis.Date=FixtureDate as DateConstructor;process.env.PLANNING_METRICS_ENABLED='false';globalThis.fetch=async()=>{throw new Error('External providers forbidden');};
 const sources=['src/planning/planning-session.ts','src/planning/ev-planning.service.ts','src/planning/charge-stop-optimizer.ts','src/planning/plan-compiler.ts','src/planning/optimizer-policy.ts',
  'src/roads/road-client.ts','src/roads/road-service.ts','src/roads/geometry.ts','src/weather/weather-cache.ts','src/weather/weather-policy.ts','src/weather/weather-sampler.ts',
  'src/energy/energy-engine.ts','src/charging/charging-engine.ts','src/planning/validation/eligibility-fixtures.ts','src/planning/validation/session-repeat-audit.ts','src/planning/validation/session-repeat-validation.ts','scripts/validate-session-repeats.ts'];
 const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex'),sourceHashes=Object.fromEntries(sources.map(p=>[p,hash(resolve(__dirname,'../'+p))]));
 const cpuStart=process.cpuUsage(),heapBefore=process.memoryUsage().heapUsed;
 const rows:Awaited<ReturnType<typeof validateSessionRepeat>>[]=[];for(const objective of objectives)for(const kind of REPEAT_CASES)rows.push(await validateSessionRepeat(kind,objective));
 const cpu=process.cpuUsage(cpuStart),heapAfter=process.memoryUsage().heapUsed;
 if(sources.some(p=>sourceHashes[p]!==hash(resolve(__dirname,'../'+p))))throw new Error('Sources changed during validation');
 const operations=Object.fromEntries(AUDIT_OPERATIONS.map(operation=>{
  const samples=rows.map(row=>row.operations[operation]),keys=Object.keys(samples[0]) as (keyof typeof samples[0])[];
  return [operation,Object.fromEntries(keys.map(key=>[key,key==='keysPeak'?Math.max(...samples.map(s=>s[key])):samples.reduce((n,s)=>n+s[key],0)]))];
 }));
 const counterKeys=Object.keys(rows[0].existingCounters) as (keyof typeof rows[0]['existingCounters'])[],peakKeys=new Set(['frontier_peak','state_shadow_entries_peak']);
 const existingCounters=Object.fromEntries(counterKeys.map(key=>[key,peakKeys.has(key)?Math.max(...rows.map(r=>r.existingCounters[key])):rows.reduce((n,r)=>n+r.existingCounters[key],0)]));
 const report={generatedAt:new realDate().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),
  scope:'Phase A synthetic read-only audit. Native production vs memory-compiled identical coordinator/session with validation-only observers. No result reuse, no HTTP or PG.',
  decision:'SHADOW_ONLY',phaseA:'DONE',phaseB:'BLOCKED_EVIDENCE',dbGate:'NOT_EVALUATED_BY_SYNTHETIC_RUNNER; see dated report for integration results',fixtureClock:'2026-11-15T09:00Z',
  environment:{node:process.version,platform:platform(),release:release(),cpu:cpus()[0]?.model},
  diagnosticCpuMs:{user:cpu.user/1000,system:cpu.system/1000,scope:'Entire 3-way validation loop including setup/trace/hash/memory compilation; NOT saved compute'},
  diagnosticHeapUsed:{beforeBytes:heapBefore,afterBytes:heapAfter,scope:'Process samples only; no allocation/retained/peak proof'},
  algorithms:{optimizer:OPTIMIZER_VERSION,energy:ENERGY_ALGORITHM_VERSION,charging:CHARGING_ALGORITHM_VERSION},sourceHashes,
  diagnosticLimits:{keysPerOperationPerRun:512,maximumSerializedKeyBytes:4*1024*1024,keyNodes:200000,keyDepth:128,eviction:'FIFO hash records only; no results retained'},
  aggregation:'counts/times sum; keysPeak and existing peak counters max. Inclusive timings are not additive. Full-data hashing cost recorded separately.',
  rows,operations,existingCounters,saved_provider_http:0,saved_energy_evaluations:0,saved_charging_evaluations:0,saved_pure_computations:0,
  limitations:['Exact argument-data equality is not AbortSignal/deadline/budget equivalence','Sampler output aliases route endpoints and is mutable','Existing cache hits are not savings from this task','No active optimization; no full latency performance acceptance']};
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:rows.length,equivalence:'PASS',decision:report.decision,operations,existingCounters},null,2));
}
void main().catch(()=>{console.error('SESSION_REPEAT_VALIDATION_FAILED; no raw inputs/routes/results are logged.');process.exitCode=1;});
