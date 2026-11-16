/** Functional proof lifecycle. 5s timing is reported separately, never relabelled PASS. */
const cp=require('node:child_process'),path=require('node:path');
function runIsolated(objective,{watchdogMs=30000,childFile=path.join(__dirname,'state-isolated-worker.cjs')}={}){
 return new Promise((resolve,reject)=>{
  const child=cp.spawn(process.execPath,['-r',require.resolve('ts-node/register/transpile-only'),childFile,objective],{
   cwd:path.resolve(__dirname,'../..'),stdio:['ignore','pipe','pipe'],env:{...process.env,PLANNING_METRICS_ENABLED:'false'}});
  let stdout='',stderr='',timeout=false,overflow=false;
  const timer=setTimeout(()=>{timeout=true;child.kill('SIGKILL');},watchdogMs);
  child.stdout.on('data',v=>{stdout+=v;if(stdout.length>1024*1024){overflow=true;child.kill('SIGKILL');}});
  child.stderr.on('data',v=>{stderr+=v;if(stderr.length>1024*1024){overflow=true;child.kill('SIGKILL');}});
  child.on('error',error=>{clearTimeout(timer);reject(error);});
  // close follows exit AND pipe closure; a failed child cannot leave promises in Jest.
  child.on('close',(code,signal)=>{clearTimeout(timer);
   if(timeout||overflow||code!==0){const error=new Error(timeout?'STATE_CHILD_WATCHDOG_KILLED':overflow?'STATE_CHILD_OUTPUT_LIMIT':'STATE_CHILD_FAILURE/'+code);
    try{const diagnostic=JSON.parse(stderr);if(/^STATE_[A-Z_/a-z0-9~]+$/.test(diagnostic.code))error.diagnostic=diagnostic;}catch{}
    return reject(error);}
   try{const value=JSON.parse(stdout);if(!value.result?.equivalent||value.externalCalls!==0)throw Error();resolve({...value,exitCode:code,exitSignal:signal,closed:true});}
   catch{reject(new Error('STATE_CHILD_INVALID_RESULT'));}
  });
 });
}
module.exports={runIsolated};
