import type {NavigationRoute} from './navigation-core';

/**
 * SOC correction feedback (2026-11-19, user request). The driver corrects our estimated SOC from the navigation chip; every
 * correction is compared with our estimate since the LAST USER-ENTERED SOC (the baseline), so estimated replans in between
 * do not hide the error. Records stay on this device (journal) and in development logs; nothing is uploaded and nothing is
 * learned automatically. No coordinates: distances are metres driven, not positions.
 */
export const SOC_FEEDBACK_POLICY={schema:'soc-correction/1.0.0',journalKey:'chargeroad:soc-feedback:v1',journalLimit:500,
  /** Ratio needs a measurable model drop; manual SOC is read in whole percents. */
  minModelDropForRatio:2,minKm:2,socRoseTolerance:1} as const;
export type SocBaselineSource='start'|'correction'|'after_charging';
export type SocBaseline={percent:number;at:number;source:SocBaselineSource;meters:number;motorwayMeters:number;climbMeters:number};
export type SocCorrectionQuality='ok'|'no_baseline'|'after_charging'|'soc_rose'|'too_short'|'small_drop';
export type SocCorrection={schema:typeof SOC_FEEDBACK_POLICY.schema;at:string;vehicleVariantId:string;vehicleLabel:string|null;energyModel:string|null;
  optimizer:string;reason:'correction'|'after_charging';baselineSource:SocBaselineSource|null;baseline:number|null;predicted:number;observed:number;
  error:number;modelDrop:number|null;observedDrop:number|null;ratio:number|null;km:number|null;motorwayShare:number|null;climbM:number|null;
  minutes:number|null;avgKph:number|null;quality:SocCorrectionQuality};

const round=(n:number,digits=1)=>{const f=10**digits;return Math.round(n*f)/f;};
export function stepSoc(value:number,delta:number){return Math.max(0,Math.min(100,Math.round(value)+delta));}
export function startBaseline(percent:number,at:number,source:SocBaselineSource):SocBaseline{return {percent,at,source,meters:0,motorwayMeters:0,climbMeters:0};}
/** Adds the route part between two progress distances (same route) to the baseline. */
export function accumulateBaseline(baseline:SocBaseline|undefined,route:NavigationRoute,from:number,to:number):SocBaseline|undefined{
  if(!baseline||!(to>from))return baseline;let meters=0,motorway=0,climb=0;
  for(const s of route.segments){const a=Math.max(from,s.start),b=Math.min(to,s.end);if(b<=a)continue;const part=b-a;
    meters+=part;if(s.road==='motorway')motorway+=part;if(typeof s.climb==='number')climb+=s.climb*part/(s.end-s.start);}
  return {...baseline,meters:baseline.meters+meters,motorwayMeters:baseline.motorwayMeters+motorway,climbMeters:baseline.climbMeters+climb};
}
export function socCorrection(input:{vehicleVariantId:string;vehicleLabel?:string|null;route:NavigationRoute;baseline:SocBaseline|undefined;
  predicted:number;observed:number;at:number;reason:'correction'|'after_charging'}):SocCorrection{
  const {route,baseline:b,predicted,observed,at,reason}=input,km=b?b.meters/1000:null,minutes=b?(at-b.at)/60000:null;
  const modelDrop=b?b.percent-predicted:null,observedDrop=b?b.percent-observed:null;
  const quality:SocCorrectionQuality=!b?'no_baseline':reason==='after_charging'?'after_charging':observedDrop!<-SOC_FEEDBACK_POLICY.socRoseTolerance?'soc_rose':
    km!<SOC_FEEDBACK_POLICY.minKm?'too_short':modelDrop!<SOC_FEEDBACK_POLICY.minModelDropForRatio?'small_drop':'ok';
  return {schema:SOC_FEEDBACK_POLICY.schema,at:new Date(at).toISOString(),vehicleVariantId:input.vehicleVariantId,vehicleLabel:input.vehicleLabel??null,
    energyModel:route.energyModel??null,optimizer:route.algorithmVersion,reason,baselineSource:b?.source??null,baseline:b?round(b.percent):null,
    predicted:round(predicted),observed:round(observed),error:round(observed-predicted),modelDrop:modelDrop===null?null:round(modelDrop),
    observedDrop:observedDrop===null?null:round(observedDrop),ratio:quality==='ok'?round(observedDrop!/modelDrop!,3):null,
    km:km===null?null:round(km),motorwayShare:b&&b.meters>0?round(b.motorwayMeters/b.meters,2):null,climbM:b?Math.round(b.climbMeters):null,
    minutes:minutes===null?null:round(minutes),avgKph:km!==null&&minutes!==null&&minutes>0?round(km/(minutes/60)):null,quality};
}
export function readJournal(raw:string|null):Record<string,unknown>[]{
  try{const data=raw?JSON.parse(raw):[];return Array.isArray(data)?data.filter(r=>r&&typeof r==='object'):[];}catch{return [];}
}
export function appendJournal(raw:string|null,record:unknown,limit:number=SOC_FEEDBACK_POLICY.journalLimit){return JSON.stringify([...readJournal(raw),record].slice(-limit));}
export type SocFeedbackSummary={vehicleVariantId:string;vehicleLabel:string|null;energyModel:string|null;records:number;usable:number;meanError:number|null;medianRatio:number|null;km:number};
/** Per vehicle variant and energy model; only 'ok' records count for error, ratio and kilometres. */
export function summarizeJournal(records:Partial<SocCorrection>[]):SocFeedbackSummary[]{
  const groups=new Map<string,Partial<SocCorrection>[]>();
  for(const r of records){if(typeof r.vehicleVariantId!=='string')continue;const key=r.vehicleVariantId+'\u0000'+(r.energyModel??'');groups.set(key,[...(groups.get(key)??[]),r]);}
  return [...groups.values()].map(list=>{const usable=list.filter(r=>r.quality==='ok'&&typeof r.error==='number');
    const ratios=usable.map(r=>r.ratio).filter((n):n is number=>typeof n==='number').sort((a,b)=>a-b);
    const median=ratios.length?(ratios.length%2?ratios[(ratios.length-1)/2]:(ratios[ratios.length/2-1]+ratios[ratios.length/2])/2):null;
    return {vehicleVariantId:list[0].vehicleVariantId!,vehicleLabel:list.at(-1)!.vehicleLabel??null,energyModel:list[0].energyModel??null,records:list.length,usable:usable.length,
      meanError:usable.length?round(usable.reduce((s,r)=>s+r.error!,0)/usable.length):null,medianRatio:median===null?null:round(median,3),
      km:round(usable.reduce((s,r)=>s+(r.km??0),0))};});
}
