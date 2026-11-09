import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { VehiclesController } from './vehicles.controller';
import { VehiclesRepository } from './vehicles.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [VehiclesController],
  providers: [VehiclesRepository],
  exports: [VehiclesRepository],
})
export class VehiclesModule {}
