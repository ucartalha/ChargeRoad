import { Controller, Get } from '@nestjs/common';
import { SkipRateLimit } from './security/rate-limit.guard';

@Controller()
export class AppController {
  @Get('health')
  @SkipRateLimit()
  getHealth() {
    return {
      status: 'ok',
      service: 'chargeroad-api',
      timestamp: new Date().toISOString(),
    };
  }
}
