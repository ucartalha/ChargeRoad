import {Injectable,Logger,OnModuleDestroy,HttpException} from '@nestjs/common';
import {planningApiRequestSchema} from '@chargeroad/shared';
import {PlanningJobsStore} from './planning-jobs.store';
import {PlanningHttpService} from './planning-http.service';
@Injectable()
export class PlanningJobsWorker implements OnModuleDestroy {
 private readonly logger=new Logger(PlanningJobsWorker.name);
 private timer:ReturnType<typeof setInterval>|undefined;private busy=false;
 private active:AbortController|null=null;private shuttingDown=false;private lastErrorAt=0;private ticks=0;
 constructor(private readonly store:PlanningJobsStore,private readonly planner:PlanningHttpService){}
 start(){if(this.timer)return;this.shuttingDown=false;this.timer=setInterval(()=>void this.tick(),500);this.timer.unref();void this.tick();}
 async tick(){if(this.busy||this.shuttingDown)return;this.busy=true;
  try{if(++this.ticks%120===0)await this.store.cleanup();const job=await this.store.claim();if(!job)return;
   const controller=new AbortController();this.active=controller;
   const heartbeat=setInterval(()=>{void this.store.renew(job).then(ok=>{if(!ok)controller.abort(new Error('Job ownership lost'));},()=>controller.abort(new Error('Job lease unavailable')));},5000);heartbeat.unref();
   try{
    const budget=Number(process.env.PLANNING_JOB_BUDGET_MS??120000);if(!Number.isSafeInteger(budget)||budget<1000||budget>300000)throw new Error('Invalid job budget');
    const requested=planningApiRequestSchema.parse(job.request_payload),request={...requested};
    if(request.departureMode==='now')request.departureAt=new Date(Math.max(Date.parse(request.departureAt),Date.now()+budget+15000)).toISOString();
    const result=await this.planner.plan(request,controller.signal,budget);
    if(request.departureAt!==requested.departureAt)result.metadata.requestedDepartureAt=requested.departureAt;
    controller.signal.throwIfAborted();await this.store.finish(job,result,null);
   }catch(error){
    if(!controller.signal.aborted){const payload=error instanceof HttpException?error.getResponse():null;
     const code=payload&&typeof payload==='object'&&'code'in payload&&typeof payload.code==='string'?payload.code:'PLANNING_JOB_FAILED';
     await this.store.finish(job,null,code);}
   }finally{clearInterval(heartbeat);this.active=null;}
  }catch{if(Date.now()-this.lastErrorAt>10000){this.lastErrorAt=Date.now();this.logger.error('Planning job infrastructure unavailable');}}
  finally{this.busy=false;}
 }
 onModuleDestroy(){this.shuttingDown=true;if(this.timer)clearInterval(this.timer);this.active?.abort(new Error('Worker stopping'));}
}
