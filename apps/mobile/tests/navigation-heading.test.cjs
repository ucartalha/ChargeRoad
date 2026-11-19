// City navigation (2026-11-19): heading-aware matching, wrong-way detection, city off-route threshold, faster replan.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {planningApiRequestSchema}=require('@chargeroad/shared');
const core=require('../src/features/navigation/navigation-core.ts');
const now=Date.now(),id='11111111-1111-4111-8111-111111111111';
// A divided road: route goes north on x=29.0000; the opposite carriageway (not on the route) is ~20 m east.
const route=(road)=>({planId:id,revision:1,algorithmVersion:'t',distanceMeters:2000,reserve:10,arrivalTarget:20,attributions:[],maneuvers:[],stops:[],
 segments:[{start:0,end:2000,geometry:[{latitude:40,longitude:29},{latitude:40.018,longitude:29}],startSoc:60,endSoc:50,seconds:120,...(road?{road}:{})}]});
// A loop: the same street is used northbound then southbound 18 m apart (like a U-turn route in town).
const loop=()=>({planId:id,revision:1,algorithmVersion:'t',distanceMeters:4000,reserve:10,arrivalTarget:20,attributions:[],maneuvers:[],stops:[],
 segments:[{start:0,end:2000,geometry:[{latitude:40,longitude:29},{latitude:40.018,longitude:29}],startSoc:60,endSoc:55,seconds:120,road:'local'},
  {start:2000,end:2018,geometry:[{latitude:40.018,longitude:29},{latitude:40.018,longitude:29.00021}],startSoc:55,endSoc:55,seconds:5,road:'local'},
  {start:2018,end:4018,geometry:[{latitude:40.018,longitude:29.00021},{latitude:40,longitude:29.00021}],startSoc:55,endSoc:50,seconds:120,road:'local'}]});
loop().distanceMeters;
const fix=(p)=>({latitude:40.009,longitude:29,timestamp:now,accuracy:8,speed:12,heading:0,...p});
const anchor={distance:0,percent:60,observedAt:now,stopId:null};

test('heading picks the carriageway the car drives on, not the nearest line',()=>{
 const r=loop();r.distanceMeters=4018;
 const south=core.locateOnRoute(r,fix({longitude:29.00012,heading:180}));assert.ok(south.distance>2018,'southbound part: '+south.distance);
 const north=core.locateOnRoute(r,fix({longitude:29.00012,heading:0}));assert.ok(north.distance<2000,'northbound part: '+north.distance);
 // Without a usable heading (slow or unknown) the old nearest-line rule applies.
 const slow=core.locateOnRoute(r,fix({longitude:29.00005,heading:180,speed:1}));assert.ok(slow.distance<2000);
});
test('driving against the route direction is wrong way even on the line',()=>{
 const p=core.navigationProgress(route('local'),fix({heading:180}),now,anchor);assert.equal(p.wrongWay,true);
 assert.equal(core.navigationProgress(route('local'),fix({heading:5}),now,anchor).wrongWay,false);
 assert.equal(core.navigationProgress(route('local'),fix({heading:180,speed:1}),now,anchor).wrongWay,false,'heading ignored below walking speed');
 for(const heading of [null,undefined,-1,NaN])assert.equal(core.navigationProgress(route('local'),fix({heading}),now,anchor).wrongWay,false);
});
test('off-route threshold: 25 m in town, 50 m on the motorway or unknown road (older saved trips)',()=>{
 const east=(m)=>29+m/(111320*Math.cos(40.009*Math.PI/180));
 assert.equal(core.navigationProgress(route('local'),fix({longitude:east(30)}),now,anchor).offRoute,true);
 assert.equal(core.navigationProgress(route('local'),fix({longitude:east(20)}),now,anchor).offRoute,false);
 assert.equal(core.navigationProgress(route('motorway'),fix({longitude:east(30)}),now,anchor).offRoute,false);
 assert.equal(core.navigationProgress(route(),fix({longitude:east(30)}),now,anchor).offRoute,false);
 assert.equal(core.navigationProgress(route('local'),fix({longitude:east(30),accuracy:25}),now,anchor).offRoute,false,'1.5 x accuracy');
});
test('replan after 2 deviating fixes and 4 s or 40 m; any good fix resets',()=>{
 const p=(extra)=>({offRoute:false,wrongWay:false,...extra});let s=null,r;
 [s,r]=core.trackDeviation(s,p({offRoute:true}),fix({}),now);assert.equal(r,false);
 [s,r]=core.trackDeviation(s,p({offRoute:true}),fix({}),now+2000);assert.equal(r,false);
 [s,r]=core.trackDeviation(s,p({wrongWay:true}),fix({}),now+4000);assert.equal(r,true);
 [s,r]=core.trackDeviation(null,p({offRoute:true}),fix({}),now);[s,r]=core.trackDeviation(s,p({offRoute:true}),fix({latitude:40.0095}),now+1000);assert.equal(r,true,'55 m moved');
 [s,r]=core.trackDeviation(s,p({}),fix({}),now+1500);assert.equal(s,null);assert.equal(r,false);
});
test('replan request carries the travel direction only when it is trustworthy',()=>{
 const request=planningApiRequestSchema.parse({schemaVersion:'1.0.0',requestId:id,origin:{latitude:40,longitude:29},destination:{latitude:40.02,longitude:29},
  vehicleVariantId:id,departureAt:new Date(now+60000).toISOString(),startingChargePercent:60,startingChargeObservedAt:new Date(now).toISOString(),
  constraints:{minimumReserveChargePercent:10,targetArrivalChargePercent:20}});
 const progress=core.navigationProgress(route('local'),fix({}),now,anchor);
 const moving=core.replanFromNavigation(request,route('local'),fix({heading:87.4}),progress,id,now,55);
 assert.deepEqual(moving.originHeading,{degrees:87.4,toleranceDegrees:45});assert.equal(planningApiRequestSchema.safeParse(moving).success,true);
 assert.equal(core.replanFromNavigation(request,route('local'),fix({heading:87.4,speed:1}),progress,id,now,55).originHeading,undefined);
 assert.equal(core.replanFromNavigation(request,route('local'),fix({heading:null}),progress,id,now,55).originHeading,undefined);
 assert.equal(core.replanFromNavigation({...request,originHeading:{degrees:10,toleranceDegrees:45}},route('local'),fix({heading:null}),progress,id,now,55).originHeading,undefined,'a stale heading is never reused');
});
