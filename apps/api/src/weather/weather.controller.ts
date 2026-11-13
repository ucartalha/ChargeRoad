import {BadRequestException,Body,Controller,HttpCode,Post,Req,Res,ServiceUnavailableException} from '@nestjs/common';
import type {Request,Response} from 'express';
import {weatherBatchRequestSchema,roadPreviewRequestSchema,roadRoutingResultSchema} from '@chargeroad/shared';
import {WeatherService} from './weather.service';
import {RateLimitPolicy} from '../security/rate-limit.guard';
import {WEATHER_POLICY} from './weather-policy';
import {RoutingProvider} from '../providers/routing-provider';
import {ROAD_SEGMENTATION} from '../roads/road-policy';
import {meters,simplifyDisplayGeometry} from '../roads/geometry';

@Controller('weather')
@RateLimitPolicy('general')
export class WeatherController {
  constructor(private readonly service:WeatherService,private readonly roads:RoutingProvider){}
  @Post('route-preview') @HttpCode(200) @RateLimitPolicy('planning')
  async preview(@Body() raw:unknown,@Req() request:Request,@Res({passthrough:true}) response:Response){
    const parsed=roadPreviewRequestSchema.safeParse(raw);if(!parsed.success)throw new BadRequestException('Invalid weather route preview');
    const input=parsed.data,distance=meters(input.origin,input.destination);
    if(distance<1||distance>2000000)throw new BadRequestException('Invalid preview distance');
    return this.execute(async signal=>{
      const packet=await this.roads.routes({...input,schemaVersion:'1.0.0',alternatives:1,segmentationPolicy:{...ROAD_SEGMENTATION}},signal);
      const roads=roadRoutingResultSchema.nullable().parse(packet.data);
      if(!roads)return {status:'preliminary_route',route:null,forecasts:[],sampling:null,energyReady:false,reasons:['ROAD_ROUTE_NOT_FOUND']};
      const route=roads.routes[0],preview=await this.service.forPreview({route,departureAt:input.departureAt,stops:[]},signal);
      // Keep full server-side geometry/energy segmentation out of the public weather preview.
      return {...preview,route:{id:route.id,distanceMeters:route.distanceMeters,drivingDurationSeconds:route.drivingDurationSeconds,
        geometry:simplifyDisplayGeometry(route.segments.flatMap((s,i)=>i?s.geometry.slice(1):s.geometry)),source:route.source,
        traffic:route.metadata?.traffic??'unknown',attributions:route.metadata?.attributions??[]}};
    },request,response);
  }
  @Post('forecast') @HttpCode(200)
  async route(@Body() raw:unknown,@Req() request:Request,@Res({passthrough:true}) response:Response){
    const parsed=weatherBatchRequestSchema.safeParse(raw);if(!parsed.success)throw new BadRequestException('Invalid weather batch request');
    if(parsed.data.queries.some(q=>Date.parse(q.validAt)<Date.parse(parsed.data.departureAt)))throw new BadRequestException('Weather query precedes departure');
    return this.execute(signal=>this.service.forDeparture(parsed.data.departureAt,parsed.data.queries,signal),request,response);
  }
  private async execute<T>(run:(signal:AbortSignal)=>Promise<T>,request:Request,response:Response){
    const controller=new AbortController(),cancel=()=>controller.abort(),closed=()=>{if(!response.writableEnded)cancel();};
    request.once('aborted',cancel);response.once('close',closed);
    try{return await run(AbortSignal.any([controller.signal,AbortSignal.timeout(WEATHER_POLICY.deadlineMs)]));}
    catch(error){if(controller.signal.aborted)throw error;throw new ServiceUnavailableException('Weather service unavailable');}
    finally{request.removeListener('aborted',cancel);response.removeListener('close',closed);}
  }
}
