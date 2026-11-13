import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DatabaseService} from '../src/database/database.service';
import {createRoadService} from '../src/roads/roads.module';
import {ROAD_SEGMENTATION,roadConfig} from '../src/roads/road-policy';
import {RoadProviderError} from '../src/roads/road-client';
// Public city landmarks only. Never export raw provider payloads (which can echo keys).
async function main(){const db=new DatabaseService();try{
 if(roadConfig().providerId!=='geoapify')throw new Error('Select geoapify explicitly');
 const service=createRoadService(db),report:any={generatedAt:new Date().toISOString(),provider:'geoapify',routes:[]};
 for(const [name,origin,destination] of [
  ['Ankara short',{latitude:39.9208,longitude:32.8541},{latitude:39.9167,longitude:32.8597}],
  ['Istanbul Ankara',{latitude:41.0082,longitude:28.9784},{latitude:39.9334,longitude:32.8597}],
 ] as const){const start=performance.now(),request={schemaVersion:'1.0.0' as const,origin,destination,departureAt:new Date(Date.now()+180000).toISOString(),alternatives:1,
   avoidTolls:false,avoidFerries:true,segmentationPolicy:ROAD_SEGMENTATION};
  const result=await service.routes(request,AbortSignal.timeout(90000)),route=result.data?.routes[0];
  report.routes.push({name,elapsedMs:Math.round(performance.now()-start),distanceMeters:route?.distanceMeters,seconds:route?.drivingDurationSeconds,
   segments:route?.segments.length,elevationSegments:route?.segments.filter(s=>s.elevationProfile!==null).length,
   speedLimitKnownMeters:route?.metadata?.speedLimitKnownMeters,speedLimitUnknownMeters:route?.metadata?.speedLimitUnknownMeters,
   limitsKph:[...new Set(route?.segments.map(s=>s.speedLimitKph).filter(s=>s!==null))],warnings:route?.metadata?.warnings,
   attributions:route?.metadata?.attributions});
  const before=(await db.pool.query("SELECT used FROM road_provider_budget WHERE provider_id='geoapify'")).rows[0]?.used??0;
  await service.preview(request,AbortSignal.timeout(30000));
  const after=(await db.pool.query("SELECT used FROM road_provider_budget WHERE provider_id='geoapify'")).rows[0]?.used??0;
  report.routes.at(-1).previewExtraCalls=after-before;
 }
 report.budget=(await db.pool.query("SELECT provider_id,used,day FROM road_provider_budget WHERE provider_id='geoapify'")).rows;
 const target=resolve(__dirname,'../../../docs/validation');await mkdir(target,{recursive:true});await writeFile(resolve(target,'geoapify-pilot.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}finally{await db.onModuleDestroy();}}
void main().catch(error=>{console.error(error instanceof RoadProviderError?error.code+': '+error.message:error instanceof Error?error.message:'Validation failed');process.exitCode=1;});
