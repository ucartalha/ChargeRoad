import {BadRequestException,Body,Controller,HttpCode,Post,Req,Res,ServiceUnavailableException} from '@nestjs/common';
import type {Request,Response} from 'express';
import {weatherBatchRequestSchema} from '@chargeroad/shared';
import {WeatherService} from './weather.service';
import {RateLimitPolicy} from '../security/rate-limit.guard';
import {WEATHER_POLICY} from './weather-policy';

@Controller('weather')
@RateLimitPolicy('general')
export class WeatherController {
  constructor(private readonly service:WeatherService){}
  @Post('forecast') @HttpCode(200)
  async route(@Body() raw:unknown,@Req() request:Request,@Res({passthrough:true}) response:Response){
    const parsed=weatherBatchRequestSchema.safeParse(raw);if(!parsed.success)throw new BadRequestException('Invalid weather batch request');
    if(parsed.data.queries.some(q=>Date.parse(q.validAt)<Date.parse(parsed.data.departureAt)))throw new BadRequestException('Weather query precedes departure');
    const controller=new AbortController(),cancel=()=>controller.abort(),closed=()=>{if(!response.writableEnded)cancel();};
    request.once('aborted',cancel);response.once('close',closed);
    try{return await this.service.forDeparture(parsed.data.departureAt,parsed.data.queries,AbortSignal.any([controller.signal,AbortSignal.timeout(WEATHER_POLICY.deadlineMs)]));}
    catch(error){if(controller.signal.aborted)throw error;throw new ServiceUnavailableException('Weather service unavailable');}
    finally{request.removeListener('aborted',cancel);response.removeListener('close',closed);}
  }
}
