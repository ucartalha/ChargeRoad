import type {RoadRoute} from '@chargeroad/shared';
export type ElevationSample={distanceMeters:number;elevationMeters:number|null};
/** Diagnostics only. Never substitutes the physical energy profile or clamps a grade. */
export function analyseElevation(raw:readonly ElevationSample[],windows:readonly number[]=[30,150,300]){
 if(raw.length>50000||windows.length>10||windows.some(n=>!Number.isFinite(n)||n<=0))throw new Error('Elevation QA budget/window invalid');
 const samples:ElevationSample[]=[];let duplicateBoundaries=0,conflictingBoundaries=0;
 for(const p of raw){if(!Number.isFinite(p.distanceMeters)||p.distanceMeters<0||p.elevationMeters!==null&&!Number.isFinite(p.elevationMeters))throw new Error('Invalid elevation sample');
  const last=samples.at(-1);if(last&&p.distanceMeters<last.distanceMeters-1e-6)throw new Error('Elevation distances must be ordered');
  if(last&&Math.abs(p.distanceMeters-last.distanceMeters)<=1e-6){duplicateBoundaries++;if(last.elevationMeters!==p.elevationMeters){conflictingBoundaries++;last.elevationMeters=null;}continue;}
  samples.push({...p});
 }
 const length=samples.at(-1)?.distanceMeters??0,missingPrefix=[0];for(const p of samples)missingPrefix.push(missingPrefix.at(-1)!+(p.elevationMeters===null?1:0));
 const at=(d:number)=>{let low=0,high=samples.length-1;if(!samples.length||d<samples[0].distanceMeters||d>length)return null;
  while(high-low>1){const mid=(low+high)>>>1;if(samples[mid].distanceMeters<=d)low=mid;else high=mid;}
  const a=samples[low],b=samples[high];if(Math.abs(d-a.distanceMeters)<1e-6)return {value:a.elevationMeters,left:low,right:low};
  if(Math.abs(d-b.distanceMeters)<1e-6)return {value:b.elevationMeters,left:high,right:high};
  return {value:a.elevationMeters===null||b.elevationMeters===null?null:a.elevationMeters+(b.elevationMeters-a.elevationMeters)*(d-a.distanceMeters)/(b.distanceMeters-a.distanceMeters),left:low,right:high};};
 const rawGrades:{distanceMeters:number;spanMeters:number;gradePercent:number}[]=[];let coveredMeters=0,gain=0,loss=0;
 for(let i=1;i<samples.length;i++){const a=samples[i-1],b=samples[i];if(a.elevationMeters===null||b.elevationMeters===null)continue;
  const span=b.distanceMeters-a.distanceMeters,delta=b.elevationMeters-a.elevationMeters;coveredMeters+=span;gain+=Math.max(0,delta);loss+=Math.max(0,-delta);
  rawGrades.push({distanceMeters:a.distanceMeters,spanMeters:span,gradePercent:delta/span*100});}
 const rolling=windows.map(windowMeters=>{let completeWindows=0,missingWindows=0,maxAbsoluteGradePercent:number|null=null,minGradePercent:number|null=null,maxGradePercent:number|null=null;
  for(const p of samples){if(p.distanceMeters+windowMeters>length+1e-7)break;
   const a=at(p.distanceMeters),b=at(p.distanceMeters+windowMeters);
   if(!a||!b||a.value===null||b.value===null||missingPrefix[b.right+1]-missingPrefix[a.left]>0){missingWindows++;continue;}
   const grade=(b.value-a.value)/windowMeters*100;completeWindows++;maxAbsoluteGradePercent=Math.max(maxAbsoluteGradePercent??0,Math.abs(grade));
   minGradePercent=Math.min(minGradePercent??grade,grade);maxGradePercent=Math.max(maxGradePercent??grade,grade);
  }return {windowMeters,completeWindows,missingWindows,maxAbsoluteGradePercent,minGradePercent,maxGradePercent};});
 const fullCoverage=samples.length>=2&&samples[0].distanceMeters===0&&samples.every(p=>p.elevationMeters!==null);
 const net=fullCoverage?samples.at(-1)!.elevationMeters!-samples[0].elevationMeters!:null;
 const heights=samples.filter(p=>p.elevationMeters!==null).map(p=>p.elevationMeters!);
 return {algorithm:'elevation-qa/1.0.0',sourceQuality:coveredMeters>0?'modelled':'unknown',sampleCount:samples.length,duplicateBoundaries,conflictingBoundaries,
  minElevationMeters:heights.length?heights.reduce((a,b)=>Math.min(a,b)):null,maxElevationMeters:heights.length?heights.reduce((a,b)=>Math.max(a,b)):null,
  lengthMeters:length,coveredMeters,missingSamples:samples.filter(s=>s.elevationMeters===null).length,fullCoverage,
  gainMeters:gain,lossMeters:loss,netHeightMeters:net,balanceErrorMeters:net===null?null:gain-loss-net,
  // Threshold is a diagnostic flag, not proof of an error or a correction to the input.
  suspectIntervals:rawGrades.filter(s=>Math.abs(s.gradePercent)>20),suspectThresholdPercent:20,rolling,
  windowPolicy:'start_at_each_unique_sample_full_windows_only_no_interpolation_across_missing',partialWindows:false};
}
export function routeElevationSamples(route:RoadRoute):ElevationSample[]{return route.segments.flatMap<ElevationSample>(s=>s.elevationProfile?
 s.elevationProfile.map(p=>({distanceMeters:s.startDistanceMeters+p.distanceFromStartMeters,elevationMeters:p.elevationMeters})):
 [{distanceMeters:s.startDistanceMeters,elevationMeters:null},{distanceMeters:s.endDistanceMeters,elevationMeters:null}]);}
