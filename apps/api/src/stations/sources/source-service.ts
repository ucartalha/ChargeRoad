import { randomUUID } from 'node:crypto';
import { request } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { StationImportRepository } from '../station-import.repository';
import { rebuildStationHeads } from '../station-materialization';
import type { SourceHttpRequest,SourceHttpResponse } from './catalogue-source';
import { StationSourceRegistry } from './catalogue-source';

export async function requestStationSource(input:SourceHttpRequest,signal:AbortSignal):Promise<SourceHttpResponse>{
  const url=new URL(input.url);
  if(url.protocol!=='https:'||url.username||url.password||url.searchParams.has('key'))throw new Error('Invalid station provider URL');
  const combined=AbortSignal.any([signal,AbortSignal.timeout(input.timeoutMs)]);
  return new Promise((resolve,reject)=>{
    const req=request(url,{method:'GET',signal:combined,headers:{Accept:'application/json','User-Agent':'ChargeRoad-station-import/1.0',
      ...input.headers,...(input.body===undefined?{}:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(input.body)})}},res=>{
      const chunks:Buffer[]=[];let size=0;
      res.on('data',(b:Buffer)=>{size+=b.length;if(size>input.maxBytes)res.destroy(new Error('Station provider response size exceeded'));else chunks.push(b);});
      res.on('error',()=>reject(new Error('Station provider response interrupted')));
      res.on('end',()=>{
        if(res.statusCode!==200){
          const error=Object.assign(new Error('Station provider HTTP '+res.statusCode),{status:res.statusCode,retryAfter:res.headers['retry-after']});
          reject(error);return;
        }
        const bytes=Buffer.concat(chunks);
        if(Object.values(input.headers??{}).some(v=>v.length>12&&bytes.includes(Buffer.from(v)))){
          reject(new Error('Station provider echoed sensitive header'));return;
        }
        resolve({bytes,retrievedAt:new Date().toISOString()});
      });
    });
    // Do not expose request objects, headers, provider response bodies, or credentials in CLI errors.
    req.on('error',()=>reject(new Error(combined.aborted?'Station provider request aborted':'Station provider network error')));
    req.end(input.body);
  });
}

export class StationSourceService {
  constructor(private readonly database:DatabaseService,readonly registry:StationSourceRegistry,
    private readonly transport=requestStationSource){}
  async sync(key:string,countryCode='TR',signal:AbortSignal=new AbortController().signal){
    const adapter=this.registry.get(key,countryCode);
    signal.throwIfAborted();
    const token=randomUUID();
    const job=await this.database.pool.query<{generation:string}>(`INSERT INTO station_provider_jobs(provider_key,token,generation,lease_until)
      VALUES($1,$2,1,now()+interval '10 minutes') ON CONFLICT(provider_key) DO UPDATE
      SET token=EXCLUDED.token,generation=station_provider_jobs.generation+1,lease_until=EXCLUDED.lease_until
      WHERE (station_provider_jobs.token IS NULL OR station_provider_jobs.lease_until<=now())
      AND station_provider_jobs.blocked_until<=now() RETURNING generation`,[key,token]);
    if(!job.rowCount)throw new Error('Station provider busy or circuit/backoff active');
    const generation=job.rows[0].generation;
    const guard=async(client:PoolClient)=>{
      const owned=await client.query(`SELECT 1 FROM station_provider_jobs WHERE provider_key=$1 AND token=$2
        AND generation=$3 AND lease_until>clock_timestamp() FOR UPDATE`,[key,token,generation]);
      if(!owned.rowCount)throw new Error('Station provider lease expired; stale worker rejected');
      signal.throwIfAborted();
    };
    try{
      const acquired=await adapter.collect(countryCode,{signal,request:async input=>{
        const renewed=await this.database.pool.query(`UPDATE station_provider_jobs SET lease_until=now()+interval '10 minutes'
          WHERE provider_key=$1 AND token=$2 AND generation=$3 AND lease_until>now() RETURNING 1`,[key,token,generation]);
        if(!renewed.rowCount)throw new Error('Station provider lease expired');
        signal.throwIfAborted();
        for(let attempt=0;;attempt++){
          const gate=await this.database.pool.query(`INSERT INTO station_source_fetch_gates(source_key,request_class,next_allowed_at)
            VALUES($1,$2,now()+$3*interval '1 millisecond') ON CONFLICT(source_key,request_class) DO UPDATE
            SET next_allowed_at=EXCLUDED.next_allowed_at WHERE station_source_fetch_gates.next_allowed_at<=now() RETURNING 1`,
            [key,input.requestClass,input.minIntervalMs]);
          if(gate.rowCount)break;
          if(input.minIntervalMs>5000||attempt>=2)throw new Error('Station provider quota reserved');
          await delay(input.minIntervalMs+50,undefined,{signal});
        }
        return this.transport(input,signal);
      }});
      if(acquired.package.source.key!==key)throw new Error('Station adapter returned a different source identity');
      const result=await new StationImportRepository(this.database).publish(acquired.package,acquired.rawBytes,{guard,policy:this.registry.policy});
      await this.database.pool.query(`UPDATE station_provider_jobs SET token=NULL,lease_until=NULL,consecutive_failures=0
        WHERE provider_key=$1 AND token=$2 AND generation=$3`,[key,token,generation]);
      return {...result,policyVersion:this.registry.policy.version};
    }catch(error){
      const e=error as {status?:number;retryAfter?:string};
      const retrySeconds=e.retryAfter?(Number.isFinite(Number(e.retryAfter))?Number(e.retryAfter):
        (Date.parse(e.retryAfter)-Date.now())/1000):3600;
      const backoff=e.status===429?Math.min(86400,Math.max(60,Number.isFinite(retrySeconds)?retrySeconds:3600)):0;
      await this.database.pool.query(`UPDATE station_provider_jobs SET token=NULL,lease_until=NULL,
        consecutive_failures=consecutive_failures+1,blocked_until=GREATEST(blocked_until,
          now()+CASE WHEN $4>0 THEN $4 WHEN consecutive_failures>=2 THEN 60 ELSE 0 END*interval '1 second')
        WHERE provider_key=$1 AND token=$2 AND generation=$3`,[key,token,generation,backoff]);
      throw error;
    }
  }
  async rebuild(){
    const client=await this.database.pool.connect();
    try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('chargeroad:station-publication'))");
      await rebuildStationHeads(client,this.registry.policy);await client.query('COMMIT');return {policyVersion:this.registry.policy.version};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
}
