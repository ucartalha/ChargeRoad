import { Module } from '@nestjs/common';
import type { DynamicModule, Provider } from '@nestjs/common';
import { PlanningCoordinator } from './planning-coordinator';

@Module({})
export class PlanningModule {
  // Concrete providers and our engine must be bound explicitly. There are no fake production defaults.
  static register(adapters: Provider[]): DynamicModule {
    return { module: PlanningModule, providers: [...adapters,PlanningCoordinator], exports: [PlanningCoordinator] };
  }
}
