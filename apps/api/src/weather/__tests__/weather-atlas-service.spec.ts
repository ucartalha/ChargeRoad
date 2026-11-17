import {WeatherService,WeatherAdapterRegistry} from '../weather.service';
import {WeatherAtlas} from '../weather-atlas';
import {WeatherCacheStore} from '../weather-cache';
import {WEATHER_POLICY} from '../weather-policy';
import {MetNorwayAdapter} from '../met-norway.adapter';
import {weatherTransport} from '../weather-http';
import {experimentDocument} from '../validation/weather-experiment-fixture';
const RealDate=Date;
const SqlFixture=require('../../../scripts/validation/weather-sql-model.cjs')(RealDate);
describe('Atlas through native service/cache/adapter/HTTP parser (MODEL SQL)',()=>{
 const epoch=RealDate.now();
 beforeAll(()=>jest.useFakeTimers({now:epoch,doNotFake:['performance','hrtime','nextTick','setImmediate','setTimeout','clearTimeout','setInterval','clearInterval']}));
 afterAll(()=>jest.useRealTimers());
 async function exercise(useAtlas:boolean,status=200,invalid=false){
  const config={enabled:true,providerId:'synthetic',endpoint:'https://example.invalid/forecast',userAgent:'ChargeRoad/fixture',termsAccepted:true};
  const adapter=new MetNorwayAdapter(config),parse=jest.spyOn(adapter,'parse'),db=new SqlFixture();
  const wire=jest.spyOn(global,'fetch').mockImplementation(async()=>{
   const body=experimentDocument(35,32.8,'short').body as any;
   body.properties.timeseries.forEach((row:any,hour:number)=>{row.data.instant.details.air_temperature=30+hour*.5;});
   return new Response(invalid?'not-json':JSON.stringify(body),{status,headers:{Expires:new Date(epoch+3600000).toUTCString(),'Last-Modified':new Date(epoch).toUTCString()}});
  });
  const cache=new WeatherCacheStore({pool:db} as never,weatherTransport(config),'synthetic-atlas-service-secret-at-least-32-characters');
  const service=new WeatherService(config,new WeatherAdapterRegistry([adapter]),cache),atlas=new WeatherAtlas(performance.now()+10000),scope={};
  try{const results:Awaited<ReturnType<WeatherService['forecast']>>[]=[];
   for(let i=0;i<3;i++)results.push(await service.forecast([{id:'q'+i,segmentId:'s'+i,location:{latitude:35,longitude:32.8},validAt:new Date(epoch+1800000+i*60000).toISOString()}],new AbortController().signal,{budgetScope:scope,...(useAtlas?{seriesScope:atlas}:{})}));
   return {results,gets:cache.counters.lookups,parses:parse.mock.calls.length,physical:wire.mock.calls.length};
  }finally{atlas.dispose();wire.mockRestore();parse.mockRestore();}
 }
 it('reprojects real ETAs with identical complete forecasts and fewer PG reads/parses',async()=>{
  const legacy=await exercise(false),atlas=await exercise(true);
  expect(atlas.results).toEqual(legacy.results);expect(legacy.gets).toBe(3);expect(atlas.gets).toBe(1);
  expect(atlas.results[0].data[0].temperatureCelsius).not.toBe(atlas.results[1].data[0].temperatureCelsius);
  expect(atlas.parses).toBeLessThan(legacy.parses);expect(atlas.physical).toBe(1);expect(legacy.physical).toBe(1);
 });
 it.each([429,503])('does not retain rejected HTTP %i promises or fabricate forecasts',async status=>{
  const atlas=await exercise(true,status);expect(atlas.results.every(r=>r.data.every(v=>v.temperatureCelsius===null))).toBe(true);
  expect(atlas.gets).toBe(3);expect(atlas.physical).toBe(1);
 });
 it('keeps parse failures on the native backoff path',async()=>{
  const result=await exercise(true,200,true);expect(result.gets).toBe(3);expect(result.physical).toBe(1);
  expect(result.results.every(r=>r.data.every(v=>v.status==='provider_unavailable'))).toBe(true);
 });
 it('revalidates expired L1/L2 via 304 without inventing a new source issue or fetched time',async()=>{
  jest.setSystemTime(epoch);
  const config={enabled:true,providerId:'synthetic',endpoint:'https://example.invalid/forecast',userAgent:'ChargeRoad/fixture',termsAccepted:true};
  const db=new SqlFixture(),adapter=new MetNorwayAdapter(config),modified=new Date(epoch).toUTCString();
  const wire=jest.spyOn(global,'fetch').mockResolvedValueOnce(new Response(JSON.stringify(experimentDocument(35,32.8,'short').body),{status:200,
   headers:{Expires:new Date(epoch+1000).toUTCString(),'Last-Modified':modified}})).mockResolvedValueOnce(new Response(null,{status:304,
   headers:{Expires:new Date(epoch+3600000).toUTCString(),'Last-Modified':modified}}));
  const cache=new WeatherCacheStore({pool:db} as never,weatherTransport(config),'synthetic-atlas-service-secret-at-least-32-characters');
  const service=new WeatherService(config,new WeatherAdapterRegistry([adapter]),cache),atlas=new WeatherAtlas(performance.now()+10000),context={budgetScope:{},seriesScope:atlas};
  // validAt lies beyond the 8 h serve window so the same query stays answerable after revalidation (W5).
  const queries=[{id:'q',segmentId:'s',location:{latitude:35,longitude:32.8},validAt:new Date(epoch+9*3600000).toISOString()}];
  const served=epoch+WEATHER_POLICY.cacheServeSeconds*1000;
  try{
   const first=await service.forecast(queries,new AbortController().signal,context);
   // Past Expires but inside the serve window: the job-local atlas keeps serving, no request.
   jest.setSystemTime(epoch+2000);for(const row of db.rows.values())row.expires=0;
   await service.forecast(queries,new AbortController().signal,context);expect(wire).toHaveBeenCalledTimes(1);
   // Past the serve window: revalidated once with If-Modified-Since.
   jest.setSystemTime(served+2000);
   const second=await service.forecast(queries,new AbortController().signal,context);
   expect(wire).toHaveBeenCalledTimes(2);expect(cache.counters.externalCalls).toBe(2);
   expect((wire.mock.calls[1][1]?.headers as Record<string,string>)['If-Modified-Since']).toBe(modified);
   expect(second.data[0].fetchedAt).toBe(first.data[0].fetchedAt);expect(second.data[0].sourceUpdatedAt).toBe(first.data[0].sourceUpdatedAt);
   expect(second.data[0].temperatureCelsius).toBe(first.data[0].temperatureCelsius);
   expect(second.data[0].metadata!.lastValidatedAt).toBe(new Date(served+2000).toISOString());
  }finally{atlas.dispose();wire.mockRestore();jest.setSystemTime(epoch);}
 });
});
