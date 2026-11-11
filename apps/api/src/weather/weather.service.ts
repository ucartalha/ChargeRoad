import {routeWeatherRequestSchema,weatherQuerySchema} from '@chargeroad/shared';
import type {WeatherQuery,WeatherForecast,RouteWeatherRequest} from '@chargeroad/shared';
import {z} from 'zod';
import {WeatherProvider} from '../providers/weather-provider';
import {meters} from '../roads/geometry';
import {WEATHER_POLICY} from './weather-policy';
import type {WeatherConfig} from './weather-policy';
import {WeatherCacheStore} from './weather-cache';
import type {WeatherCallBudget} from './weather-cache';
import type {WeatherAdapter} from './weather-ports';
import {WeatherUnavailable,unavailableForecast} from './weather-ports';
import {normalizeWeather,usableWeather} from './weather-normalize';
import {sampleRouteWeather} from './weather-sampler';

export class WeatherAdapterRegistry {
  private readonly adapters=new Map<string,WeatherAdapter>();
  constructor(adapters:WeatherAdapter[]){for(const a of adapters){if(this.adapters.has(a.id))throw new Error('Duplicate weather adapter');this.adapters.set(a.id,a);}}
  get(id:string){const adapter=this.adapters.get(id);if(!adapter)throw new WeatherUnavailable('provider_unavailable','Weather adapter is not registered');return adapter;}
}
export class WeatherService extends WeatherProvider {
  readonly departureWindowSeconds=WEATHER_POLICY.departureWindowSeconds;
  private readonly budgets=new WeakMap<AbortSignal,WeatherCallBudget>();
  constructor(private readonly config:WeatherConfig,readonly registry:WeatherAdapterRegistry,private readonly cache:WeatherCacheStore){super();}
  cleanup(){return this.cache.cleanup();}
  async forecast(raw:WeatherQuery[],callerSignal:AbortSignal){
    const queries=z.array(weatherQuerySchema).max(WEATHER_POLICY.maxQueries).parse(raw);
    if(new Set(queries.map(q=>q.id)).size!==queries.length)throw new Error('Duplicate weather query');
    const adapter=this.registry.get(this.config.providerId),signal=AbortSignal.any([callerSignal,AbortSignal.timeout(WEATHER_POLICY.deadlineMs)]);
    const budget=this.budgets.get(callerSignal)??{used:0,limit:WEATHER_POLICY.maxExternalCalls};this.budgets.set(callerSignal,budget);
    const now=Date.now();
    const result=new Map<string,WeatherForecast>(),groups=new Map<string,WeatherQuery[]>();
    for(const query of queries){
      if(Date.parse(query.validAt)<now){result.set(query.id,unavailableForecast(query,'outside_horizon',adapter.id));continue;}
      if(!this.config.enabled){result.set(query.id,unavailableForecast(query,'provider_unavailable',adapter.id));continue;}
      const sample=query.sampleLocation??query.location;
      if(meters(query.location,sample)>WEATHER_POLICY.sampleDistanceMeters){result.set(query.id,unavailableForecast(query,'outside_horizon',adapter.id));continue;}
      const url=adapter.url(sample),group=groups.get(url)??[];group.push(query);groups.set(url,group);
    }
    let next=0;const entries=[...groups.entries()];
    await Promise.all(Array.from({length:WEATHER_POLICY.maxConcurrency},async()=>{
      while(next<entries.length){const index=next++,[url,group]=entries[index];
        if(index>=WEATHER_POLICY.maxSamples){for(const q of group)result.set(q.id,unavailableForecast(q,'budget_exhausted',adapter.id));continue;}
        try{
          signal.throwIfAborted();
          const document=await this.cache.get(adapter.id,adapter.version,url,signal,budget,d=>{
            if(meters(adapter.parse(d).location,group[0].sampleLocation??group[0].location)>30)throw new Error('Weather provider returned wrong location');
          });
          const series=adapter.parse(document);
          if(meters(series.location,group[0].sampleLocation??group[0].location)>30)throw new Error('Weather provider returned wrong location');
          // A model may legitimately update while the HTTP request is in flight.
          for(const query of group)result.set(query.id,normalizeWeather(series,query,adapter.id,Date.now()));
        }catch(error){
          if(callerSignal.aborted)throw callerSignal.reason;
          const status=error instanceof WeatherUnavailable?error.kind:'provider_unavailable';
          for(const query of group)result.set(query.id,unavailableForecast(query,status,adapter.id));
        }
      }
    }));
    const data=queries.map(q=>result.get(q.id)!);
    return {data,source:{sourceId:adapter.id,recordId:null,version:adapter.version,url:data[0]?.source.url??null,
      retrievedAt:new Date().toISOString(),publishedAt:null,license:data[0]?.source.license??null}};
  }
  async forRoute(raw:RouteWeatherRequest,signal:AbortSignal){
    const input=routeWeatherRequestSchema.parse(raw),now=Date.now(),delta=Date.parse(input.departureAt)-now;
    if(delta<0||delta>WEATHER_POLICY.departureWindowSeconds*1000)return {status:'preliminary_route' as const,route:input.route,
      reasons:[delta<0?'departure_is_in_the_past':'departure_outside_72_hour_window'],forecasts:[],sampling:null};
    try{
      const samples=sampleRouteWeather(input),response=await this.forecast(samples.queries,signal);
      const missing=response.data.filter(f=>!usableWeather(f,Date.now()));
      return {status:missing.length||samples.unknownTimingSegmentIds.length?'insufficient_data' as const:'weather_ready' as const,route:input.route,
        reasons:[...new Set([...missing.map(f=>'weather_'+f.status),...(samples.unknownTimingSegmentIds.length?['unknown_stop_duration']:[])])],
        forecasts:response.data,sampling:{locations:samples.samples,unknownTimingSegmentIds:samples.unknownTimingSegmentIds,policyVersion:WEATHER_POLICY.version},
        source:response.source};
    }catch(error){if(signal.aborted)throw signal.reason;if(!(error instanceof WeatherUnavailable))throw error;
      return {status:'insufficient_data' as const,route:input.route,reasons:['weather_'+error.kind],forecasts:[],sampling:null};}
  }
  async forDeparture(departureAt:string,queries:WeatherQuery[],signal:AbortSignal){
    const delta=Date.parse(departureAt)-Date.now();
    if(delta<0||delta>WEATHER_POLICY.departureWindowSeconds*1000)return {status:'preliminary_route' as const,forecasts:[],reasons:['departure_outside_planning_window']};
    const response=await this.forecast(queries,signal),missing=response.data.filter(f=>!usableWeather(f));
    return {status:missing.length?'insufficient_data' as const:'weather_ready' as const,forecasts:response.data,
      reasons:[...new Set(missing.map(f=>'weather_'+f.status))],source:response.source};
  }
}
