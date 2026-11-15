import {randomUUID,createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseService} from '../src/database/database.service';
import {roadConfig,ROAD_SEGMENTATION} from '../src/roads/road-policy';
import {RoadRoutingService,RoadAdapterRegistry} from '../src/roads/road-service';
import {ValhallaRoadAdapter} from '../src/roads/valhalla-adapter';
import {PgRoadClient} from '../src/roads/road-client';
import {OsmWayAttributeProvider} from '../src/roads/osm-attributes';
import {withPlanningMetrics} from '../src/observability/planning-metrics';
import type {PlanningMetricSnapshot} from '../src/observability/planning-metrics';
async function main(){
 if(!process.argv.includes('--allow-local-provider-smoke'))throw new Error('Explicit opt-in flag required');
 const endpoint=process.argv.find(v=>v.startsWith('--endpoint='))?.slice(11)??'http://127.0.0.1:8003',url=new URL(endpoint);
 if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Loopback-only endpoint');
 const database=new DatabaseService();try{
  const config={...roadConfig(),enabled:true,providerId:'valhalla-self-hosted',baseUrl:endpoint,deploymentMode:'self_hosted' as const,overpassEnabled:false,
   cacheRevision:'perf001-'+Date.now().toString(16)};
  const service=new RoadRoutingService(config,new RoadAdapterRegistry([new ValhallaRoadAdapter(config)]),new PgRoadClient(database,config,process.env.RATE_LIMIT_IP_HASH_SECRET??''),
   new OsmWayAttributeProvider(database,config),database);
  const request={schemaVersion:'1.0.0' as const,origin:{latitude:39.9,longitude:32.8},destination:{latitude:39.91,longitude:32.8},departureAt:new Date(Date.now()+60000).toISOString(),
   alternatives:1,avoidTolls:false,avoidFerries:false,segmentationPolicy:ROAD_SEGMENTATION};
  const groups=[] as Record<string,unknown>[];
  for(const phase of ['pg_cache_cold','pg_cache_warm']){let snapshot!:PlanningMetricSnapshot;
   const result=await withPlanningMetrics(randomUUID(),()=>service.routes(request,AbortSignal.timeout(90000)),{enabled:true,scope:'provider_smoke',sink:s=>snapshot=s});
   if(!result.data?.routes.length)throw new Error('No fixture route');
   groups.push({phase,n:1,durationMs:snapshot.durationMs,stages:snapshot.stages,counters:snapshot.counters,
    resultChecksum:createHash('sha256').update(JSON.stringify(result)).digest('hex'),sourceVersion:result.data.routes[0].source.version,
    warnings:result.data.routes[0].metadata?.warnings,quality:[...new Set(result.data.routes[0].segments.map(s=>s.elevationQuality))]});
  }
  const report={generatedAt:new Date().toISOString(),mode:'opt_in_loopback_self_hosted_only',cache:'new dedicated revision namespace; shared cache/budget tables were not cleared',
   engineCacheState:'unknown; this is PG cache cold/warm, not cold Valhalla or cold OS disk',fixture:'public Ankara A/B diagnostic points',
   inputChecksum:createHash('sha256').update(JSON.stringify(request)).digest('hex'),n:1,percentiles:null,groups,
   publicManagedProviderMeasurement:'NOT_RUN',fieldVerified:false,demLicenseAcceptance:'open',note:'No plan/SOC/GPS/secret/URL payload is emitted. These two samples are not a latency SLA.'};
  writeFileSync(resolve(__dirname,'../../../docs/validation/perf-baseline-2026-11-13-local-provider.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
 }finally{await database.onModuleDestroy();}
}
void main().catch(()=>{console.error('Local provider measurement failed; no raw provider/user payload is logged.');process.exitCode=1;});
