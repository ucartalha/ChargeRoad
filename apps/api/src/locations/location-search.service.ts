import {createHash} from 'node:crypto';
import {HttpException,Inject,Injectable} from '@nestjs/common';
import {locationSearchResponseSchema} from '@chargeroad/shared';
import {DatabaseService} from '../database/database.service';
import {GEOCODING_CONFIG,GeocodingRegistry} from './geocoding-provider';
import type {GeocodingConfig} from './geocoding-provider';
@Injectable()
export class LocationSearchService {
  private pending=0;
  constructor(private readonly database:DatabaseService,private readonly registry:GeocodingRegistry,@Inject(GEOCODING_CONFIG) private readonly config:GeocodingConfig){}
  async search(query:string,signal:AbortSignal){
    if(!this.config.enabled)throw new HttpException({code:'GEOCODING_DISABLED',message:'Adres araması şu anda kullanılamıyor.'},503);
    if(this.pending>=4)throw new HttpException({code:'GEOCODING_BUSY',retryAfterSeconds:2},503);this.pending++;
    const bounded=AbortSignal.any([signal,AbortSignal.timeout(this.config.timeoutMs)]);
    const key=createHash('sha256').update(JSON.stringify([this.config.providerId,this.config.baseUrl,'1',query.normalize('NFC').toLocaleLowerCase('tr')])).digest('hex');
    const providerKey=createHash('sha256').update(this.config.providerId+this.config.baseUrl).digest('hex');
    try{bounded.throwIfAborted();const cached=await this.database.pool.query('SELECT payload FROM geocoding_search_cache WHERE cache_key=$1 AND expires_at>clock_timestamp()',[key]);
      if(cached.rows[0]){const parsed=locationSearchResponseSchema.safeParse(cached.rows[0].payload);if(parsed.success)return parsed.data;}
      bounded.throwIfAborted();
      // Reserve the entire provider timeout + cooldown atomically across all instances; no queued requests or open transaction.
      const claimed=await this.database.pool.query(`INSERT INTO geocoding_provider_budget(provider_key,day,requests,next_at)
        VALUES ($1,(clock_timestamp() AT TIME ZONE 'UTC')::date,1,clock_timestamp()+interval '7 seconds')
        ON CONFLICT(provider_key) DO UPDATE SET day=EXCLUDED.day,
          requests=CASE WHEN geocoding_provider_budget.day=EXCLUDED.day THEN geocoding_provider_budget.requests+1 ELSE 1 END,next_at=EXCLUDED.next_at
        WHERE geocoding_provider_budget.next_at<=clock_timestamp() AND
          (geocoding_provider_budget.day<>EXCLUDED.day OR geocoding_provider_budget.requests<$2) RETURNING provider_key`,[providerKey,this.config.dailyLimit]);
      if(!claimed.rowCount)throw new HttpException({code:'GEOCODING_BUDGET',message:'Adres araması meşgul; biraz sonra tekrar deneyin.',retryAfterSeconds:7},503);
      bounded.throwIfAborted();const data=locationSearchResponseSchema.parse(await this.registry.get(this.config.providerId).search(query,bounded));
      await this.database.pool.query('DELETE FROM geocoding_search_cache WHERE expires_at<=clock_timestamp()');
      await this.database.pool.query(`INSERT INTO geocoding_search_cache(cache_key,payload,expires_at) SELECT $1,$2::jsonb,clock_timestamp()+interval '24 hours'
        WHERE (SELECT count(*) FROM geocoding_search_cache)<5000 ON CONFLICT(cache_key) DO UPDATE SET payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at`,[key,JSON.stringify(data)]);
      return data;
    }catch(error){if(error instanceof HttpException)throw error;
      throw new HttpException({code:'GEOCODING_UNAVAILABLE',message:'Adres araması tamamlanamadı. Tekrar deneyin.',retryAfterSeconds:7},503);
    }finally{this.pending--;}
  }
}
