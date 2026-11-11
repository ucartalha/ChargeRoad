import {createHmac,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseService} from '../database/database.service';
import {WEATHER_POLICY} from './weather-policy';
import {WeatherUnavailable} from './weather-ports';
import type {WeatherDocument,WeatherTransport} from './weather-ports';

export interface WeatherCallBudget {used:number;limit:number;}
function waitFor<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
  return new Promise((resolve,reject)=>{const cancel=()=>reject(signal.reason);signal.addEventListener('abort',cancel,{once:true});
    work.then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));if(signal.aborted)cancel();});
}
export class WeatherCacheStore {
  constructor(private readonly database:DatabaseService,private readonly transport:WeatherTransport,private readonly secret:string){}
  async get(provider:string,version:string,url:string,signal:AbortSignal,budget:WeatherCallBudget,
    validate:(document:WeatherDocument)=>void):Promise<WeatherDocument>{
    if(this.secret.length<32)throw new WeatherUnavailable('provider_unavailable','Weather cache secret missing');
    const key=createHmac('sha256',this.secret).update('weather-cache/v1\0'+provider+'\0'+version+'\0'+url).digest('hex');
    for(let attempt=0;attempt<210;attempt++){
      signal.throwIfAborted();
      const row=(await this.database.pool.query(`SELECT c.document,c.expires_at>now() AS fresh,c.retry_at>now() AS retry,s.blocked_kind
        FROM weather_forecast_cache c LEFT JOIN weather_provider_state s USING(provider_id) WHERE c.request_key=$1`,[key])).rows[0];
      if(row?.fresh&&row.document)return row.document;
      if(row?.retry)throw new WeatherUnavailable(row.blocked_kind??'provider_unavailable','Weather key backoff');
      const lease=await this.claim(key,provider,budget);
      if(lease){
        // A caller disconnect must not cancel the shared fetch needed by other processes.
        // This detached operation remains bounded by its independent five-second signal.
        const work=this.fetchAndSave(key,provider,lease,row?.document??null,url,validate);
        return waitFor(work,signal);
      }
      await delay(100,undefined,{signal});
    }
    throw new WeatherUnavailable('provider_unavailable','Weather coordination deadline');
  }
  private async claim(key:string,provider:string,budget:WeatherCallBudget):Promise<{token:string;generation:string}|null>{
    const client=await this.database.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '2s'");
      await client.query("SET LOCAL lock_timeout = '250ms'");
      await client.query(`INSERT INTO weather_provider_state(provider_id,day) VALUES($1,(now() AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING`,[provider]);
      const state=(await client.query(`SELECT *,day=(now() AT TIME ZONE 'UTC')::date AS today,blocked_until>now() AS blocked,
        next_allowed_at>now() AS paced FROM weather_provider_state WHERE provider_id=$1 FOR UPDATE`,[provider])).rows[0];
      if(state.blocked)throw new WeatherUnavailable(state.blocked_kind,'Weather provider backoff');
      if(state.today&&state.used>=WEATHER_POLICY.dailyLimit)throw new WeatherUnavailable('budget_exhausted','Weather daily quota');
      // Recheck freshness/ownership under provider lock before charging any budget.
      const existing=(await client.query(`SELECT expires_at>now() AS fresh,token IS NOT NULL AND lease_until>now() AS leased FROM weather_forecast_cache WHERE request_key=$1`,[key])).rows[0];
      if(existing?.fresh||existing?.leased){await client.query('ROLLBACK');return null;}
      if(budget.used>=budget.limit)throw new WeatherUnavailable('budget_exhausted','Weather acquisition budget');
      const active=(await client.query(`SELECT count(*)::int AS n FROM weather_forecast_cache WHERE provider_id=$1 AND token IS NOT NULL AND lease_until>now()`,[provider])).rows[0].n;
      if(state.paced||active>=WEATHER_POLICY.maxConcurrency){await client.query('ROLLBACK');return null;}
      const token=randomUUID();
      const lease=await client.query(`INSERT INTO weather_forecast_cache(request_key,provider_id,token,generation,lease_until)
        VALUES($1,$2,$3,1,now()+$4*interval '1 second') ON CONFLICT(request_key) DO UPDATE
        SET token=EXCLUDED.token,generation=weather_forecast_cache.generation+1,lease_until=EXCLUDED.lease_until
        WHERE weather_forecast_cache.expires_at<=now() AND weather_forecast_cache.retry_at<=now()
          AND (weather_forecast_cache.token IS NULL OR weather_forecast_cache.lease_until<=now()) RETURNING generation`,[key,provider,token,WEATHER_POLICY.leaseSeconds]);
      if(!lease.rowCount){await client.query('ROLLBACK');return null;}
      await client.query(`UPDATE weather_provider_state SET day=(now() AT TIME ZONE 'UTC')::date,
        used=CASE WHEN day=(now() AT TIME ZONE 'UTC')::date THEN used+1 ELSE 1 END,
        next_allowed_at=now()+$2*interval '1 millisecond' WHERE provider_id=$1`,[provider,WEATHER_POLICY.minIntervalMs]);
      budget.used++;
      await client.query('COMMIT');return {token,generation:lease.rows[0].generation};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  private async fetchAndSave(key:string,provider:string,lease:{token:string;generation:string},old:WeatherDocument|null,url:string,
    validate:(document:WeatherDocument)=>void):Promise<WeatherDocument>{
    try{
      const fetchSignal=AbortSignal.timeout(WEATHER_POLICY.fetchTimeoutMs);
      const result=await waitFor(this.transport(url,old?.lastModified??null,fetchSignal),fetchSignal);
      if(result.status===304&&!old)throw new Error('Weather 304 without cached representation');
      const document:WeatherDocument={...result,body:result.status===304?old!.body:result.body,
        lastModified:result.lastModified??(result.status===304?old!.lastModified:null),
        fetchedAt:result.status===304?old!.fetchedAt:result.validatedAt,
        warnings:[...new Set([...(result.status===304?old!.warnings:[]),...result.warnings])]};
      validate(document);
      // Keep the last representation for conditional revalidation, not just until HTTP expiry.
      const retain=Date.parse(document.expiresAt)+WEATHER_POLICY.retentionSeconds*1000;
      const saved=await this.database.pool.query(`UPDATE weather_forecast_cache SET document=$4::jsonb,expires_at=$5,retain_until=$6,
        token=NULL,lease_until=NULL,retry_at='-infinity' WHERE request_key=$1 AND token=$2 AND generation=$3
        AND lease_until>clock_timestamp() RETURNING 1`,[key,lease.token,lease.generation,JSON.stringify(document),document.expiresAt,new Date(retain).toISOString()]);
      if(!saved.rowCount)throw new Error('Weather lease superseded');return document;
    }catch(error){
      const failure=error instanceof WeatherUnavailable?error:new WeatherUnavailable('provider_unavailable','Invalid weather response');
      // Only the current fenced owner may affect shared retry state.
      const released=await this.database.pool.query(`UPDATE weather_forecast_cache SET token=NULL,lease_until=NULL,
        retry_at=now()+$4*interval '1 second',retain_until=GREATEST(retain_until,now()+interval '1 day')
        WHERE request_key=$1 AND token=$2 AND generation=$3 RETURNING 1`,[key,lease.token,lease.generation,failure.retrySeconds]);
      if(released.rowCount)await this.database.pool.query(`UPDATE weather_provider_state SET blocked_until=GREATEST(blocked_until,now()+$2*interval '1 second'),
        blocked_kind=CASE WHEN blocked_until>now() AND blocked_kind='budget_exhausted' THEN blocked_kind ELSE $3 END
        WHERE provider_id=$1`,[provider,failure.retrySeconds,failure.kind]);
      throw failure;
    }
  }
  async cleanup(){
    const removed=await this.database.pool.query(`DELETE FROM weather_forecast_cache WHERE retain_until<=now()
      AND (token IS NULL OR lease_until<=now()) RETURNING 1`);return removed.rowCount??0;
  }
}
