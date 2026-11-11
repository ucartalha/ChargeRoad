import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { VehiclesController } from './vehicles.controller';
import { VehiclesRepository } from './vehicles.repository';
import { VehicleEnergyProvider } from '../providers/vehicle-energy-provider';
import { DbVehicleEnergyProvider } from './knowledge/db-vehicle-energy.provider';

@Module({
  imports: [DatabaseModule],
  controllers: [VehiclesController],
  providers: [VehiclesRepository, {provide:VehicleEnergyProvider,useClass:DbVehicleEnergyProvider}],
  exports: [VehiclesRepository,VehicleEnergyProvider],
})
export class VehiclesModule {}
