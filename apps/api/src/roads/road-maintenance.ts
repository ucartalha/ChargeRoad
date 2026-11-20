import {Injectable,Logger} from '@nestjs/common';
import type {OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {DatabaseService} from '../database/database.service';

/**
 * Road cache cleanup (2026-11-20). road_response_cache rows expire after at most one hour but were never deleted (local DB:
 * 52 434 rows, 904 MB, 464 still valid). Like WeatherMaintenance: a local timer and indexed DELETE, no queue or new service.
 * Rows that a request is still filling (unexpired lease) are kept. Batches keep each statement short.
 */
export const ROAD_CACHE_CLEANUP_POLICY={intervalMs:15*60*1000,firstSweepDelayMs:30*1000,batchRows:5000,maxBatchesPerSweep:20} as const;
type Queryable={query(sql:string,params:unknown[]):Promise<{rowCount:number|null}>};
export async function cleanupRoadCache(pool:Queryable){
  let removed=0;
  for(let batch=0;batch<ROAD_CACHE_CLEANUP_POLICY.maxBatchesPerSweep;batch++){
    const result=await pool.query(`DELETE FROM road_response_cache WHERE request_key IN (SELECT request_key FROM road_response_cache
      WHERE expires_at<=now() AND (token IS NULL OR lease_until IS NULL OR lease_until<=now()) LIMIT $1)`,[ROAD_CACHE_CLEANUP_POLICY.batchRows]);
    const count=result.rowCount??0;removed+=count;if(count<ROAD_CACHE_CLEANUP_POLICY.batchRows)break;
  }
  return removed;
}
@Injectable()
export class RoadMaintenance implements OnModuleInit,OnModuleDestroy {
  private timer:ReturnType<typeof setInterval>|undefined;private first:ReturnType<typeof setTimeout>|undefined;
  private running=false;
  constructor(private readonly database:DatabaseService){}
  onModuleInit(){
    this.first=setTimeout(()=>{void this.sweep();},ROAD_CACHE_CLEANUP_POLICY.firstSweepDelayMs);this.first.unref();
    this.timer=setInterval(()=>{void this.sweep();},ROAD_CACHE_CLEANUP_POLICY.intervalMs);this.timer.unref();
  }
  onModuleDestroy(){if(this.first)clearTimeout(this.first);if(this.timer)clearInterval(this.timer);}
  async sweep(){if(this.running)return;this.running=true;
    // Aggregate count only; no keys or payloads are logged.
    try{const removed=await cleanupRoadCache(this.database.pool);if(removed)new Logger(RoadMaintenance.name).log(JSON.stringify({event:'road_cache_cleanup',removed}));}
    catch{new Logger(RoadMaintenance.name).error('Road cache cleanup failed');}
    finally{this.running=false;}
  }
}
