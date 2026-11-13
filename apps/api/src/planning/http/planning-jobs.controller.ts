import {Body,Controller,Delete,Get,HttpException,Param,Post,Req,Res} from '@nestjs/common';
import type {Request,Response} from 'express';
import {planningApiRequestSchema} from '@chargeroad/shared';
import {z} from 'zod';
import {PlanningJobsStore} from './planning-jobs.store';
import {RateLimitPolicy} from '../../security/rate-limit.guard';
import {encodePlanningResponse} from './planning-response';
import {validatePlanningRequest} from './planning-request';
@Controller('planning-jobs')
export class PlanningJobsController {
 constructor(private readonly store:PlanningJobsStore){}
 private id(id:string){if(!z.string().uuid().safeParse(id).success)throw new HttpException('Planning job not found',404);return id;}
 @Post() @RateLimitPolicy('planning')
 async create(@Body() raw:unknown,@Req() req:Request,@Res({passthrough:true}) res:Response){
  const owner=this.store.owner(req.headers.authorization),input=validatePlanningRequest(raw);
  res.setHeader('Cache-Control','no-store');return this.store.create(input,owner);
 }
 @Get(':id') @RateLimitPolicy('general')
 async status(@Param('id') id:string,@Req() req:Request,@Res({passthrough:true}) res:Response){res.setHeader('Cache-Control','no-store');
  return this.store.status(this.id(id),this.store.owner(req.headers.authorization));}
 @Delete(':id') @RateLimitPolicy('planning')
 async cancel(@Param('id') id:string,@Req() req:Request,@Res({passthrough:true}) res:Response){res.setHeader('Cache-Control','no-store');
  return this.store.cancel(this.id(id),this.store.owner(req.headers.authorization));}
 @Get(':id/result') @RateLimitPolicy('general')
 async result(@Param('id') id:string,@Req() req:Request,@Res() res:Response){
  const result=await this.store.result(this.id(id),this.store.owner(req.headers.authorization)),controller=new AbortController();
  const closed=()=>{if(!res.writableEnded)controller.abort();};res.once('close',closed);
  try{const encoded=await encodePlanningResponse(result,req.headers['accept-encoding'],controller.signal);
   res.setHeader('Cache-Control','no-store');res.vary('Accept-Encoding');res.type('application/json');if(encoded.encoding)res.setHeader('Content-Encoding',encoded.encoding);res.send(encoded.body);
  }finally{res.removeListener('close',closed);}
 }
}
