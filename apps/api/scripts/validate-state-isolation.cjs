const fs=require('fs'),path=require('path'),crypto=require('crypto'),{runIsolated}=require('./validation/state-isolated-runner.cjs');
const folder=path.resolve(__dirname,'../../../docs/validation/cr-lat-002r-2026-11-16');
async function main(){
 const rows=[];
 for(let repeat=1;repeat<=3;repeat++)for(const objective of ['minimum_total_duration','minimum_charging_stops','minimum_energy']){
  try{rows.push({repeat,objective,...await runIsolated(objective)});}catch(error){rows.push({repeat,objective,status:'FAIL',error:error.message,diagnostic:error.diagnostic});}
  console.log(JSON.stringify({repeat,objective,status:rows.at(-1).status??'PASS',wallMs:rows.at(-1).wallMs}));
 }
 const sources=Object.fromEntries(['../src/planning/validation/state-dominance-validation.ts','validation/state-isolated-runner.cjs','validation/state-isolated-worker.cjs'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,p))).digest('hex')]));
 const value={baselineVersion:'state-objective-real/v2',sources,rows,functionalGate:rows.every(r=>r.result?.equivalent)?'PASS':'FAIL',
  historical5000msGate:rows.every(r=>r.historical5000msGate==='PASS')?'PASS':'FAIL',processes:9,externalProviderRequests:0};
 fs.writeFileSync(path.join(folder,process.argv.includes('--final')?'state-isolation-nine-final.json':'state-isolation-nine.json'),JSON.stringify(value,null,2),{flag:'wx'});
 if(value.functionalGate==='FAIL')process.exitCode=1;
}
main().catch(()=>{console.error('STATE_ISOLATION_DRIVER_FAILED');process.exitCode=1;});
