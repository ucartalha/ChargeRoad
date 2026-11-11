import {z} from 'zod';

export const WEATHER_POLICY={version:'weather/1.0.0',maxSamples:64,maxExternalCalls:16,maxQueries:10000,
  sampleDistanceMeters:10000,sampleSeconds:900,maxAgeSeconds:43200,maxGapSeconds:21600,
  minIntervalMs:500,maxConcurrency:2,dailyLimit:1000,fetchTimeoutMs:5000,deadlineMs:20000,leaseSeconds:15,
  fallbackCacheSeconds:3600,retentionSeconds:86400,departureWindowSeconds:259200} as const;
const configSchema=z.object({enabled:z.boolean(),providerId:z.string().min(1),endpoint:z.string().url(),userAgent:z.string(),termsAccepted:z.boolean()}).strict();
export type WeatherConfig=z.infer<typeof configSchema>;
export function weatherConfig():WeatherConfig{
  const config=configSchema.parse({enabled:process.env.WEATHER_ENABLED==='true',providerId:process.env.WEATHER_PROVIDER_ID||'met-norway',
    endpoint:process.env.WEATHER_MET_ENDPOINT||'https://api.met.no/weatherapi/locationforecast/2.0/compact',
    userAgent:process.env.WEATHER_USER_AGENT||'',termsAccepted:process.env.WEATHER_MET_TERMS_ACCEPTED==='true'});
  const url=new URL(config.endpoint);
  if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname))))
    throw new Error('Invalid weather service endpoint');
  if(config.enabled&&(!config.termsAccepted||!/^ChargeRoad\/\S+ .{5,}$/.test(config.userAgent)||/[\r\n]/.test(config.userAgent)))
    throw new Error('Weather requires accepted terms and identifying User-Agent with contact details');
  return config;
}
