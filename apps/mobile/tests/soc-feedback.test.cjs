// SOC correction feedback (2026-11-19, user request): the driver corrects our estimated SOC from the navigation chip; each
// correction becomes a record per vehicle variant and energy model so the energy engine can be calibrated offline.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fb=require('../src/features/navigation/soc-feedback.ts');
const id='11111111-1111-4111-8111-111111111111',variant='a'.repeat(64);
const route={planId:id,revision:1,algorithmVersion:'chargeroad-optimizer/1.9.0',energyModel:'energy/2.0.0',distanceMeters:30000,reserve:10,arrivalTarget:20,attributions:[],maneuvers:[],stops:[],
 segments:[{start:0,end:10000,geometry:[],startSoc:80,endSoc:76,seconds:600,road:'primary',climb:40},
  {start:10000,end:30000,geometry:[],startSoc:76,endSoc:66,seconds:720,road:'motorway',climb:100}]};

test('stepSoc moves by whole percents inside 0–100',()=>{
 assert.equal(fb.stepSoc(57.6,1),59);assert.equal(fb.stepSoc(57.4,-1),56);assert.equal(fb.stepSoc(99,5),100);assert.equal(fb.stepSoc(2,-5),0);
});

test('the baseline accumulates driven, motorway and climb metres across the segments it covers',()=>{
 let b=fb.startBaseline(80,1000,'start');assert.deepEqual(b,{percent:80,at:1000,source:'start',meters:0,motorwayMeters:0,climbMeters:0});
 b=fb.accumulateBaseline(b,route,0,5000);b=fb.accumulateBaseline(b,route,5000,20000);
 assert.equal(b.meters,20000);assert.equal(b.motorwayMeters,10000);assert.equal(b.climbMeters,20+20+50);
 // Going backwards or without a baseline changes nothing.
 assert.equal(fb.accumulateBaseline(b,route,20000,19000),b);assert.equal(fb.accumulateBaseline(undefined,route,0,100),undefined);
});

test('a correction compares the user value with our estimate since the last user-entered SOC',()=>{
 const b={...fb.startBaseline(80,0,'start'),meters:20000,motorwayMeters:10000,climbMeters:90};
 const r=fb.socCorrection({vehicleVariantId:variant,vehicleLabel:'Tesla Model Y',route,baseline:b,predicted:71,observed:69,at:20*60000,reason:'correction'});
 assert.deepEqual(r,{schema:'soc-correction/1.0.0',at:new Date(20*60000).toISOString(),vehicleVariantId:variant,vehicleLabel:'Tesla Model Y',
  energyModel:'energy/2.0.0',optimizer:'chargeroad-optimizer/1.9.0',reason:'correction',baselineSource:'start',baseline:80,predicted:71,observed:69,
  error:-2,modelDrop:9,observedDrop:11,ratio:1.222,km:20,motorwayShare:.5,climbM:90,minutes:20,avgKph:60,quality:'ok'});
});

test('quality flags keep unusable corrections out of the calibration ratio',()=>{
 const b=(meters)=>({...fb.startBaseline(80,0,'start'),meters,motorwayMeters:0,climbMeters:0});
 const make=(over)=>fb.socCorrection({vehicleVariantId:variant,route,baseline:b(20000),predicted:71,observed:69,at:600000,reason:'correction',...over});
 assert.equal(make({observed:84}).quality,'soc_rose');assert.equal(make({observed:84}).ratio,null);
 assert.equal(make({predicted:79,observed:79}).quality,'small_drop');
 assert.equal(make({baseline:b(500)}).quality,'too_short');
 assert.equal(make({reason:'after_charging',observed:90}).quality,'after_charging');
 assert.equal(make({baseline:undefined}).quality,'no_baseline');assert.equal(make({baseline:undefined}).km,null);
 // Older saved routes have no energy model id.
 assert.equal(make({route:{...route,energyModel:undefined}}).energyModel,null);
});

test('the device journal keeps the newest records and drops corrupt storage',()=>{
 const rec=(n)=>({schema:'soc-correction/1.0.0',n});
 let raw=null;for(let i=0;i<5;i++)raw=fb.appendJournal(raw,rec(i),3);
 assert.deepEqual(fb.readJournal(raw).map(r=>r.n),[2,3,4]);
 assert.deepEqual(fb.readJournal('{bad'),[]);assert.deepEqual(fb.readJournal('{"a":1}'),[]);
 assert.equal(fb.SOC_FEEDBACK_POLICY.journalLimit,500);
});

test('the summary groups by vehicle variant and energy model and uses usable records only',()=>{
 const r=(v,m,error,ratio,quality='ok')=>({vehicleVariantId:v,vehicleLabel:'Car '+v[0],energyModel:m,error,ratio,quality,km:10});
 const s=fb.summarizeJournal([r(variant,'e1',-2,1.2),r(variant,'e1',-4,1.4),r(variant,'e1',-1,1.1),r(variant,'e1',5,null,'soc_rose'),r('b'.repeat(64),'e1',1,.9)]);
 assert.deepEqual(s,[{vehicleVariantId:variant,vehicleLabel:'Car a',energyModel:'e1',records:4,usable:3,meanError:-2.3,medianRatio:1.2,km:30},
  {vehicleVariantId:'b'.repeat(64),vehicleLabel:'Car b',energyModel:'e1',records:1,usable:1,meanError:1,medianRatio:.9,km:10}]);
});

test('the compact navigation route carries the plan energy model (absent when the plan has none)',()=>{
 const {compactNavigationRoute}=require('../src/features/navigation/navigation-core.ts');
 const plan=(modelVersion)=>({planId:'p',revision:1,algorithmVersion:'a',minimumReserveChargePercent:10,targetArrivalChargePercent:20,chargingStops:[],
  roadRoute:{distanceMeters:1000,segments:[{startDistanceMeters:0,endDistanceMeters:1000,geometry:[{latitude:1,longitude:1},{latitude:2,longitude:2}],drivingDurationSeconds:10}],metadata:{attributions:[],maneuvers:[]}},
  energySegments:[{startChargePercent:50,endChargePercent:40,...(modelVersion?{modelVersion}:{})}]});
 assert.equal(compactNavigationRoute(plan('energy/2.0.0')).energyModel,'energy/2.0.0');
 assert.equal('energyModel' in compactNavigationRoute(plan()),false);
});

test('the report script reads soc_correction lines from Metro output',()=>{
 const {parseRecords,report}=require('../scripts/soc-feedback-report.cjs');
 const line=(o)=>' INFO  [dev] soc_correction '+JSON.stringify(o);
 const text=['Android Bundled 23ms',line({vehicleVariantId:variant,vehicleLabel:'Tesla Model Y',energyModel:'e1',quality:'ok',error:-2,modelDrop:9,observedDrop:11,ratio:1.2,km:20,motorwayShare:.5,avgKph:60}),
  line({vehicleVariantId:variant,vehicleLabel:'Tesla Model Y',energyModel:'e1',quality:'soc_rose',error:5,km:3}),' INFO  [dev] soc_correction {broken'].join('\n');
 const records=parseRecords(text);assert.equal(records.length,2);assert.ok(Math.abs(records[0].ratio-11/9)<1e-9);
 const md=report(records);assert.match(md,/\| Tesla Model Y \| e1 \| 2 \| 1 \| -2\.0 \| 1\.222 \| 20\.0 \|/);assert.match(md,/soc_rose 1/);
});
