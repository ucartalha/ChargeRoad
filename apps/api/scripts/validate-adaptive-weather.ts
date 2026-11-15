/** Offline sampling proof only; no provider HTTP or DB. Never overwrites existing evidence. */
import {existsSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {buildPlanningWeather,samplingRange,PLANNING_WEATHER_POLICY} from '../src/weather/planning-weather-policy';
import {sampleRouteWeather} from '../src/weather/weather-sampler';
import {windowRoute} from '../src/weather/__tests__/window-route.fixture';
import {optimizerWorld} from '../src/planning/__tests__/optimizer.fixtures';
import {source} from '../src/planning/__tests__/fixtures';
const output=resolve(__dirname,'../../../docs/validation/adaptive-weather-sampling-2026-11-16.json');
if(existsSync(output))throw Error('Evidence exists');
globalThis.fetch=async()=>{throw Error('External provider forbidden');};
const rows=[199,200,201,700,1000,1001,1200,2000].map(km=>{
 const input=windowRoute(km),vehicle=optimizerWorld(false).vehicle,
   plan=buildPlanningWeather(input.route,samplingRange(vehicle,{rangeKm:400,cycle:'wltp',source:source('synthetic-catalogue')})),result=sampleRouteWeather(input,plan),
   future=plan.anchors.filter(a=>a.distanceMeters>=plan.detailedHorizonMeters);
 if(km>1000&&future.length!==26)throw Error('Partition mismatch');
 return {routeKm:km,catalogueRangeKm:400,detailedHorizonKm:plan.detailedHorizonMeters/1000,futureStepKm:plan.futureStepMeters/1000,
  sampleLocations:result.samples.length,segmentQueryItems:result.queries.length,futurePartitionCount:km>1000?future.length-1:null,
  samplingAvailable:true,providerHttpCalls:0};
});
const paths=['src/weather/planning-weather-policy.ts','src/weather/weather-sampler.ts','src/weather/weather.service.ts','src/weather/weather-normalize.ts',
 'src/planning/planning-session.ts','src/planning/charge-stop-optimizer.ts','src/energy/energy-engine.ts','src/energy/energy-policy.ts'];
const sourceHashes=Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(resolve(__dirname,'../'+p))).digest('hex')]));
writeFileSync(output,JSON.stringify({date:'2026-11-16',scope:'Synthetic geometry sampling proof; sample locations are NOT actual HTTP requests or vehicle-range guarantees',
 policy:PLANNING_WEATHER_POLICY,rows,sourceHashes,physicsEquationsChanged:false,globalOptimality:'NOT_PROVEN',realIstanbulKelkitAcceptance:'PENDING_DEVICE_TEST'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({cases:rows.length,scope:'offline',rows}));
