import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { RoutingProvider } from '../providers/routing-provider';
import { roadConfig } from './road-policy';
import { PgRoadClient } from './road-client';
import { OsmWayAttributeProvider } from './osm-attributes';
import { ValhallaRoadAdapter } from './valhalla-adapter';
import { GeoapifyRoadAdapter } from './geoapify-adapter';
import { RoadAdapterRegistry,RoadRoutingService } from './road-service';
import { RoadsController } from './roads.controller';
import { RoadMaintenance,ROAD_MEMORY_CACHE,createRoadMemoryCache } from './road-maintenance';
import type { BoundedMemoryCache } from './bounded-memory-cache';
import type { RoadJsonResponse } from './provider-ports';
export function createRoadService(database:DatabaseService,memory?:BoundedMemoryCache<RoadJsonResponse>){const config=roadConfig();
  const adapters=config.providerId==='geoapify'?[new GeoapifyRoadAdapter(config)]:[new ValhallaRoadAdapter(config)];
  return new RoadRoutingService(config,new RoadAdapterRegistry(adapters),
    new PgRoadClient(database,config,process.env.RATE_LIMIT_IP_HASH_SECRET??'',undefined,memory),new OsmWayAttributeProvider(database,config),database);}
@Module({imports:[DatabaseModule],controllers:[RoadsController],providers:[
  {provide:ROAD_MEMORY_CACHE,useFactory:createRoadMemoryCache},
  {provide:RoadRoutingService,useFactory:createRoadService,inject:[DatabaseService,ROAD_MEMORY_CACHE]},
  {provide:RoutingProvider,useExisting:RoadRoutingService},RoadMaintenance],exports:[RoutingProvider,RoadRoutingService]})
export class RoadsModule {}
