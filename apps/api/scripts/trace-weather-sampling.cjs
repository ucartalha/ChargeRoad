const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {optimizerWorld}=require('../src/planning/__tests__/optimizer.fixtures.ts'),{sampleRouteWeather}=require('../src/weather/weather-sampler.ts'),{buildPlanningWeather}=require('../src/weather/planning-weather-policy.ts');
const {MetNorwayAdapter}=require('../src/weather/met-norway.adapter.ts'),{config}=require('../src/weather/__tests__/fixtures.ts');
const hash=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex'),root=path.resolve(__dirname,'../../..'),rows=[];
const fixed='2026-11-16T09:00:00Z',adapter=new MetNorwayAdapter(config);
for(const [profile,count]of [['short',60],['medium',600],['long',2400]]){
 const w=optimizerWorld(false),template=w.route('origin','destination'),span=500;
 const route={...template,id:'synthetic-sampling',distanceMeters:count*span,drivingDurationSeconds:count*18,
  segments:Array.from({length:count},(_,i)=>({...structuredClone(template.segments[0]),id:'segment-'+i,startDistanceMeters:i*span,endDistanceMeters:(i+1)*span,distanceMeters:span,drivingDurationSeconds:18,
   geometry:[{latitude:39.9+i*.0045,longitude:32.8},{latitude:39.9+(i+1)*.0045,longitude:32.8}]}))};
 const planning=buildPlanningWeather(route,{rangeKm:400,rangeBasis:'catalogue',rangeReferenceIds:['synthetic-range-only'],rangeSource:w.vehicle.capacity.source});
 for(const mode of ['base','eta-shift','unknown-stop']){
  const departureAt=new Date(Date.parse(fixed)+(mode==='eta-shift'?900000:0)).toISOString(),input={route,departureAt,stops:mode==='unknown-stop'?[{segmentId:route.segments[Math.floor(count/2)].id,delaySeconds:null}]:[]};
  const sampled=sampleRouteWeather(input,planning),q=sampled.queries;
  rows.push({profile,mode,segmentCount:count,samplingAnchors:planning.anchors.length,queryItems:q.length,unknownTimingSegments:sampled.unknownTimingSegmentIds.length,
   uniqueRequestedLocations:new Set(q.map(q=>JSON.stringify(q.location))).size,uniqueSampleLocations:new Set(q.map(q=>JSON.stringify(q.sampleLocation))).size,
   distinctLocationTimePairs:new Set(q.map(q=>JSON.stringify([q.sampleLocation,q.validAt]))).size,distinctProviderKeys:new Set(q.map(q=>adapter.url(q.sampleLocation??q.location))).size,
   queryHash:hash(q),sourceContract:'existing real sampler / range policy / adapter URL mapping; no HTTP, no DB, no route coordinate output'});
 }
}
fs.writeFileSync(path.join(root,'docs/validation/cr-lat-002-2026-11-16/sampling-tree.json'),JSON.stringify({generatedAt:new Date().toISOString(),rows,
 sourceHashes:Object.fromEntries(['apps/api/src/weather/weather-sampler.ts','apps/api/src/weather/planning-weather-policy.ts','apps/api/src/weather/met-norway.adapter.ts'].map(p=>[p,hash(fs.readFileSync(path.join(root,p),'utf8'))])),
 actualHistoricalUniqueKeys:'NOT_MEASURED: historical aggregate lacks raw per-key trace; no user payload read',realProviderCalls:0},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'PASS',rows:rows.length,realProviderCalls:0}));
