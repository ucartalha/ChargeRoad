import {z} from 'zod';
import type {LocationSearchResponse} from '@chargeroad/shared';
export abstract class GeocodingProvider {
  abstract readonly id:string;
  abstract search(query:string,signal:AbortSignal):Promise<LocationSearchResponse>;
}
export class GeocodingRegistry {
  private readonly providers=new Map<string,GeocodingProvider>();
  constructor(providers:GeocodingProvider[]){for(const p of providers){if(this.providers.has(p.id))throw new Error('Duplicate geocoder');this.providers.set(p.id,p);}}
  get(id:string){const provider=this.providers.get(id);if(!provider)throw new Error('Geocoder is not registered');return provider;}
}
export const GEOCODING_CONFIG=Symbol('GEOCODING_CONFIG');
const schema=z.object({enabled:z.boolean(),providerId:z.string().min(1),baseUrl:z.string().url().refine(v=>{const u=new URL(v);
  return !u.username&&!u.password&&!u.search&&!u.hash&&(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname));}),
  dailyLimit:z.number().int().min(1).max(100),timeoutMs:z.number().int().min(100).max(5000)});
export type GeocodingConfig=z.infer<typeof schema>;
export function geocodingConfig():GeocodingConfig{const config=schema.parse({enabled:process.env.GEOCODING_ENABLED!=='false',
  providerId:process.env.GEOCODING_PROVIDER_ID||'photon',baseUrl:process.env.GEOCODING_BASE_URL||'https://photon.komoot.io',dailyLimit:100,timeoutMs:5000});
  if(process.env.NODE_ENV==='production'&&config.enabled&&new URL(config.baseUrl).hostname==='photon.komoot.io')throw new Error('Use an approved geocoder endpoint or disable geocoding in production');return config;}
