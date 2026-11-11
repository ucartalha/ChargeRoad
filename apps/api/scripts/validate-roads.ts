import { writeFile,readFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { NestFactory } from '@nestjs/core';
import { roadRoutingRequestSchema } from '@chargeroad/shared';
import type { RoadRoutingRequest } from '@chargeroad/shared';
import { DatabaseService } from '../src/database/database.service';
import { createRoadService } from '../src/roads/roads.module';
import { ROAD_SEGMENTATION } from '../src/roads/road-policy';
import { AppModule } from '../src/app.module';

// CLI input is an explicit test/user route, never a hard-coded product corridor.
async function main(){
  const input=process.argv[2];if(!input)throw new Error('Usage: roads:validate REQUEST.json');
  const file=await readFile(resolve(input),'utf8');if(file.length>16384)throw new Error('Road validation input exceeds budget');
  const request:RoadRoutingRequest=roadRoutingRequestSchema.parse({segmentationPolicy:ROAD_SEGMENTATION,...JSON.parse(file)});
  const database=new DatabaseService();let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
  try{
    const service=createRoadService(database),signal=AbortSignal.timeout(90000),start=performance.now();
    const result=await service.routes(request,signal);if(!result.data)throw new Error('No route for validation input');
    const route=result.data.routes[0];
    const withKnown=route.segments.filter(s=>s.speedLimitKph!==null);
    const report:{[key:string]:unknown}={generatedAt:new Date().toISOString(),provider:result.source.sourceId,
      acquisitionElapsedMs:performance.now()-start,alternatives:result.data.routes.length,distanceMeters:route.distanceMeters,
      seconds:route.drivingDurationSeconds,segments:route.segments.length,sourceAttributions:route.metadata?.attributions,
      traffic:route.metadata?.traffic,warnings:route.metadata?.warnings,knownSpeedMeters:route.metadata?.speedLimitKnownMeters,
      unknownSpeedMeters:route.metadata?.speedLimitUnknownMeters,postedLimitsKph:[...new Set(withKnown.map(s=>s.speedLimitKph))],
      altitudeSegments:route.segments.filter(s=>s.elevationProfile!==null).length,
      sourceBudget:(await database.pool.query('SELECT provider_id,used,day FROM road_provider_budget ORDER BY provider_id')).rows};
    // Genuine HTTP check should reuse PG cache rather than repeat provider traffic.
    const before=(await database.pool.query('SELECT sum(used)::int AS n FROM road_provider_budget')).rows[0].n;
    app=await NestFactory.create(AppModule,{logger:false});app.setGlobalPrefix('v1');await app.listen(0,'127.0.0.1');
    const response=await fetch((await app.getUrl())+'/v1/roads/routes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
    if(response.status!==200)throw new Error('Road HTTP validation failed: '+response.status);
    await response.json();
    const after=(await database.pool.query('SELECT sum(used)::int AS n FROM road_provider_budget')).rows[0].n;
    report.http={status:response.status,extraProviderCalls:after-before};
    const matches=await database.pool.query(`SELECT h.location_id FROM station_catalogue_heads h WHERE public_access IS TRUE
      AND lifecycle IN('operating','unknown') AND public.ST_DWithin(h.location_geog,public.ST_SetSRID(public.ST_MakePoint($1,$2),4326)::public.geography,1500)
      ORDER BY public.ST_Distance(h.location_geog,public.ST_SetSRID(public.ST_MakePoint($1,$2),4326)::public.geography) LIMIT 1`,
      [route.segments[Math.floor(route.segments.length/2)].geometry[0].longitude,route.segments[Math.floor(route.segments.length/2)].geometry[0].latitude]);
    if(matches.rowCount){
      const access=await service.stationAccess({roadRequest:request,routeIndex:0,stationIds:[matches.rows[0].location_id]},signal);
      report.stationAccess=access.access.map(a=>({stationId:a.stationId,status:a.status,physicalAccessVerified:a.physicalAccessVerified,
        snapDistanceMeters:a.stationSnapDistanceMeters,additionalDistanceMeters:a.additionalDistanceMeters,
        additionalSeconds:a.additionalDurationSeconds,warnings:a.warnings}));
    }
    const output=resolve(__dirname,'../../../docs/validation/task9-road-validation.json');
    await writeFile(output,JSON.stringify(report,null,2)+'\n');
    const directory=resolve(__dirname,'../../../artifacts/task9-valhalla');await mkdir(directory,{recursive:true});
    await writeFile(resolve(directory,'normalized-route.json'),JSON.stringify(result));
    console.log(JSON.stringify(report,null,2));
  }finally{if(app)await app.close();await database.onModuleDestroy();}
}
void main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:'Road validation failed');process.exitCode=1;});
