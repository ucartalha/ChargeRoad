import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { StationDataProvider } from '../providers/station-data-provider';
import { DbStationDataProvider } from './db-station.provider';
import { StationsRepository } from './stations.repository';
import { StationsController } from './stations.controller';
import { StationSourceService } from './sources/source-service';
import { createStationSourceService } from './sources/create-source-service';

@Module({imports:[DatabaseModule],controllers:[StationsController],providers:[StationsRepository,
  {provide:StationSourceService,useFactory:createStationSourceService,inject:[DatabaseService]},
  {provide:StationDataProvider,useFactory:(database:DatabaseService)=>new DbStationDataProvider(database),inject:[DatabaseService]}],
  exports:[StationDataProvider,StationSourceService]})
export class StationsModule {}
