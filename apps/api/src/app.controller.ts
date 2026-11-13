import { Controller, Get,ServiceUnavailableException } from '@nestjs/common';
import { SkipRateLimit } from './security/rate-limit.guard';
import {DatabaseService} from './database/database.service';

@Controller()
export class AppController {
  constructor(private readonly database:DatabaseService){}
  @Get('ready')
  @SkipRateLimit()
  async getReady(){
    try{await this.database.pool.query('SELECT 1');}
    catch{throw new ServiceUnavailableException({status:'unavailable',service:'chargeroad-api',database:'unavailable'});}
    return {status:'ok',service:'chargeroad-api',database:'ready',timestamp:new Date().toISOString()};
  }
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
