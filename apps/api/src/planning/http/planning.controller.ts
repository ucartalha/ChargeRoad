import {Body,Controller,HttpCode,HttpException,Post,Req,Res} from '@nestjs/common';
import type {Request,Response} from 'express';
import {planningApiRequestSchema} from '@chargeroad/shared';
import {meters} from '../../roads/geometry';
import {RateLimitPolicy} from '../../security/rate-limit.guard';
import {PlanningHttpService} from './planning-http.service';
import {PLANNING_HTTP_POLICY} from './planning-http-policy';
import {requestId} from './planning-http-errors';
import {encodePlanningResponse} from './planning-response';
import {validatePlanningRequest} from './planning-request';
@Controller('plans') @RateLimitPolicy('planning')
export class PlanningController {
  constructor(private readonly service:PlanningHttpService){}
  @Post() @HttpCode(200)
  async plan(@Body() raw:unknown,@Req() req:Request,@Res() res:Response){
    requestId(req,res);const input=validatePlanningRequest(raw);requestId(req,res,input.requestId);
    const cancel=new AbortController(),abort=()=>cancel.abort(new Error('Planning caller disconnected')),closed=()=>{if(!res.writableEnded)abort();};
    req.once('aborted',abort);res.once('close',closed);if(req.aborted||res.destroyed)abort();
    try{const result=await this.service.plan(input,cancel.signal);
      const encoded=await encodePlanningResponse(result,req.headers['accept-encoding'],cancel.signal);
      if(result.status==='provider_error'||result.status==='computation_limit'){res.status(503);res.setHeader('Retry-After',String(result.metadata.retryAfterSeconds??1));}
      res.vary('Accept-Encoding');res.type('application/json');if(encoded.encoding)res.setHeader('Content-Encoding',encoded.encoding);
      res.send(encoded.body);
    }catch(error){if(cancel.signal.aborted)throw new HttpException({code:'CLIENT_REQUEST_CANCELLED'},499);throw error;}
    finally{req.removeListener('aborted',abort);res.removeListener('close',closed);}
  }
}
