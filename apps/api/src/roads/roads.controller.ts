import { BadRequestException,Body,Controller,HttpException,HttpCode,Post,Req,Res } from '@nestjs/common';
import type { Request,Response } from 'express';
import { roadRoutingRequestSchema,stationRoadAccessRequestSchema } from '@chargeroad/shared';
import { RoadRoutingService } from './road-service';
import { RoadProviderError } from './road-client';
import { RateLimitPolicy } from '../security/rate-limit.guard';

@Controller('roads')
@RateLimitPolicy('general')
export class RoadsController {
  constructor(private readonly service:RoadRoutingService){}
  @Post('routes') @HttpCode(200) async routes(@Body() raw:unknown,@Req() request:Request,@Res({passthrough:true}) response:Response){
    const parsed=roadRoutingRequestSchema.safeParse(raw);if(!parsed.success)throw new BadRequestException('Invalid road route request');
    return this.execute(signal=>this.service.routes(parsed.data,signal),request,response);
  }
  @Post('station-access') @HttpCode(200) async access(@Body() raw:unknown,@Req() request:Request,@Res({passthrough:true}) response:Response){
    const parsed=stationRoadAccessRequestSchema.safeParse(raw);if(!parsed.success)throw new BadRequestException('Invalid station access request');
    return this.execute(signal=>this.service.stationAccess(parsed.data,signal),request,response);
  }
  private async execute<T>(run:(signal:AbortSignal)=>Promise<T>,request:Request,response:Response){
    const controller=new AbortController();const cancel=()=>controller.abort();request.once('aborted',cancel);
    const closed=()=>{if(!response.writableEnded)cancel();};response.once('close',closed);
    try{return await run(AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]));}
    catch(error){if(error instanceof RoadProviderError)throw new HttpException(error.message,error.status===429?429:error.status===422?422:503);
      throw new HttpException('Road provider response could not be normalized',502);}
    finally{request.removeListener('aborted',cancel);response.removeListener('close',closed);}
  }
}
