import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
import {HttpException} from '@nestjs/common';
import type {PlanningApiResponse} from '@chargeroad/shared';
import {PLANNING_HTTP_POLICY as policy} from './planning-http-policy';
import {withPlanningMetrics,measureSync,measureAsync,setMetric} from '../../observability/planning-metrics';
const compress=promisify(gzip);
export async function encodePlanningResponse(response:PlanningApiResponse,acceptEncoding:string|undefined,signal:AbortSignal){
  return withPlanningMetrics(response?.requestId,()=>encodeResponse(response,acceptEncoding,signal),{scope:'job_result'});
}
async function encodeResponse(response:PlanningApiResponse,acceptEncoding:string|undefined,signal:AbortSignal){
  signal.throwIfAborted();const json=measureSync('json_serialize',()=>Buffer.from(JSON.stringify(response)));setMetric('response_decoded_bytes',json.length);
  if(json.length>policy.maxResponseBytes)throw new HttpException({code:'PLANNING_RESPONSE_LIMIT'},503);
  const weights=new Map((acceptEncoding??'').split(',').map(part=>{
    const [name,...params]=part.trim().toLowerCase().split(';'),q=params.find(p=>/^\s*q\s*=/.test(p));
    const weight=q===undefined?1:Number(q.split('=')[1]);return [name,Number.isFinite(weight)&&weight>=0&&weight<=1?weight:0] as const;
  }));
  const supportsGzip=(weights.get('gzip')??weights.get('*')??0)>0;
  if(supportsGzip&&json.length>=policy.compressResponseAtBytes){
    const body=await measureAsync('gzip',()=>compress(json,{level:1}));signal.throwIfAborted();
    if(body.length>policy.maxWireResponseBytes)throw new HttpException({code:'PLANNING_RESPONSE_LIMIT'},503);
    setMetric('response_wire_bytes',body.length);return {body,encoding:'gzip' as const};
  }
  if(json.length>policy.maxWireResponseBytes)throw new HttpException({code:'PLANNING_RESPONSE_ENCODING_REQUIRED'},406);
  setMetric('response_wire_bytes',json.length);return {body:json,encoding:null};
}
