import {HttpException} from '@nestjs/common';
import {planningApiRequestSchema} from '@chargeroad/shared';
import {PLANNING_HTTP_POLICY} from './planning-http-policy';
import {meters} from '../../roads/geometry';
export function validatePlanningRequest(raw:unknown){
 if(Buffer.byteLength(JSON.stringify(raw)??'')>PLANNING_HTTP_POLICY.maxBodyBytes)throw new HttpException({code:'REQUEST_TOO_LARGE'},413);
 const parsed=planningApiRequestSchema.safeParse(raw);
 if(!parsed.success)throw new HttpException({code:'VALIDATION_ERROR',fields:parsed.error.issues.slice(0,20).map(i=>({path:i.path.join('.').slice(0,200),code:i.code}))},400);
 const r=parsed.data,now=Date.now(),distance=meters(r.origin,r.destination),observations=[r.initialBatteryTemperatureC,r.stateOfHealthPercent,r.operatingConditions.payloadKg,r.operatingConditions.cabinTargetTemperatureC];
 if(distance<1||distance>PLANNING_HTTP_POLICY.maxStraightLineMeters||Date.parse(r.startingChargeObservedAt)>now||observations.some(o=>o.origin==='user_input'&&Date.parse(o.observedAt)>now))throw new HttpException({code:'VALIDATION_ERROR'},400);
 return r;
}
