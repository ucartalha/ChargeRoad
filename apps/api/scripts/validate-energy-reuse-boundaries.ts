/** Adversarial gate diagnostic, not a production input adapter or a passing equivalence test. */
import {writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {EnergyConsumptionEngine} from '../src/energy/energy-engine';
import {energyFixture} from '../src/energy/__tests__/fixtures';
import {ProofEnergyReuse,proofCanonical} from '../src/planning/validation/energy-reuse-proof';

async function main(){
 const inherited=(charge:number)=>{
  const input=energyFixture();input.request.startingChargePercent=charge;
  const prototype=Object.assign(Object.create(null),input);
  Object.defineProperty(prototype,'constructor',{value:Object});
  return Object.create(prototype) as typeof input;
 };
 const one=inherited(80),two=inherited(70),signal=new AbortController().signal;
 const engine=new EnergyConsumptionEngine(),proof=new ProofEnergyReuse(engine,'boundary-diagnostic');
 const native=await engine.evaluate(two,signal);
 await proof.evaluate(one,signal);const cached=await proof.evaluate(two,signal);
 const keyCollision=proofCanonical(one).key===proofCanonical(two).key;
 const equivalent=isDeepStrictEqual(native,cached);
 proof.dispose();
 const data={generatedAt:new Date().toISOString(),gate:equivalent?'PASS':'FAIL',decision:equivalent?'NO_GO_OTHER_GATES':'NO_GO',
  case:'crafted-null-parent-prototype-with-native-constructor-and-inherited-fields',
  keyCollision,equivalent,physicalCalls:proof.stats.physicalCalls,hits:proof.stats.hits,retainedAfterDispose:proof.stats.retainedUnits,
  scope:'Crafted non-JSON input. Ordinary JSON plan matrix is unaffected. Prototype guard is not a complete input contract proof; production integration forbidden.',
  sourceHashes:Object.fromEntries(['src/planning/validation/energy-reuse-proof.ts','scripts/validate-energy-reuse-boundaries.ts'].map(p=>[p,createHash('sha256').update(readFileSync(resolve(__dirname,'../'+p))).digest('hex')])),
  productionReuse:false};
 writeFileSync(resolve(__dirname,'../../../docs/validation/session-repeat-active-proof-2026-11-15/run1/boundaries.json'),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({gate:data.gate,decision:data.decision,keyCollision,equivalent}));
 if(!equivalent)process.exitCode=1;
}
void main().catch(()=>{console.error('Boundary diagnostic setup failed; raw input/output suppressed');process.exitCode=2;});
