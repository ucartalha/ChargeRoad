import {z} from 'zod';
import type {LocationResult} from '@chargeroad/shared';
import {locationSearchResponseSchema} from '@chargeroad/shared';
import {GeocodingProvider} from './geocoding-provider';
const feature=z.object({geometry:z.object({type:z.literal('Point'),coordinates:z.tuple([z.number().finite(),z.number().finite()])}),
  properties:z.record(z.string(),z.unknown())});
export class PhotonProvider extends GeocodingProvider {
  readonly id='photon';
  constructor(private readonly baseUrl:string,private readonly transport:typeof fetch=fetch){super();}
  async search(query:string,signal:AbortSignal){
    const url=new URL('api/',this.baseUrl.replace(/\/?$/,'/'));url.search=new URLSearchParams({q:query,limit:'6',bbox:'25.6,35.8,44.9,42.2'}).toString();
    const response=await this.transport(url,{signal,redirect:'error',headers:{Accept:'application/json','User-Agent':'ChargeRoad-development/0.1'}});
    if(!response.ok)throw new Error('Geocoder unavailable');
    const reader=response.body?.getReader();if(!reader)throw new Error('Missing response');let size=0;const chunks:Uint8Array[]=[];
    try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>262144)throw new Error('Geocoder response limit');chunks.push(part.value);}}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    const body=z.object({features:z.array(z.unknown()).max(100)}).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    const results:LocationResult[]=[];
    for(const raw of body.features){const parsed=feature.safeParse(raw);if(!parsed.success)continue;const {coordinates:[longitude,latitude]}=parsed.data.geometry,p=parsed.data.properties;
      if(latitude<35.8||latitude>42.2||longitude<25.6||longitude>44.9||typeof p.countrycode==='string'&&p.countrycode.toUpperCase()!=='TR')continue;
      const parts=[p.name,p.street,p.housenumber,p.district,p.city,p.state].filter((v):v is string=>typeof v==='string'&&v.length>0);
      const label=[...new Set(parts)].join(', ').slice(0,500);if(!label)continue;
      results.push({id:`photon:${String(p.osm_type??'point')}:${String(p.osm_id??longitude+','+latitude)}`.slice(0,200),label,coordinate:{latitude,longitude}});
      if(results.length===6)break;}
    return locationSearchResponseSchema.parse({schemaVersion:'1.0.0',providerId:this.id,retrievedAt:new Date().toISOString(),
      attribution:'© OpenStreetMap contributors · Photon',attributionUrl:'https://www.openstreetmap.org/copyright',results});
  }
}
