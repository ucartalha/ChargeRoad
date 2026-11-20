import {Injectable,Logger} from '@nestjs/common';
import type {OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {Inject} from '@nestjs/common';
import {DatabaseService} from '../database/database.service';
import {BoundedMemoryCache} from './bounded-memory-cache';
import type {RoadJsonResponse} from './provider-ports';

/** Memory layer budget: one long plan reads ~350 road rows (~16 kB each). Cold = no hit in a 15-minute window. */
export const ROAD_MEMORY_CACHE_POLICY={maxBytes:128*1024*1024,maxEntries:20000,coldWindowMs:15*60*1000,minHitsPerWindow:1} as const;
export const ROAD_MEMORY_CACHE=Symbol('ROAD_MEMORY_CACHE');
export function createRoadMemoryCache(){return new BoundedMemoryCache<RoadJsonResponse>(ROAD_MEMORY_CACHE_POLICY);}

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
  constructor(private readonly database:DatabaseService,@Inject(ROAD_MEMORY_CACHE) private readonly memory:BoundedMemoryCache<RoadJsonResponse>){}
  onModuleInit(){
    this.first=setTimeout(()=>{void this.sweep();},ROAD_CACHE_CLEANUP_POLICY.firstSweepDelayMs);this.first.unref();
    this.timer=setInterval(()=>{void this.sweep();},ROAD_CACHE_CLEANUP_POLICY.intervalMs);this.timer.unref();
  }
  onModuleDestroy(){if(this.first)clearTimeout(this.first);if(this.timer)clearInterval(this.timer);}
  async sweep(){if(this.running)return;this.running=true;
    // Aggregate count only; no keys or payloads are logged.
    try{const removed=await cleanupRoadCache(this.database.pool),memory=this.memory.sweep();
      new Logger(RoadMaintenance.name).log(JSON.stringify({event:'road_cache_cleanup',removed,memory}));}
    catch{new Logger(RoadMaintenance.name).error('Road cache cleanup failed');}
    finally{this.running=false;}
  }
}
