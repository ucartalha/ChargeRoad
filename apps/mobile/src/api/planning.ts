import {locationSearchResponseSchema,planningApiResponseSchema,planningMobileResponseSchema,roadPreviewResponseSchema,planningJobStatusSchema,planningApiErrorSchema} from '@chargeroad/shared';
import type {PlanningApiRequest,RoadPreviewRequest} from '@chargeroad/shared';
import {devLog} from '../dev/dev-log';
export class PlanningApiError extends Error {
  constructor(message:string,readonly retryAfterSeconds=0,readonly status=0){super(message);}
}
async function post<T>(path:string,body:unknown,schema:{safeParse:(raw:unknown)=>{success:true;data:T}|{success:false}},signal:AbortSignal,timeoutMs:number):Promise<T>{
  const base=process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/,'');if(!base)throw new PlanningApiError('Sunucu bağlantısı yapılandırılmamış.');
  const bounded=new AbortController(),abort=()=>bounded.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  const timer=setTimeout(abort,timeoutMs);
  try{const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body),signal:bounded.signal});
    const raw:unknown=await response.json();const parsed=schema.safeParse(raw);
    // Provider/computation outcomes deliberately use HTTP 503 with a valid domain envelope.
    if(parsed.success&&(response.ok||path==='/plans'&&response.status===503))return parsed.data;
    const retry=Number(response.headers.get('Retry-After')),seconds=Number.isFinite(retry)&&retry>0?Math.min(86400,Math.ceil(retry)):0;
    throw new PlanningApiError(response.status===429?'İstek sınırına ulaştın. Belirtilen süre sonunda tekrar deneyebilirsin.':
      response.status===400?'Planlama bilgilerini kontrol edip tekrar dene.':response.status===422?'Konum yol ağıyla eşleşmedi veya yol tercihleri karşılanamadı. Daha kesin bir adres seç ya da tercihlerini kontrol et.':response.ok?'Sunucudan beklenen biçimde yanıt alınamadı.':'Servise şu anda ulaşılamıyor. Biraz sonra tekrar dene.',seconds,response.status);
  }catch(error){if(error instanceof PlanningApiError)throw error;
    throw new PlanningApiError(signal.aborted?'İşlem iptal edildi.':bounded.signal.aborted?'İşlem zaman aşımına uğradı. Tekrar deneyebilirsin.':'Bağlantı kurulamadı. İnternetini ve sunucu bağlantısını kontrol et.');
  }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
