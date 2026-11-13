import {Inject,Injectable,HttpException} from '@nestjs/common';
import {PlanningAdmissionStore} from './planning-admission.store';
import {PLANNING_HTTP_OPTIONS} from './planning-http-policy';
import type {PlanningHttpOptions} from './planning-http-policy';

const unavailable=(code:string)=>new HttpException({code,retryAfterSeconds:1},503);
function untilAbort<T>(pending:Promise<T>,signal:AbortSignal){return new Promise<T>((resolve,reject)=>{
  const cancel=()=>reject(signal.reason);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  pending.then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));
});}
@Injectable()
export class PlanningExecution {
  private active=0;
  constructor(private readonly admission:PlanningAdmissionStore,@Inject(PLANNING_HTTP_OPTIONS) private readonly options:PlanningHttpOptions){}
  async run<T>(operation:(signal:AbortSignal,budgetMs:number)=>Promise<T>,caller:AbortSignal,serverBudgetMs=this.options.budgetMs):Promise<T>{
    if(!Number.isSafeInteger(serverBudgetMs)||serverBudgetMs<1||serverBudgetMs>300000)throw new Error('Invalid server planning budget');
    caller.throwIfAborted();if(this.active>=this.options.localConcurrency)throw unavailable('PLANNING_CAPACITY_EXCEEDED');this.active++;
    const began=performance.now(),leaseLost=new AbortController(),deadline=AbortSignal.timeout(serverBudgetMs),signal=AbortSignal.any([caller,deadline,leaseLost.signal]),ttl=Math.min(30000,serverBudgetMs+5000);
    const acquisition=Promise.resolve().then(()=>this.admission.acquire(ttl,signal));
    let lease;try{lease=await untilAbort(acquisition,signal);}catch(error){
      if(signal.aborted){void acquisition.then(l=>l?this.admission.release(l):undefined,()=>{}).catch(()=>{}).finally(()=>{this.active--;});}
      else this.active--;
      if(caller.aborted)throw caller.reason;if(deadline.aborted)throw unavailable('PLANNING_REQUEST_DEADLINE');throw unavailable('PLANNING_ADMISSION_UNAVAILABLE');}
    if(!lease){this.active--;throw unavailable('PLANNING_CAPACITY_EXCEEDED');}
    let renewing=false,settled=false;
    const heartbeat=setInterval(()=>{if(renewing)return;renewing=true;
      void this.admission.renew(lease!,ttl).then(ok=>{if(!settled&&!ok)leaseLost.abort(new Error('Planning lease lost'));},()=>{if(!settled)leaseLost.abort(new Error('Planning lease unavailable'));}).finally(()=>{renewing=false;});
    },Math.max(100,Math.min(5000,Math.floor(ttl/3))));heartbeat.unref();
    let work:Promise<T>;
    const budget=Math.max(1,Math.floor(serverBudgetMs-(performance.now()-began)-Math.min(250,serverBudgetMs/4)));
    try{signal.throwIfAborted();work=Promise.resolve(operation(signal,budget));}catch(error){work=Promise.reject(error);}
    // Keep admission while underlying work unwinds, even if a provider ignores cancellation.
    const owned=work.finally(()=>{settled=true;clearInterval(heartbeat);void this.admission.release(lease!).catch(()=>{/* expiry recovers after DB failure */}).finally(()=>{this.active--;});});
    try{return await untilAbort(owned,signal);}catch(error){if(caller.aborted)throw caller.reason;
      if(leaseLost.signal.aborted)throw unavailable('PLANNING_ADMISSION_UNAVAILABLE');
      if(deadline.aborted)throw unavailable('PLANNING_REQUEST_DEADLINE');throw error;}
  }
}
