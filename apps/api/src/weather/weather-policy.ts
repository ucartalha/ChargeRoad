import {z} from 'zod';

export const WEATHER_POLICY={version:'weather/1.2.0',maxSamples:128,maxExternalCalls:128,maxQueries:10000,
  sampleDistanceMeters:15000,sampleSeconds:900,maxAgeSeconds:43200,maxGapSeconds:21600,
  // Shared (PG) pacing: <=10 req/s for the whole deployment, half of MET's 20 req/s total limit (ToS rev. 2026-11-05).
  minIntervalMs:100,maxConcurrency:4,dailyLimit:1000,fetchTimeoutMs:5000,deadlineMs:30000,leaseSeconds:15,
  fallbackCacheSeconds:3600,retentionSeconds:86400,departureWindowSeconds:259200,
  // W5: after MET's Expires (~31 min) a validated document keeps being served for up to 8 h; only then may that
  // location be requested again. A served model run must still pass the 12 h forecast-age rule (1 h margin).
  cacheServeSeconds:28800,cacheServeMaxSourceAgeSeconds:39600} as const;
// Separate from detailed energy validation: coarse weather never certifies a charging decision.
export const WEATHER_SAMPLING_POLICY={version:'weather-sampling/2.0.0',previewLocations:5,
  shortRouteMeters:150000,shortStepMeters:10000,longStepMeters:20000,riskStepMeters:5000,
  lookAheadMeters:50000,advanceMeters:20000,etaChangeSeconds:900,terrainReliefMeters:100,
  spatialGridDegrees:.005,spatialMaxOffsetMeters:500,spatialMaxElevationDeltaMeters:100,
  maxPendingKeys:128} as const;
/** Self-hosted Open-Meteo (infra/open-meteo): no external ToS quota; limits protect the local server only. */
export const SELF_HOSTED_WEATHER_LIMITS={dailyLimit:200000,minIntervalMs:0,maxConcurrency:8} as const;
export const SELF_HOSTED_WEATHER_PROVIDERS:readonly string[]=['open-meteo-local'];
/** MET Norway keeps WEATHER_POLICY's ToS-derived limits unchanged; only a registered self-hosted provider differs. */
export function weatherProviderLimits(providerId:string){
  return SELF_HOSTED_WEATHER_PROVIDERS.includes(providerId)?{...SELF_HOSTED_WEATHER_LIMITS}:
    {dailyLimit:WEATHER_POLICY.dailyLimit,minIntervalMs:WEATHER_POLICY.minIntervalMs,maxConcurrency:WEATHER_POLICY.maxConcurrency};
}
export const OPEN_METEO_DEFAULTS={endpoint:'http://127.0.0.1:8090',metaEndpoint:'http://127.0.0.1:8091',model:'dwd_icon',domain:'dwd_icon_global_native'} as const;
const openMeteoSchema=z.object({endpoint:z.string().url(),metaEndpoint:z.string().url(),model:z.string().regex(/^[a-z0-9_]+$/),domain:z.string().regex(/^[a-z0-9_]+$/)}).strict();
const configSchema=z.object({enabled:z.boolean(),providerId:z.string().min(1),endpoint:z.string().url(),userAgent:z.string(),termsAccepted:z.boolean(),
  openMeteo:openMeteoSchema.optional()}).strict();
export type WeatherConfig=z.infer<typeof configSchema>;
const loopback=(value:string)=>{const url=new URL(value);
  return url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/';};
export function weatherConfig():WeatherConfig{
  const config=configSchema.parse({enabled:process.env.WEATHER_ENABLED==='true',providerId:process.env.WEATHER_PROVIDER_ID||'met-norway',
    endpoint:process.env.WEATHER_MET_ENDPOINT||'https://api.met.no/weatherapi/locationforecast/2.0/compact',
    userAgent:process.env.WEATHER_USER_AGENT||'',termsAccepted:process.env.WEATHER_MET_TERMS_ACCEPTED==='true',
    openMeteo:{endpoint:process.env.WEATHER_OPEN_METEO_ENDPOINT||OPEN_METEO_DEFAULTS.endpoint,metaEndpoint:process.env.WEATHER_OPEN_METEO_META_ENDPOINT||OPEN_METEO_DEFAULTS.metaEndpoint,
      model:process.env.WEATHER_OPEN_METEO_MODEL||OPEN_METEO_DEFAULTS.model,domain:process.env.WEATHER_OPEN_METEO_DOMAIN||OPEN_METEO_DEFAULTS.domain}});
  const url=new URL(config.endpoint);
  if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname))))
    throw new Error('Invalid weather service endpoint');
  if(SELF_HOSTED_WEATHER_PROVIDERS.includes(config.providerId)){
    // Development pilot: the self-hosted server is only ever reached on loopback.
    if(!config.openMeteo||!loopback(config.openMeteo.endpoint)||!loopback(config.openMeteo.metaEndpoint))throw new Error('Self-hosted weather endpoints must be loopback http origins');
    return config;
  }
  if(config.enabled&&(!config.termsAccepted||!/^ChargeRoad\/\S+ .{5,}$/.test(config.userAgent)||/[\r\n]/.test(config.userAgent)))
    throw new Error('Weather requires accepted terms and identifying User-Agent with contact details');
  return config;
}
