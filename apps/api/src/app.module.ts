import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { VehiclesModule } from './vehicles/vehicles.module';
import { SecurityModule } from './security/security.module';

@Module({
  imports: [VehiclesModule, SecurityModule],
  controllers: [AppController],
})
export class AppModule {}
