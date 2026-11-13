import {createHash} from 'node:crypto';
import type {RoadConfig} from './road-policy';
export function roadBudgetPolicy(config:RoadConfig,providerId:string,url:string){
 const routing=providerId===config.providerId&&new URL(url).origin===new URL(config.baseUrl).origin;
 if(routing&&config.deploymentMode==='self_hosted')return {
  key:'self-hosted:'+providerId+':'+createHash('sha256').update(config.baseUrl).digest('hex').slice(0,16),
  dailyLimit:config.selfHostedDailySafetyLimit??null,kind:'self_hosted_capacity' as const};
 return {key:providerId,dailyLimit:routing?config.dailyRequestLimit:100,kind:'external_daily' as const};
}
export function roadCacheRevision(config:RoadConfig,providerId:string,url:string){
 if(providerId!==config.providerId||new URL(url).origin!==new URL(config.baseUrl).origin)return '';
 if(config.deploymentMode!=='self_hosted'&&!config.engineVersion&&!config.graphVersion&&!config.demVersion&&!config.cacheRevision)return '';
 return JSON.stringify({schema:'road-source/2',deployment:config.deploymentMode??'external',engine:config.engineVersion??'unknown',
  graph:config.graphVersion??'unknown',dem:config.demVersion??'unknown',revision:config.cacheRevision??'unknown'});
}
export function roadSourceVersion(config:RoadConfig){const build=config.cacheRevision?createHash('sha256').update(config.cacheRevision).digest('hex').slice(0,12):'unknown';
 return `engine=${config.engineVersion??'unknown'};graph=${config.graphVersion??'unknown'};dem=${config.demVersion??'unknown'};build=${build}`;}
