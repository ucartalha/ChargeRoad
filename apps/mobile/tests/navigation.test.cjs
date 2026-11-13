const {test}=require('node:test'),assert=require('node:assert/strict');
const {planningApiRequestSchema}=require('@chargeroad/shared');
const {validFix,locateOnRoute,navigationProgress,replanFromNavigation}=require('../src/features/navigation/navigation-core.ts');
const {decodeTrip}=require('../src/features/navigation/trip-storage.ts');
const now=Date.now(),id='11111111-1111-4111-8111-111111111111';
const request=()=>planningApiRequestSchema.parse({schemaVersion:'1.0.0',requestId:id,origin:{latitude:40,longitude:29},destination:{latitude:40.02,longitude:29},
 vehicleVariantId:id,departureAt:new Date(now+60000).toISOString(),startingChargePercent:60,startingChargeObservedAt:new Date(now).toISOString(),
 constraints:{minimumReserveChargePercent:10,targetArrivalChargePercent:20}});
const route=()=>({planId:id,revision:1,algorithmVersion:'test-v1',distanceMeters:2000,reserve:10,arrivalTarget:20,attributions:[],
 segments:[{start:0,end:1000,geometry:[{latitude:40,longitude:29},{latitude:40.01,longitude:29}],startSoc:60,endSoc:40,seconds:60},
 {start:1000,end:2000,geometry:[{latitude:40.01,longitude:29},{latitude:40.02,longitude:29}],startSoc:80,endSoc:60,seconds:60}],
 maneuvers:[{instruction:'Sağa dön',startDistanceMeters:900,endDistanceMeters:1000}],stops:[{id:'stop-1',distance:1000,arrivalSoc:40,targetSoc:80}]});
const fix=(latitude=40.005,longitude=29)=>({latitude,longitude,timestamp:now,accuracy:10,speed:20});
const anchor=()=>({distance:0,percent:60,observedAt:now,stopId:null});
test('navigation rejects old, inaccurate, missing accuracy and nonfinite GPS without changing a plan',()=>{
 assert.equal(validFix(fix(),now),true);for(const patch of [{timestamp:now-16000},{timestamp:now+3000},{accuracy:100},{accuracy:null},{accuracy:NaN},{latitude:NaN}])assert.equal(validFix({...fix(),...patch},now),false);
});
test('GPS projects onto actual polyline and interpolates model SOC, distance and maneuver',()=>{
 const p=navigationProgress(route(),fix(),now,anchor());assert.ok(Math.abs(p.distance-500)<1);assert.ok(Math.abs(p.soc-50)<.1);assert.equal(p.instruction,'Sağa dön');
 assert.equal(p.offRoute,false);assert.equal(p.arrived,false);assert.ok(Math.abs(p.remainingDrivingSeconds-90)<1);
});
test('passing a planned charging stop never credits unobserved energy',()=>{
 const p=navigationProgress(route(),fix(40.015),now,anchor());assert.ok(Math.abs(p.soc-30)<.1);assert.equal(p.needsChargeConfirmation,true);
 const corrected=navigationProgress(route(),fix(40.015),now,{distance:1000,percent:75,observedAt:now,stopId:'stop-1'});
 assert.ok(Math.abs(corrected.soc-65)<.1);assert.equal(corrected.needsChargeConfirmation,false);
});
test('regen increases SOC while charging discontinuities remain excluded',()=>{
 const r=route();r.stops=[];r.segments[0].endSoc=65;
 const p=navigationProgress(r,fix(),now,anchor());assert.ok(Math.abs(p.soc-62.5)<.1);
});
test('progress continuity prevents jumping to a nearby later loop',()=>{
 const r=route();r.segments.push({...r.segments[0],start:100000,end:101000});
 const p=locateOnRoute(r,fix(),{distance:480,timestamp:now-2000});assert.ok(p.distance<1000);
});
test('off-route and arrival signals depend on distance and accuracy, not speed alone',()=>{
 assert.equal(navigationProgress(route(),fix(40.005,29.005),now,anchor()).offRoute,true);
 assert.equal(navigationProgress(route(),fix(40.02),now,anchor()).arrived,true);
});
test('reroutes preserve destination, reserve, consent and objective and label estimated SOC with provenance',()=>{
 const r=route(),f=fix(),p=navigationProgress(r,f,now,anchor()),original=request();
 const next=replanFromNavigation(original,r,f,p,id,now);assert.deepEqual(next.destination,original.destination);assert.deepEqual(next.constraints,original.constraints);
 assert.equal(next.startingChargeSource,'estimated');assert.equal(next.startingChargeEstimate.planId,id);assert.ok(planningApiRequestSchema.safeParse(next).success);
 const observed=replanFromNavigation(original,r,f,p,id,now,45);assert.equal(observed.startingChargePercent,45);assert.equal(observed.startingChargeSource,'user_input');assert.equal(observed.startingChargeEstimate,undefined);
 assert.throws(()=>replanFromNavigation(original,r,{...f,accuracy:100},p,id,now));assert.throws(()=>replanFromNavigation(original,r,f,p,id,now,101));
});
test('an estimated SOC cannot be posted without provenance or disguised as a user observation',()=>{
 const r=request();assert.equal(planningApiRequestSchema.safeParse({...r,startingChargeSource:'estimated'}).success,false);
 assert.equal(planningApiRequestSchema.safeParse({...r,startingChargeEstimate:{planId:id,revision:1,algorithmVersion:'v1',generatedAt:new Date(now).toISOString()}}).success,false);
});
test('trip restore pauses tracking, requires fresh GPS, expires local private data and rejects corrupt routes',()=>{
 const snapshot={version:1,id,updatedAt:now,status:'active',request:request(),route:route(),anchor:anchor(),progress:{distance:500},events:[]};
 const decoded=decodeTrip(JSON.stringify(snapshot),now);assert.equal(decoded.status,'paused');assert.equal(decoded.progress,null);
 assert.equal(decodeTrip(JSON.stringify({...snapshot,updatedAt:now-86400001}),now),null);assert.equal(decodeTrip('broken',now),null);
 const broken=structuredClone(snapshot);broken.route.segments[1].start=123;assert.equal(decodeTrip(JSON.stringify(broken),now),null);
});
