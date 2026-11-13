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
import {sampleRouteWeather,samplePreviewWeather,sampleNavigationWeather} from './weather-sampler';
import type {NavigationWeatherOptions} from './weather-sampler';
import {weatherSampleLocation,terrainSharingIsSafe} from './weather-spatial';
import {WEATHER_SAMPLING_POLICY} from './weather-policy';

export class WeatherAdapterRegistry {
  private readonly adapters=new Map<string,WeatherAdapter>();
  constructor(adapters:WeatherAdapter[]){for(const a of adapters){if(this.adapters.has(a.id))throw new Error('Duplicate weather adapter');this.adapters.set(a.id,a);}}
  get(id:string){const adapter=this.adapters.get(id);if(!adapter)throw new WeatherUnavailable('provider_unavailable','Weather adapter is not registered');return adapter;}
}
export class WeatherService extends WeatherProvider {
  readonly departureWindowSeconds=WEATHER_POLICY.departureWindowSeconds;
  private readonly budgets=new WeakMap<object,WeatherCallBudget>();
  constructor(private readonly config:WeatherConfig,readonly registry:WeatherAdapterRegistry,private readonly cache:WeatherCacheStore){super();}
  cleanup(){return this.cache.cleanup();}
  async forecast(raw:WeatherQuery[],callerSignal:AbortSignal,context?:{budgetScope:object;maxExternalCalls?:number}){
    const queries=z.array(weatherQuerySchema).max(WEATHER_POLICY.maxQueries).parse(raw);
    if(new Set(queries.map(q=>q.id)).size!==queries.length)throw new Error('Duplicate weather query');
    const adapter=this.registry.get(this.config.providerId),signal=AbortSignal.any([callerSignal,AbortSignal.timeout(WEATHER_POLICY.deadlineMs)]);
    const scope=context?.budgetScope??callerSignal;
    const limit=Math.min(WEATHER_POLICY.maxExternalCalls,context?.maxExternalCalls??WEATHER_POLICY.maxExternalCalls);
    if(!Number.isSafeInteger(limit)||limit<0)throw new Error('Invalid weather call budget');
    const budget=this.budgets.get(scope)??{used:0,limit};budget.limit=Math.min(budget.limit,limit);this.budgets.set(scope,budget);
    const now=Date.now();
    const result=new Map<string,WeatherForecast>(),groups=new Map<string,WeatherQuery[]>();
    for(const query of queries){
      if(Date.parse(query.validAt)<now){result.set(query.id,unavailableForecast(query,'outside_horizon',adapter.id));continue;}
      if(!this.config.enabled){result.set(query.id,unavailableForecast(query,'provider_unavailable',adapter.id));continue;}
      const sample=query.sampleLocation??query.location;
      if(meters(query.location,sample)>WEATHER_POLICY.sampleDistanceMeters){result.set(query.id,unavailableForecast(query,'outside_horizon',adapter.id));continue;}
      const url=adapter.url(weatherSampleLocation(query)),group=groups.get(url)??[];group.push(query);groups.set(url,group);
    }
    // Per-batch dedup also covers exact-coordinate fallbacks from a rejected terrain cell.
    const seriesByUrl=new Map<string,Promise<ReturnType<WeatherAdapter['parse']>>>();
    const seriesAt=(location:WeatherQuery['location'])=>{
      const url=adapter.url(location);let pending=seriesByUrl.get(url);
      if(!pending){pending=(async()=>{
        const document=await this.cache.get(adapter.id,adapter.version,url,signal,budget,d=>{
          if(meters(adapter.parse(d).location,location)>30)throw new Error('Weather provider returned wrong location');
        });
        const series=adapter.parse(document);if(meters(series.location,location)>30)throw new Error('Weather provider returned wrong location');
        return series;
      })();seriesByUrl.set(url,pending);}return pending;
    };
    let next=0;const entries=[...groups.entries()];
    await Promise.all(Array.from({length:WEATHER_POLICY.maxConcurrency},async()=>{
      while(next<entries.length){const index=next++,[url,group]=entries[index];
        if(index>=WEATHER_POLICY.maxSamples){for(const q of group)result.set(q.id,unavailableForecast(q,'budget_exhausted',adapter.id));continue;}
        try{
          signal.throwIfAborted();
          const series=await seriesAt(weatherSampleLocation(group[0]));
          // A model may legitimately update while the HTTP request is in flight.
          for(const query of group){
            const original=query.sampleLocation??query.location,chosen=weatherSampleLocation(query);
            const exact=chosen.latitude===original.latitude&&chosen.longitude===original.longitude;
            const selected=exact||terrainSharingIsSafe(query,series.elevation)?series:await seriesAt(original);
            const forecast=meters(query.location,selected.location)>WEATHER_POLICY.sampleDistanceMeters?
              unavailableForecast(query,'outside_horizon',adapter.id):normalizeWeather(selected,query,adapter.id,Date.now());
            if(!exact&&forecast.metadata)forecast.metadata.warnings.push(selected===series?'weather_spatial_cell_shared':'weather_cell_rejected_elevation_mismatch');
            result.set(query.id,forecast);
          }
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
  async forPreview(raw:RouteWeatherRequest,signal:AbortSignal){
    const input=routeWeatherRequestSchema.parse(raw),delta=Date.parse(input.departureAt)-Date.now();
    if(delta<0||delta>WEATHER_POLICY.departureWindowSeconds*1000)return {status:'preliminary_route' as const,route:input.route,
      reasons:['departure_outside_planning_window'],forecasts:[],sampling:null,energyReady:false};
    const sampling=samplePreviewWeather(input),response=await this.forecast(sampling.queries,signal,
      {budgetScope:{},maxExternalCalls:WEATHER_SAMPLING_POLICY.previewLocations});
    return {status:'preliminary_route' as const,route:input.route,forecasts:response.data,energyReady:false,
      reasons:['PREVIEW_REQUIRES_DETAILED_WEATHER_FOR_ENERGY',
        ...(sampling.unknownTimingSegmentIds.length?['unknown_stop_duration']:[]),
        ...new Set(response.data.filter(f=>!usableWeather(f)).map(f=>'weather_'+f.status))],
      sampling:{...sampling,policyVersion:WEATHER_SAMPLING_POLICY.version},source:response.source};
  }
  async forNavigation(raw:RouteWeatherRequest,options:NavigationWeatherOptions,signal:AbortSignal){
    const input=routeWeatherRequestSchema.parse(raw),delta=Date.parse(input.departureAt)-Date.now();
    // Navigation may already be underway; its route departure can be in the past.
    if(delta>WEATHER_POLICY.departureWindowSeconds*1000||delta< -WEATHER_POLICY.departureWindowSeconds*1000)
      return {status:'preliminary_route' as const,reasons:['departure_outside_planning_window'],forecasts:[],sampling:null,energyReady:false};
    try{
    const sampling=sampleNavigationWeather(input,options);
    if(!sampling.refresh)return {status:'window_unchanged' as const,forecasts:[],reasons:[],sampling,energyReady:false};
    const response=await this.forecast(sampling.queries,signal),missing=response.data.filter(f=>!usableWeather(f));
    return {status:missing.length||sampling.unknownTimingSegmentIds.length?'insufficient_data' as const:'weather_window_ready' as const,
      forecasts:response.data,reasons:[...new Set(missing.map(f=>'weather_'+f.status)),...(sampling.unknownTimingSegmentIds.length?['unknown_stop_duration']:[])],
      sampling:{...sampling,policyVersion:WEATHER_SAMPLING_POLICY.version},source:response.source,energyReady:false};
    }catch(error){
      if(signal.aborted)throw signal.reason;if(!(error instanceof WeatherUnavailable))throw error;
      return {status:'insufficient_data' as const,forecasts:[],reasons:['weather_'+error.kind],energyReady:false,
        sampling:null,coverage:{startMeters:options.progressMeters,endMeters:Math.min(input.route.distanceMeters,options.progressMeters+WEATHER_SAMPLING_POLICY.lookAheadMeters),
          wholeRouteReady:false}};
    }
  }
  async forDeparture(departureAt:string,queries:WeatherQuery[],signal:AbortSignal){
    const delta=Date.parse(departureAt)-Date.now();
    if(delta<0||delta>WEATHER_POLICY.departureWindowSeconds*1000)return {status:'preliminary_route' as const,forecasts:[],reasons:['departure_outside_planning_window']};
    const response=await this.forecast(queries,signal),missing=response.data.filter(f=>!usableWeather(f));
    return {status:missing.length?'insufficient_data' as const:'weather_ready' as const,forecasts:response.data,
      reasons:[...new Set(missing.map(f=>'weather_'+f.status))],source:response.source};
  }
}