const LONG_POLL_WAIT_MS=15000;
export const planningApi={
  async plan(request:PlanningApiRequest,signal:AbortSignal){const result=await post('/plans',request,planningApiResponseSchema,signal,35000);
    if(result.requestId!==request.requestId)throw new PlanningApiError('Yanıt bu plan isteğine ait değil. Tekrar dene.');return result;},
  preview:(request:RoadPreviewRequest,signal:AbortSignal)=>post('/roads/preview',request,roadPreviewResponseSchema,signal,95000),
  search:(query:string,signal:AbortSignal)=>post('/locations/search',{query},locationSearchResponseSchema,signal,12000),
  /** Seconds-level latency fix (2026-11-19): status reads wait server-side for the job to finish. */
  async planAsync(request:PlanningApiRequest,signal:AbortSignal,secret:string,onProgress:(status:string)=>void,
    onPreview?:(preview:import('@chargeroad/shared').RoadPreviewResponse)=>void){
    const base=process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/,'');if(!base)throw new PlanningApiError('Sunucu bağlantısı yapılandırılmamış.');
    const headers={'Content-Type':'application/json',Accept:'application/json',Authorization:'Bearer '+secret};
    const url=base+'/planning-jobs/'+request.requestId;
    let delivered=false;
    const call=async(address:string,method:string,body?:unknown,independent=false)=>{
      // Explicit controllers also work on Expo Go runtimes without AbortSignal.any/timeout.
      const bounded=new AbortController(),abort=()=>bounded.abort(),timer=setTimeout(abort,method==='DELETE'?5000:address.includes('/result')?35000:address.includes('?waitMs=')?LONG_POLL_WAIT_MS+5000:15000);
      if(!independent){signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();}
      try{const response=await fetch(address,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:bounded.signal});
       const data=await response.json();
       if(!response.ok){
        // __DEV__ exists only in React Native; this client is also exercised from Node (API/Jest) tests.
        if(typeof __DEV__!=='undefined'&&__DEV__&&method==='POST'&&address===base+'/planning-jobs'){
         const parsed=planningApiErrorSchema.safeParse(data),serverTime=Date.parse(response.headers.get('Date')??'');
         const observedTime=Date.parse(request.startingChargeObservedAt);
         // No body/headers/raw timestamps: only bounded diagnostic codes and clock delta.
         console.info('planning_rejected',{requestId:request.requestId,httpStatus:response.status,
          errorCode:parsed.success?parsed.data.error.code:'UNRECOGNIZED_ERROR_RESPONSE',
          fields:parsed.success?parsed.data.error.fields?.map(f=>({path:f.path,code:f.code}))??[]:[],
          observedAheadOfServerHeaderMs:Number.isFinite(serverTime)&&Number.isFinite(observedTime)?observedTime-serverTime:null,
          retryAfterSeconds:Number(response.headers.get('Retry-After'))||0});
        }
        throw new PlanningApiError(response.status===429?'İstek sınırına ulaştın; belirtilen süre sonunda tekrar deneyebilirsin.':response.status===503?'Planlama sırası şu anda dolu veya kullanılamıyor.':'Plan işi alınamadı; tekrar deneyebilirsin.',Number(response.headers.get('Retry-After'))||0,response.status);
       }
       return data;
      }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
    };
    const cancel=()=>{void call(url,'DELETE',undefined,true).catch(()=>{});};
    const wait=(milliseconds:number)=>new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},milliseconds);
      const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new Error('Cancelled'));};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
    signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();throw new Error('Cancelled');}
    try{
      // DEV: job timeline (docs/DEV_DIAGNOSTICS.md).
      const began=Date.now();let reads=0,lastStatus='';
      onProgress('queued');let job=planningJobStatusSchema.parse(await call(base+'/planning-jobs','POST',request));
      devLog('plan_job_created',{requestId:request.requestId,ms:Date.now()-began,status:job.status});lastStatus=job.status;
      // Preview is independent of the expensive energy job and cannot overwrite its final plan.
      void planningApi.preview({origin:request.origin,destination:request.destination,departureAt:request.departureAt,...request.roadPreferences},signal)
        .then(preview=>{if(!signal.aborted)onPreview?.(preview);},()=>{});
      const deadline=Date.now()+300000;
      while(job.status==='queued'||job.status==='running'){
        if(Date.now()>deadline){cancel();throw new PlanningApiError('Plan işi bekleme süresi doldu. Tekrar deneyebilirsin.');}
        // Long-poll: the server answers as soon as the job finishes (or after LONG_POLL_WAIT_MS). A server that ignores
        // waitMs answers at once; then fall back to its pollAfterMilliseconds so the loop never spins.
        onProgress(job.status);const asked=Date.now();job=planningJobStatusSchema.parse(await call(url+'?waitMs='+LONG_POLL_WAIT_MS,'GET'));reads++;
        if(job.status!==lastStatus){devLog('plan_job_status',{requestId:request.requestId,status:job.status,atMs:Date.now()-began,reads});lastStatus=job.status;}
        if((job.status==='queued'||job.status==='running')&&Date.now()-asked<1000)await wait(job.pollAfterMilliseconds);
      }
      if(job.status==='cancelled')throw new PlanningApiError('Plan işi iptal edildi.');
      if(job.status==='failed'){devLog('plan_job_failed',{requestId:request.requestId,errorCode:job.errorCode??null,atMs:Date.now()-began});throw new PlanningApiError('Plan işi tamamlanamadı ('+(job.errorCode??'PLANNING_JOB_FAILED')+').');}
      // planning-mobile-view/1.0.0: ~1/3 of the full plan (no elevation profiles, edge ids, energy breakdowns), same checks.
      const fetchStart=Date.now(),raw=await call(url+'/result?view=mobile','GET'),parseStart=Date.now();
      const result=planningMobileResponseSchema.parse(raw);
      devLog('plan_result_timing',{requestId:request.requestId,status:result.status,totalMs:Date.now()-began,serverWaitMs:fetchStart-began,resultFetchMs:parseStart-fetchStart,
        parseMs:Date.now()-parseStart,statusReads:reads,stops:result.status==='planned'?result.plan.chargingStops.length:null,reason:result.status==='planned'?null:result.reasons[0]?.code??null});if(result.requestId!==request.requestId)throw new PlanningApiError('Yanıt bu isteğe ait değil.');
      delivered=true;return result;
    }catch(error){if(error instanceof PlanningApiError)throw error;
      throw new PlanningApiError(signal.aborted?'İşlem iptal edildi.':'Plan bağlantısı kesildi. İnternetini kontrol edip tekrar dene.');
    }finally{signal.removeEventListener('abort',cancel);if(!delivered)cancel();}
  },
};
