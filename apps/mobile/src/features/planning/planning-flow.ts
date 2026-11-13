import {planningApiRequestSchema} from '@chargeroad/shared';
import type {LocationResult,PlanningApiRequest,PlanningApiResponse,RoadPreviewResponse} from '@chargeroad/shared';
export type PlanningForm={origin:LocationResult|null;destination:LocationResult|null;vehicleId:string|null;startingCharge:string;reserve:string;arrival:string;
  departure:'now'|'scheduled';scheduled:string;objective:PlanningApiRequest['objective'];
  allowEstimates:boolean;allowCatalogueStations?:boolean;avoidTolls:boolean;avoidFerries:boolean};
export const initialPlanningForm:PlanningForm={origin:null,destination:null,vehicleId:null,startingCharge:'',reserve:'',arrival:'',departure:'now',scheduled:'',
  objective:'minimum_total_duration',allowEstimates:false,allowCatalogueStations:false,avoidTolls:false,avoidFerries:true};
export function buildPlanningRequest(form:PlanningForm,requestId:string,now=new Date()):PlanningApiRequest{
  if(!form.origin||!form.destination||!form.vehicleId)throw new Error('Başlangıç ve varış sonuçlarını seçip aracını belirle.');
  const percentage=(value:string)=>{if(!/^\d{1,3}(?:[.,]\d{1,2})?$/.test(value.trim()))throw new Error('Şarj yüzdelerini 0–100 arasında gir.');return Number(value.replace(',','.'));};
  let departureAt:string;
  if(form.departure==='now')departureAt=new Date(now.getTime()+60000).toISOString();
  else {const match=/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(form.scheduled);
    if(!match)throw new Error('Hareket zamanını YYYY-AA-GG SS:DD biçiminde gir.');
    const [year,month,day,hour,minute]=match.slice(1).map(Number),date=new Date(year,month-1,day,hour,minute);
    if(date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day||date.getHours()!==hour||date.getMinutes()!==minute||date.getTime()<=now.getTime())
      throw new Error('Geçerli ve gelecekte bir hareket zamanı seç.');departureAt=date.toISOString();}
  const a=form.origin.coordinate,b=form.destination.coordinate;
  if(Math.abs(a.latitude-b.latitude)<1e-6&&Math.abs(a.longitude-b.longitude)<1e-6)throw new Error('Başlangıç ve varış farklı konumlar olmalı.');
  const parsed=planningApiRequestSchema.safeParse({schemaVersion:'1.0.0',requestId,origin:a,destination:b,vehicleVariantId:form.vehicleId,
    departureAt,startingChargePercent:percentage(form.startingCharge),startingChargeObservedAt:now.toISOString(),
    departureMode:form.departure,
    constraints:{minimumReserveChargePercent:percentage(form.reserve),targetArrivalChargePercent:percentage(form.arrival)},objective:form.objective,
    vehicleDataQuality:form.allowEstimates?'allow_engineering_estimates':'verified_only',
    stationDataQuality:form.allowCatalogueStations?'catalogue_power_scenario':'verified_hardware',roadPreferences:{avoidTolls:form.avoidTolls,avoidFerries:form.avoidFerries}});
  if(!parsed.success)throw new Error('Yüzdeleri 0–100 arasında gir. Hedef varış şarjı yol rezervinden düşük olamaz.');return parsed.data;
}
export type PlanningPorts={plan:(r:PlanningApiRequest,s:AbortSignal)=>Promise<PlanningApiResponse>;
  preview:(r:{origin:PlanningApiRequest['origin'];destination:PlanningApiRequest['destination'];departureAt:string;avoidTolls:boolean;avoidFerries:boolean},s:AbortSignal)=>Promise<RoadPreviewResponse>};
export type PlanningViewResult={result:PlanningApiResponse;preview:RoadPreviewResponse|null;previewError:string|null;previewRetryAfterSeconds?:number};
export function roadEndpointAdjustment(form:PlanningForm,view:PlanningViewResult|null):Pick<PlanningForm,'origin'|'destination'>|null{
  const outcome=view?.result,road=view?.preview?.route;
  if(outcome?.status!=='insufficient_data'||!outcome.reasons.some(r=>r.code==='ROAD_ENDPOINT_CONFIRMATION_REQUIRED')||!road?.geometry||road.geometry.length<2||!form.origin||!form.destination||
    road.originSnapMeters>1000||road.destinationSnapMeters>1000||Math.max(road.originSnapMeters,road.destinationSnapMeters)<=100)return null;
  const origin=road.originSnapMeters>100?{id:'road-point:'+form.origin.id.slice(0,170),label:form.origin.label.slice(0,480)+' · yol noktası',coordinate:road.geometry[0]}:form.origin;
  const destination=road.destinationSnapMeters>100?{id:'road-point:'+form.destination.id.slice(0,170),label:form.destination.label.slice(0,480)+' · yol noktası',coordinate:road.geometry.at(-1)!}:form.destination;
  return {origin,destination};
}
export async function runPlanning(request:PlanningApiRequest,signal:AbortSignal,ports:PlanningPorts):Promise<PlanningViewResult>{
  const result=await ports.plan(request,signal);if(signal.aborted)throw new Error('Cancelled');
  if(result.requestId!==request.requestId)throw new Error('Yanıt bu isteğe ait değil.');
  if(result.status!=='insufficient_data')return {result,preview:null,previewError:null};
  try{const preview=await ports.preview({origin:request.origin,destination:request.destination,departureAt:request.departureAt,...request.roadPreferences},signal);
    if(signal.aborted)throw new Error('Cancelled');return {result,preview,previewError:null};}
  catch(error){if(signal.aborted)throw error;
    const details=error as {status?:number;retryAfterSeconds?:number;message?:string};
    return {result,preview:null,previewRetryAfterSeconds:details?.retryAfterSeconds,
      previewError:details?.status===422?details.message??'Daha kesin bir başlangıç ve varış adresi seç.':'Yol önizlemesi de alınamadı. Planlama bilgilerin korunuyor; tekrar deneyebilirsin.'};}
}
// A request superseded by changed inputs must never overwrite the new screen, even if transport ignores abort.
export class LatestPlanningRequest {
  private generation=0;private controller:AbortController|null=null;
  cancel(){this.generation++;this.controller?.abort();this.controller=null;}
  async run(request:PlanningApiRequest,ports:PlanningPorts,publish:(r:PlanningViewResult)=>void){this.cancel();const generation=this.generation;
    const controller=new AbortController();this.controller=controller;
    try{const result=await runPlanning(request,controller.signal,ports);if(generation===this.generation)publish(result);}
    catch(error){if(generation===this.generation)throw error;}
    finally{if(generation===this.generation)this.controller=null;}
  }
}
