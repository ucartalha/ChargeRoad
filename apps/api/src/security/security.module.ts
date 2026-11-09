import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module';
import { RateLimitStore } from './rate-limit.store';
import { PostgresRateLimitStore } from './postgres-rate-limit.store';
import { RATE_LIMIT_OPTIONS, rateLimitOptions } from './rate-limit.config';
import { RateLimitGuard } from './rate-limit.guard';

@Module({
  imports: [DatabaseModule],
  providers: [
    PostgresRateLimitStore,
    { provide: RateLimitStore, useExisting: PostgresRateLimitStore },
    { provide: RATE_LIMIT_OPTIONS, useFactory: rateLimitOptions },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [RateLimitStore],
})
export class SecurityModule {}
