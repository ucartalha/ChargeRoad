import {roadConfig} from '../road-policy';
import {roadBudgetPolicy,roadCacheRevision} from '../road-source-policy';
import {config} from './fixtures';
describe('Self-hosted capacity is separate from public daily quota',()=>{
 it('isolates endpoints, retains same-endpoint sharing and does not reapply public 100/day internally',()=>{
  const internal={...config,deploymentMode:'self_hosted' as const,baseUrl:'http://127.0.0.1:8003'};
  const a=roadBudgetPolicy(internal,internal.providerId,internal.baseUrl+'/route'),b=roadBudgetPolicy(internal,internal.providerId,internal.baseUrl+'/trace_attributes');
  expect(a.dailyLimit).toBeNull();expect(a.key).toBe(b.key);expect(a.key).not.toBe(config.providerId);
  const other={...internal,baseUrl:'http://127.0.0.1:8002'};expect(roadBudgetPolicy(other,other.providerId,other.baseUrl+'/route').key).not.toBe(a.key);
  expect(roadBudgetPolicy(internal,'overpass-osm','https://overpass-api.de/api/interpreter')).toEqual({key:'overpass-osm',dailyLimit:100,kind:'external_daily'});
 });
 it('partitions graph, DEM, engine and manual revision caches without secrets or budget reset',()=>{
  const c={...config,deploymentMode:'self_hosted' as const},original=roadCacheRevision(c,c.providerId,c.baseUrl+'/route');
  for(const patch of [{graphVersion:'new'},{demVersion:'new'},{engineVersion:'3.9.1'},{cacheRevision:'new'}])expect(roadCacheRevision({...c,...patch},c.providerId,c.baseUrl+'/route')).not.toBe(original);
  expect(original).toContain('unknown');expect(roadCacheRevision(config,'overpass-osm','https://overpass-api.de')).toBe('');
 });
 it('keeps the loopback development override as a safety limit, never as an external quota increase',()=>{
  const original={...process.env};try{process.env.NODE_ENV='test';process.env.ROAD_ROUTING_PROVIDER_ID='valhalla-osm';process.env.ROAD_ROUTING_BASE_URL='http://127.0.0.1:8003';
   delete process.env.ROAD_ROUTING_DEPLOYMENT_MODE;delete process.env.ROAD_ROUTING_SELF_HOSTED_DAILY_SAFETY_LIMIT;process.env.ROAD_ROUTING_DAILY_REQUEST_LIMIT='1000';
   expect(roadConfig()).toMatchObject({deploymentMode:'self_hosted',dailyRequestLimit:100,selfHostedDailySafetyLimit:1000});
   process.env.ROAD_ROUTING_BASE_URL='https://valhalla1.openstreetmap.de';process.env.NODE_ENV='production';process.env.ROAD_ROUTING_PILOT_ENABLED='true';expect(()=>roadConfig()).toThrow('production');
  }finally{process.env=original;}
 });
});
