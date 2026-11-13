import {HttpException} from '@nestjs/common';
import type {NestExpressApplication} from '@nestjs/platform-express';
import type {Request,Response,NextFunction} from 'express';
import {PlanningHttpErrors,isPlanningPath,requestId} from '../planning/http/planning-http-errors';
import {PLANNING_HTTP_POLICY} from '../planning/http/planning-http-policy';
export function configureHttpApi(app:NestExpressApplication,proxies:string[]=[]){
  app.getHttpAdapter().getInstance().set('trust proxy',proxies.length?proxies:false);app.setGlobalPrefix('v1');app.enableCors();
  app.use((req:Request,res:Response,next:NextFunction)=>{
    if(!isPlanningPath(req))return next();requestId(req,res);
    if(!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type']??''))return next(new HttpException({code:'UNSUPPORTED_MEDIA_TYPE'},415));
    const length=req.headers['content-length'];if(length!==undefined&&Number(length)>PLANNING_HTTP_POLICY.maxBodyBytes)return next(new HttpException({code:'REQUEST_TOO_LARGE'},413));
    next();
  });
  app.useBodyParser('json',{limit:100*1024,strict:true,verify:(req:Request,_res:Response,bytes:Buffer)=>{
    if(isPlanningPath(req)&&bytes.length>PLANNING_HTTP_POLICY.maxBodyBytes)throw Object.assign(new Error('Planning payload too large'),{status:413,type:'entity.too.large'});
  }});
  app.useGlobalFilters(new PlanningHttpErrors(app.getHttpAdapter()));
}
