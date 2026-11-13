import {locationSearchResponseSchema,planningApiResponseSchema,roadPreviewResponseSchema,planningJobStatusSchema} from '@chargeroad/shared';
import type {PlanningApiRequest,RoadPreviewRequest} from '@chargeroad/shared';
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
export const planningApi={
  async plan(request:PlanningApiRequest,signal:AbortSignal){const result=await post('/plans',request,planningApiResponseSchema,signal,35000);
    if(result.requestId!==request.requestId)throw new PlanningApiError('Yanıt bu plan isteğine ait değil. Tekrar dene.');return result;},
  preview:(request:RoadPreviewRequest,signal:AbortSignal)=>post('/roads/preview',request,roadPreviewResponseSchema,signal,95000),
  search:(query:string,signal:AbortSignal)=>post('/locations/search',{query},locationSearchResponseSchema,signal,12000),
  async planAsync(request:PlanningApiRequest,signal:AbortSignal,secret:string,onProgress:(status:string)=>void,
    onPreview?:(preview:import('@chargeroad/shared').RoadPreviewResponse)=>void){
    const base=process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/,'');if(!base)throw new PlanningApiError('Sunucu bağlantısı yapılandırılmamış.');
    const headers={'Content-Type':'application/json',Accept:'application/json',Authorization:'Bearer '+secret};
    const url=base+'/planning-jobs/'+request.requestId;
    let delivered=false;
    const call=async(address:string,method:string,body?:unknown,independent=false)=>{
      // Explicit controllers also work on Expo Go runtimes without AbortSignal.any/timeout.
      const bounded=new AbortController(),abort=()=>bounded.abort(),timer=setTimeout(abort,method==='DELETE'?5000:address.endsWith('/result')?35000:15000);
      if(!independent){signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();}
      try{const response=await fetch(address,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:bounded.signal});
       const data=await response.json();if(!response.ok)throw new PlanningApiError(response.status===429?'İstek sınırına ulaştın; belirtilen süre sonunda tekrar deneyebilirsin.':response.status===503?'Planlama sırası şu anda dolu veya kullanılamıyor.':'Plan işi alınamadı; tekrar deneyebilirsin.',Number(response.headers.get('Retry-After'))||0,response.status);
       return data;
      }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
    };
    const cancel=()=>{void call(url,'DELETE',undefined,true).catch(()=>{});};
    const wait=(milliseconds:number)=>new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},milliseconds);
      const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new Error('Cancelled'));};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
    signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();throw new Error('Cancelled');}
    try{
      onProgress('queued');let job=planningJobStatusSchema.parse(await call(base+'/planning-jobs','POST',request));
      // Preview is independent of the expensive energy job and cannot overwrite its final plan.
      void planningApi.preview({origin:request.origin,destination:request.destination,departureAt:request.departureAt,...request.roadPreferences},signal)
        .then(preview=>{if(!signal.aborted)onPreview?.(preview);},()=>{});
      const deadline=Date.now()+300000;
      while(job.status==='queued'||job.status==='running'){
        if(Date.now()>deadline){cancel();throw new PlanningApiError('Plan işi bekleme süresi doldu. Tekrar deneyebilirsin.');}
        onProgress(job.status);await wait(job.pollAfterMilliseconds);job=planningJobStatusSchema.parse(await call(url,'GET'));
      }
      if(job.status==='cancelled')throw new PlanningApiError('Plan işi iptal edildi.');
      if(job.status==='failed')throw new PlanningApiError('Plan işi tamamlanamadı ('+(job.errorCode??'PLANNING_JOB_FAILED')+').');
      const result=planningApiResponseSchema.parse(await call(url+'/result','GET'));if(result.requestId!==request.requestId)throw new PlanningApiError('Yanıt bu isteğe ait değil.');
      delivered=true;return result;
    }catch(error){if(error instanceof PlanningApiError)throw error;
      throw new PlanningApiError(signal.aborted?'İşlem iptal edildi.':'Plan bağlantısı kesildi. İnternetini kontrol edip tekrar dene.');
    }finally{signal.removeEventListener('abort',cancel);if(!delivered)cancel();}
  },
};
