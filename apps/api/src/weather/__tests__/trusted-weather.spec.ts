import {weatherForecastSchema,weatherQuerySchema} from '@chargeroad/shared';
import {MetNorwayAdapter} from '../met-norway.adapter';
import {WeatherAdapterRegistry,WeatherService,trustedWeatherForecasts,trustedWeatherQueries} from '../weather.service';
import {config,document,query,instant} from './fixtures';
import {PlanningSession} from '../../planning/planning-session';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {ChargingCurveEngine} from '../../charging/charging-engine';
import {optimizerWorld} from '../../planning/__tests__/optimizer.fixtures';
import type {PlanningContext} from '../../planning/optimizer-types';

// Weather path overhead (2026-11-19, output-equivalent): the weather service already validates every forecast it builds
// (normalizeWeather parses with weatherForecastSchema; unavailableForecast is a fixed valid shape), and the planning
// session builds its own queries. Re-validating them cost ~0.5 s per İstanbul→Kelkit plan. Trusted arrays skip the second
// parse; anything else (other providers, test fakes) is still parsed exactly as before.
const now=Date.parse(instant);
const service=()=>new WeatherService(config,new WeatherAdapterRegistry([new MetNorwayAdapter(config)]),{get:jest.fn(async()=>document())} as any,{seriesCacheEntries:0});

describe('Trusted weather arrays',()=>{
  it('marks service output as trusted, and every forecast equals its own schema parse (available, unavailable, past)',async()=>{
    const clock=jest.spyOn(Date,'now').mockReturnValue(now);
    try{
      const queries=[query('a'),query('b','2026-11-11T19:00:00Z'),query('late','2026-11-20T00:00:00Z'),query('past','2026-11-11T12:00:00Z'),
        {...query('far'),sampleLocation:{latitude:41,longitude:32.8}}];
      const r=await service().forecast(queries,new AbortController().signal);
      expect(trustedWeatherForecasts.has(r.data)).toBe(true);
      expect(new Set(r.data.map(f=>f.status))).toEqual(new Set(['available','outside_horizon']));
      for(const f of r.data)expect(weatherForecastSchema.parse(f)).toStrictEqual(f);
    }finally{clock.mockRestore();}
  });
  it('a trusted query array skips the input parse but keeps the size and duplicate-id guards',async()=>{
    const clock=jest.spyOn(Date,'now').mockReturnValue(now);
    try{
      const trusted=[query('a'),query('b')];trustedWeatherQueries.add(trusted);
      const plain=await service().forecast([query('a'),query('b')],new AbortController().signal),fast=await service().forecast(trusted,new AbortController().signal);
      expect(fast.data.map(f=>({...f,fetchedAt:'',source:{...f.source,retrievedAt:''}}))).toEqual(plain.data.map(f=>({...f,fetchedAt:'',source:{...f.source,retrievedAt:''}})));
      const dup=[query('a'),query('a')];trustedWeatherQueries.add(dup);
      await expect(service().forecast(dup,new AbortController().signal)).rejects.toThrow('Duplicate weather query');
      const huge=Array.from({length:10001},(_,i)=>query('q'+i));trustedWeatherQueries.add(huge);
      await expect(service().forecast(huge,new AbortController().signal)).rejects.toThrow();
      // Untrusted invalid input is still rejected by the schema.
      await expect(service().forecast([{...query('x'),validAt:'nope'}] as never,new AbortController().signal)).rejects.toThrow();
    }finally{clock.mockRestore();}
  });
  it('every query the planning session builds equals its own schema parse',()=>{
    for(const q of [query('a'),{...query('b'),sampleLocation:{latitude:39.91,longitude:32.81}}])expect(weatherQuerySchema.parse(q)).toStrictEqual(q);
  });
});

describe('Planning session uses trusted forecasts as they are',()=>{
  function session(trusted:boolean,bad=false){
    const w=optimizerWorld();
    const context:PlanningContext={request:w.request,vehicle:w.vehicle,evaluatedAt:w.now,options:w.options,candidates:w.candidates,
      nodes:Object.entries(w.locations).map(([id,location])=>({id,location,stationId:['origin','destination'].includes(id)?null:id})),baseRoutes:[w.route('origin','destination')]};
    const inner=w.weather.forecast;
    const climate={forecast:jest.fn(async(...a:Parameters<typeof inner>)=>{const r=await inner(...a);const data=bad?r.data.map(f=>({...f,temperatureCelsius:'hot'})):r.data;
      if(trusted)trustedWeatherForecasts.add(data);return {...r,data};})};
    const s=new PlanningSession(context,w.roads as never,climate as never,new EnergyConsumptionEngine(),new ChargingCurveEngine(),w.preparation.road,performance.now()+60000,context.baseRoutes);
    return {s:s as unknown as {weather:(q:unknown[],signal:AbortSignal)=>Promise<unknown[]>},climate,w};
  }
  const q=()=>[{id:'q1',segmentId:'s1',location:{latitude:39.9,longitude:32.8},validAt:new Date(Date.now()+3600000).toISOString()}];
  it('returns the very objects of a trusted array and marks its own queries as trusted',async()=>{
    const {s,climate}=session(true),out=await s.weather(q(),new AbortController().signal);
    const sent=climate.forecast.mock.calls[0][0] as unknown as object,returned=(await climate.forecast.mock.results[0].value).data;
    expect(trustedWeatherQueries.has(sent)).toBe(true);expect(out[0]).toBe(returned[0]);
  });
  it('still parses (and rejects) untrusted provider data',async()=>{
    await expect(session(false,true).s.weather(q(),new AbortController().signal)).rejects.toThrow('WEATHER_PROVIDER_INVALID_DATA');
    const {s,climate}=session(false),out=await s.weather(q(),new AbortController().signal);
    expect(out[0]).not.toBe((await climate.forecast.mock.results[0].value).data[0]);
  });
});
