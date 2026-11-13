import {randomUUID} from 'node:crypto';
import {Catch,HttpException,Logger} from '@nestjs/common';
import type {ArgumentsHost,HttpServer} from '@nestjs/common';
import {BaseExceptionFilter} from '@nestjs/core';
import type {Request,Response} from 'express';
import {planningApiErrorSchema} from '@chargeroad/shared';
const ids=new WeakMap<Request,string>();
export const isPlanningPath=(r:Request)=>r.method==='POST'&&/^\/v1\/(?:plans|planning-jobs)\/?$/.test(r.path);
export function requestId(request:Request,response:Response,id?:string){let value=id??ids.get(request);if(!value)value=randomUUID();
  ids.set(request,value);if(!response.headersSent){response.setHeader('X-Request-Id',value);response.setHeader('Cache-Control','no-store');}return value;}
export function planningError(id:string,code:string,message:string,retry?:number,fields?:{path:string;code:string}[]){
  return planningApiErrorSchema.parse({schemaVersion:'1.0.0',requestId:id,status:'error',error:{code,message,
    ...(retry===undefined?{}:{retryAfterSeconds:retry}),...(fields?{fields}:{} )}});
}
@Catch()
export class PlanningHttpErrors extends BaseExceptionFilter {
  private readonly logger=new Logger(PlanningHttpErrors.name);
  private lastErrorAt=0;
  constructor(adapter:HttpServer){super(adapter);}
  catch(exception:unknown,host:ArgumentsHost){
    const r=host.switchToHttp().getRequest<Request>(),response=host.switchToHttp().getResponse<Response>();
    if(!isPlanningPath(r))return super.catch(exception,host);
    if(response.headersSent||response.destroyed)return;
    const e=exception as {status?:number;statusCode?:number;type?:string};
    const rawStatus=exception instanceof HttpException?exception.getStatus():e?.status??e?.statusCode??500;
    const status=Number.isInteger(rawStatus)&&rawStatus>=400&&rawStatus<=599?rawStatus:500;
    const payload=exception instanceof HttpException?exception.getResponse():null;
    const data=payload&&typeof payload==='object'?payload as {code?:string;retryAfterSeconds?:number;fields?:{path:string;code:string}[]}:{};
    const defaults:Record<number,[string,string]>={400:['INVALID_JSON','Geçerli bir JSON plan isteği gönderin.'],413:['REQUEST_TOO_LARGE','Plan isteği boyut sınırını aşıyor.'],
      415:['UNSUPPORTED_MEDIA_TYPE','Content-Type application/json olmalı.'],429:['RATE_LIMIT_EXCEEDED','İstek sınırı aşıldı.'],
      499:['CLIENT_REQUEST_CANCELLED','İstek iptal edildi.'],503:['PLANNING_UNAVAILABLE','Planlama şu anda kullanılamıyor.']};
    const messages:Record<string,string>={VALIDATION_ERROR:'Plan isteğinin alanlarını kontrol edin.',PLANNING_CAPACITY_EXCEEDED:'Planlama kapasitesi dolu; kısa süre sonra tekrar deneyin.',
      PLANNING_ADMISSION_UNAVAILABLE:'Planlama kabul katmanına ulaşılamıyor.',PLANNING_REQUEST_DEADLINE:'Planlama süre sınırına ulaşıldı.',
      IP_BLOCKED_UNTIL_DAY_END:'Günlük aşım sınırı nedeniyle erişim geçici olarak engellendi.',RATE_LIMIT_STATE_UNAVAILABLE:'İstek sınırı denetlenemiyor.',
      PLANNING_RESPONSE_INVALID:'Plan sonucu doğrulanamadı.',PLANNING_RESPONSE_LIMIT:'Plan yanıtı güvenli aktarım sınırına ulaştı.',
      PLANNING_RESPONSE_ENCODING_REQUIRED:'Bu ayrıntılı plan için istemcinin gzip yanıtlarını desteklemesi gerekiyor.'};
    const [fallback,message]=defaults[status]??['INTERNAL_ERROR','İstek işlenemedi.'];
    const code=data.code&&Object.hasOwn(messages,data.code)?data.code:fallback;
    const id=requestId(r,response);
    if(status>=500&&!['PLANNING_CAPACITY_EXCEEDED','PLANNING_REQUEST_DEADLINE','PLANNING_RESPONSE_LIMIT'].includes(code)&&Date.now()-this.lastErrorAt>10000){
      this.lastErrorAt=Date.now();this.logger.error('Planning HTTP failure: '+code+' requestId='+id);}
    const retry=typeof data.retryAfterSeconds==='number'&&Number.isFinite(data.retryAfterSeconds)&&data.retryAfterSeconds>=0?data.retryAfterSeconds:status===503?1:undefined;
    if(retry!==undefined)response.setHeader('Retry-After',retry);
    const fields=Array.isArray(data.fields)?data.fields.slice(0,20).filter(f=>f&&typeof f.path==='string'&&typeof f.code==='string').map(f=>({path:f.path.slice(0,200),code:f.code.slice(0,50)})):undefined;
    response.status(status).json(planningError(id,code,messages[code]??message,retry,fields));
  }
}
