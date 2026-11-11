import { createHmac,randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseService } from '../database/database.service';
import type { RoadConfig } from './road-policy';
import type { RoadJsonClient,RoadJsonResponse } from './provider-ports';

export class RoadProviderError extends Error {constructor(message:string,readonly status=503,readonly retryAfterSeconds=60){super(message);}}
export type RoadTransport=(url:string,body:unknown,signal:AbortSignal)=>Promise<unknown>;
export function roadTransport(config:RoadConfig):RoadTransport{return async(url,body,signal)=>{
  let response:Response;
  const form=url===config.overpassUrl&&body!==null&&typeof body==='object'&&'data'in body&&typeof body.data==='string';
  try{response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(form?Math.min(8000,config.timeoutMs):config.timeoutMs)]),
    headers:{'Content-Type':form?'application/x-www-form-urlencoded':'application/json','User-Agent':'ChargeRoad-local-pilot/1.0','X-Client-Id':config.clientId},
    body:form?new URLSearchParams({data:(body as {data:string}).data}).toString():JSON.stringify(body)});
  }catch{throw new RoadProviderError(signal.aborted?'Road request cancelled':'Road provider unavailable');}
  const reader=response.body?.getReader();if(!reader)throw new RoadProviderError('Empty road response');
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
    if(size>8*1024*1024){await reader.cancel();throw new RoadProviderError('Road response size budget exceeded');}chunks.push(value);}
  let parsed:unknown;try{parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{if(response.ok)throw new RoadProviderError('Invalid road JSON response');}
  if(!response.ok){
    if(url===config.baseUrl+'/route'&&parsed!==null&&typeof parsed==='object'&&'error_code'in parsed&&Number(parsed.error_code)===442)return parsed;
    const retry=response.headers.get('retry-after');const seconds=retry&&Number.isFinite(Number(retry))?Number(retry):60;
    throw new RoadProviderError('Road provider HTTP '+response.status,response.status,Math.min(3600,Math.max(1,seconds)));
  }
  return parsed;
};}

export class PgRoadClient implements RoadJsonClient {
  constructor(private readonly database:DatabaseService,private readonly config:RoadConfig,private readonly secret:string,
    private readonly transport:RoadTransport=roadTransport(config)){}
  async post(providerId:string,url:string,body:unknown,signal:AbortSignal,cacheSeconds=this.config.cacheSeconds):Promise<RoadJsonResponse>{
    if(this.secret.length<32)throw new RoadProviderError('Road cache secret is not configured');
    signal.throwIfAborted();
    const key=createHmac('sha256',this.secret).update('road-cache/v1\0'+providerId+'\0'+url+'\0'+JSON.stringify(body)).digest('hex');
    const read=async()=>{const r=await this.database.pool.query('SELECT payload FROM road_response_cache WHERE request_key=$1 AND expires_at>now()',[key]);return r.rows[0];};
    const cached=await read();if(cached)return cached.payload;
    const token=randomUUID();let generation:string|undefined;
    for(let wait=0;wait<100;wait++){
      signal.throwIfAborted();
      const lease=await this.database.pool.query<{generation:string}>(`INSERT INTO road_response_cache(request_key,provider_id,token,generation,lease_until)
        VALUES($1,$2,$3,1,now()+interval '45 seconds') ON CONFLICT(request_key) DO UPDATE
        SET token=EXCLUDED.token,generation=road_response_cache.generation+1,lease_until=EXCLUDED.lease_until
        WHERE road_response_cache.expires_at<=now() AND (road_response_cache.token IS NULL OR road_response_cache.lease_until<=now()) RETURNING generation`,[key,providerId,token]);
      if(lease.rowCount){generation=lease.rows[0].generation;break;}
      const ready=await read();if(ready)return ready.payload;await delay(250,undefined,{signal});
    }
    if(!generation)throw new RoadProviderError('Identical road request is still in progress');
    try{
      for(let wait=0;;wait++){
        const gate=await this.database.pool.query(`INSERT INTO road_provider_budget(provider_id,day,used,next_allowed_at)
          VALUES($1,(now() AT TIME ZONE 'UTC')::date,1,now()+$2*interval '1 millisecond') ON CONFLICT(provider_id) DO UPDATE
          SET day=EXCLUDED.day,used=CASE WHEN road_provider_budget.day=EXCLUDED.day THEN road_provider_budget.used+1 ELSE 1 END,
          next_allowed_at=EXCLUDED.next_allowed_at
          WHERE road_provider_budget.next_allowed_at<=now() AND road_provider_budget.blocked_until<=now()
          AND (road_provider_budget.day<>EXCLUDED.day OR road_provider_budget.used<$3) RETURNING used`,[providerId,this.config.minIntervalMs,this.config.dailyRequestLimit]);
        if(gate.rowCount)break;
        const state=(await this.database.pool.query(`SELECT used,day=(now() AT TIME ZONE 'UTC')::date AS today,blocked_until>now() AS blocked FROM road_provider_budget WHERE provider_id=$1`,[providerId])).rows[0];
        if(state?.blocked||(state?.today&&state.used>=this.config.dailyRequestLimit)||wait>=2)throw new RoadProviderError('Shared road provider quota/backoff active',429);
        await delay(this.config.minIntervalMs+30,undefined,{signal});
      }
      signal.throwIfAborted();const data=await this.transport(url,body,signal);signal.throwIfAborted();
      const payload:RoadJsonResponse={data,retrievedAt:new Date().toISOString()};
      const saved=await this.database.pool.query(`UPDATE road_response_cache SET payload=$4::jsonb,expires_at=now()+$5*interval '1 second',token=NULL,lease_until=NULL
        WHERE request_key=$1 AND token=$2 AND generation=$3 AND lease_until>clock_timestamp() RETURNING 1`,[key,token,generation,JSON.stringify(payload),cacheSeconds]);
      if(!saved.rowCount)throw new RoadProviderError('Expired road worker cannot overwrite new data');return payload;
    }catch(error){
      if(error instanceof RoadProviderError&&(error.status===429||error.status>=500)&&!signal.aborted)await this.database.pool.query(`UPDATE road_provider_budget
        SET blocked_until=GREATEST(blocked_until,now()+$2*interval '1 second') WHERE provider_id=$1`,[providerId,error.retryAfterSeconds]);
      await this.database.pool.query('UPDATE road_response_cache SET token=NULL,lease_until=NULL WHERE request_key=$1 AND token=$2 AND generation=$3',[key,token,generation]);
      throw error;
    }
  }
}

export class BoundedRoadClient implements RoadJsonClient {
  private actions=0;
  constructor(private readonly underlying:RoadJsonClient,private readonly limit:number){}
  post(providerId:string,url:string,body:unknown,signal:AbortSignal,cacheSeconds?:number){
    if(++this.actions>this.limit)throw new RoadProviderError('Route acquisition action budget exceeded',429);
    return this.underlying.post(providerId,url,body,signal,cacheSeconds);
  }
}
