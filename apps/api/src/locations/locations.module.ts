import {Body,Controller,HttpCode,HttpException,Module,Post,Req,Res} from '@nestjs/common';
import type {Request,Response} from 'express';
import {locationSearchRequestSchema} from '@chargeroad/shared';
import {DatabaseModule} from '../database/database.module';
import {RateLimitPolicy} from '../security/rate-limit.guard';
import {GEOCODING_CONFIG,GeocodingRegistry,geocodingConfig} from './geocoding-provider';
import type {GeocodingConfig} from './geocoding-provider';
import {PhotonProvider} from './photon-provider';
import {LocationSearchService} from './location-search.service';
@Controller('locations') @RateLimitPolicy('general')
export class LocationsController {
  constructor(private readonly service:LocationSearchService){}
  @Post('search') @HttpCode(200) async search(@Body() raw:unknown,@Req() req:Request,@Res({passthrough:true}) res:Response){
    const parsed=locationSearchRequestSchema.safeParse(raw);if(!parsed.success)throw new HttpException({code:'INVALID_LOCATION_QUERY'},400);
    const cancel=new AbortController(),abort=()=>cancel.abort(),close=()=>{if(!res.writableEnded)abort();};req.once('aborted',abort);res.once('close',close);
    try{return await this.service.search(parsed.data.query,cancel.signal);}catch(error){if(error instanceof HttpException){const body=error.getResponse();
      if(typeof body==='object'&&'retryAfterSeconds' in body)res.setHeader('Retry-After',String(body.retryAfterSeconds));}throw error;}
    finally{req.removeListener('aborted',abort);res.removeListener('close',close);}
  }
}
@Module({imports:[DatabaseModule],controllers:[LocationsController],providers:[LocationSearchService,
  {provide:GEOCODING_CONFIG,useFactory:geocodingConfig},
  {provide:GeocodingRegistry,useFactory:(config:GeocodingConfig)=>new GeocodingRegistry([new PhotonProvider(config.baseUrl)]),inject:[GEOCODING_CONFIG]}]})
export class LocationsModule {}
