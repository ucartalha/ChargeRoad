import {createHash} from 'node:crypto';
import type {RoadConfig} from './road-policy';
export function roadBudgetPolicy(config:RoadConfig,providerId:string,url:string){
 const routing=providerId===config.providerId&&new URL(url).origin===new URL(config.baseUrl).origin;
 if(routing&&config.deploymentMode==='self_hosted')return {
  key:'self-hosted:'+providerId+':'+createHash('sha256').update(config.baseUrl).digest('hex').slice(0,16),
  dailyLimit:config.selfHostedDailySafetyLimit??null,minIntervalMs:0,kind:'self_hosted_capacity' as const};
 return {key:providerId,dailyLimit:routing?config.dailyRequestLimit:100,minIntervalMs:config.minIntervalMs,kind:'external_daily' as const};
}
export function roadCacheRevision(config:RoadConfig,providerId:string,url:string){
 if(providerId!==config.providerId||new URL(url).origin!==new URL(config.baseUrl).origin)return '';
 if(config.deploymentMode!=='self_hosted'&&!config.engineVersion&&!config.graphVersion&&!config.demVersion&&!config.cacheRevision)return '';
 return JSON.stringify({schema:'road-source/2',deployment:config.deploymentMode??'external',engine:config.engineVersion??'unknown',
  graph:config.graphVersion??'unknown',dem:config.demVersion??'unknown',revision:config.cacheRevision??'unknown'});
}
export function roadSourceVersion(config:RoadConfig){const build=config.cacheRevision?createHash('sha256').update(config.cacheRevision).digest('hex').slice(0,12):'unknown';
 return `engine=${config.engineVersion??'unknown'};graph=${config.graphVersion??'unknown'};dem=${config.demVersion??'unknown'};build=${build}`;}
/** Station leg cache (2026-11-20). A leg between two charging stations is the same road for every user and every hour
 *  (Valhalla adapter: fixed departure, no traffic), so it may outlive the one-hour road cache. Only with a declared
 *  ROAD_ROUTING_CACHE_REVISION: the cache key then names the dataset, and a new graph/DEM build gets new keys. Station
 *  coordinates are public catalogue data; legs from or to a user position keep config.cacheSeconds. */
export const ROAD_STATION_LEG_CACHE={version:'road-station-leg-cache/1.0.0',defaultSeconds:30*86400,maxSeconds:90*86400} as const;
export function stationLegCacheSeconds(config:RoadConfig):number|undefined{
 if(!config.cacheRevision||!config.stationLegCacheSeconds)return undefined;
 return Math.min(config.stationLegCacheSeconds,ROAD_STATION_LEG_CACHE.maxSeconds);
}
