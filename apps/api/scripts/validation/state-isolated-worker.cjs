const objective=process.argv[2];
if(!['minimum_total_duration','minimum_charging_stops','minimum_energy'].includes(objective))throw Error('INVALID_OBJECTIVE');
const RealDate=Date,epoch=RealDate.parse('2026-11-15T09:00:00Z');
global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[epoch]));}static now(){return epoch;}};
let externalCalls=0;global.fetch=async()=>{externalCalls++;throw Error('EXTERNAL_FORBIDDEN');};
const {validateStateCase}=require('../../src/planning/validation/state-dominance-validation.ts');
const start=performance.now(),cpu=process.cpuUsage();
validateStateCase('equal_alternatives',objective).then(result=>{
 const wallMs=performance.now()-start,used=process.cpuUsage(cpu);
 process.stdout.write(JSON.stringify({result,wallMs,cpuUserMs:used.user/1000,cpuSystemMs:used.system/1000,externalCalls,
  historical5000msGate:wallMs<5000?'PASS':'FAIL',heapUsed:process.memoryUsage().heapUsed}));
},error=>{process.stderr.write(JSON.stringify({code:/^STATE_[A-Z_]+\/[a-z_]+\/[a-z_]+\/(after|off)\/[A-Za-z0-9_/~]+$/.test(error.message)?error.message:'STATE_PROOF_FAILED',phases:error.validationPhases??{}}));process.exitCode=1;});
