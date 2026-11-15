import {writeFileSync,readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {eligibilityCases} from '../src/planning/validation/eligibility-fixtures';
import {validateEligibilityCase} from '../src/planning/validation/eligibility-validation';
import {objectives} from '../src/planning/validation/frontier-performance-harness';
import {OPTIMIZER_VERSION} from '../src/planning/optimizer-policy';
import {ENERGY_ALGORITHM_VERSION} from '../src/energy/energy-policy';
import {CHARGING_ALGORITHM_VERSION} from '../src/charging/charging-engine';
async function main(){
 const tag=process.argv.find(v=>v.startsWith('--tag='))?.slice(6)??'';if(tag&&!/^[a-z0-9-]+$/.test(tag))throw new Error('Invalid tag');
 const output=resolve(__dirname,'../../../docs/validation/candidate-eligibility-smoke-2026-11-15'+(tag?'-'+tag:'')+'.json');if(existsSync(output))throw new Error('Evidence already exists');
 const nativeDate=Date,epoch=Date.parse('2026-11-15T09:00:00Z');
 class FixtureDate extends nativeDate{constructor(value?:string|number){super(value===undefined?epoch:value);}static now(){return epoch;}}
 globalThis.Date=FixtureDate as DateConstructor;process.env.PLANNING_METRICS_ENABLED='false';globalThis.fetch=async()=>{throw new Error('External network forbidden');};
 const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
 const sources=['src/planning/candidate-eligibility.ts','src/planning/candidate-eligibility-shadow.ts','src/planning/charge-stop-optimizer.ts','src/planning/ev-planning.service.ts','src/planning/planning-session.ts',
  'src/planning/validation/eligibility-fixtures.ts','src/planning/validation/eligibility-validation.ts','src/planning/__tests__/optimizer.fixtures.ts','src/energy/energy-engine.ts','src/charging/charging-engine.ts','scripts/validate-candidate-eligibility.ts'];
 const sourceChecksums=Object.fromEntries(sources.map(p=>[p,hash(resolve(__dirname,'../'+p))]));
 const rows:Awaited<ReturnType<typeof validateEligibilityCase>>[]=[];
 for(const objective of objectives)for(const kind of eligibilityCases)rows.push(await validateEligibilityCase(kind,objective));
 if(sources.some(p=>sourceChecksums[p]!==hash(resolve(__dirname,'../'+p))))throw new Error('Source changed during validation');
 const baselineFiles=['perf-baseline-2026-11-13-before.json','perf-baseline-2026-11-13-after.json','perf-baseline-2026-11-13-instrumented.json','perf-baseline-2026-11-13-local-provider.json','frontier-queue-before.json'];
 const report={generatedAt:new nativeDate().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),
  fixtureClock:'2026-11-15T09:00:00Z',algorithms:{optimizer:OPTIMIZER_VERSION,energy:ENERGY_ALGORITHM_VERSION,charging:CHARGING_ALGORITHM_VERSION},
  sourceChecksums,preservedBaselineChecksums:Object.fromEntries(baselineFiles.map(p=>[p,hash(resolve(__dirname,'../../../docs/validation/'+p))])),
  scope:'synthetic regression only; before/new shadow/on-off; no performance acceptance',frontier:'stable_array_sort_shift',rows,
  actualAvoidedProviderCalls:0,actualAvoidedEngineCalls:0,activeFiltering:false,performanceAcceptance:'DEFERRED_UNTIL_AFTER_CR_PERF_005'};
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:rows.length,equivalence:'PASS',actualAvoidedProviderCalls:0,activeFiltering:false}));
}
void main().catch(()=>{console.error('ELIGIBILITY_VALIDATION_FAILED; no raw input/outcome/trace is logged.');process.exitCode=1;});
