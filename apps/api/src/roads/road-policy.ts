import { z } from 'zod';
import type { SegmentationPolicy } from '@chargeroad/shared';

export const ROAD_SEGMENTATION:SegmentationPolicy={id:'road-segments',version:'1.0.0',maxDistanceMeters:1000,maxDurationSeconds:60,
  splitAtSpeedChangeKph:10,splitAtGradeChangePercent:3,splitAtBearingChangeDegrees:45,maxWeatherTimeStepSeconds:900,
  splitAtRoadClassChanges:true,splitAtChargingAccess:true};
const endpoint=z.string().url().refine(v=>{const u=new URL(v);return !u.username&&!u.password&&!u.search&&!u.hash&&
  (u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)));},'Use a credential-free HTTPS service endpoint');
export const roadConfigSchema=z.object({
  enabled:z.boolean(),providerId:z.string().min(1),baseUrl:endpoint,overpassUrl:endpoint,
  usePublicDemo:z.boolean(),overpassEnabled:z.boolean(),clientId:z.string().min(1),
  dailyRequestLimit:z.number().int().min(1).max(1000),minIntervalMs:z.number().int().min(1100),
  maxActions:z.number().int().min(1).max(20),maxAlternatives:z.number().int().min(1).max(3),
  maxPoints:z.number().int().min(100).max(20000),maxSegments:z.number().int().min(100).max(10000),
  timeoutMs:z.number().int().min(1000).max(30000),cacheSeconds:z.number().int().min(1).max(3600),
}).strict();
export type RoadConfig=z.infer<typeof roadConfigSchema>;
export function roadConfig():RoadConfig{
  const baseUrl=process.env.ROAD_ROUTING_BASE_URL||'https://valhalla1.openstreetmap.de';
  const usePublicDemo=new URL(baseUrl).hostname==='valhalla1.openstreetmap.de';
  const config=roadConfigSchema.parse({enabled:process.env.ROAD_ROUTING_PILOT_ENABLED==='true',
    providerId:process.env.ROAD_ROUTING_PROVIDER_ID||'valhalla-osm',baseUrl,
    overpassUrl:process.env.ROAD_OSM_TAGS_URL||'https://overpass-api.de/api/interpreter',usePublicDemo,
    overpassEnabled:process.env.ROAD_OSM_TAGS_ENABLED==='true',clientId:'chargeroad-local-development',
    dailyRequestLimit:100,minIntervalMs:1100,maxActions:12,maxAlternatives:3,maxPoints:20000,maxSegments:10000,timeoutMs:25000,cacheSeconds:3600});
  // Public demo/Overpass instances are development probes, not production service dependencies.
  if(process.env.NODE_ENV==='production'&&config.enabled&&
    (config.usePublicDemo||(config.overpassEnabled&&new URL(config.overpassUrl).hostname==='overpass-api.de')))
    throw new Error('Public road demo services cannot be enabled in production');
  return config;
}
