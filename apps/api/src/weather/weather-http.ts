import {WEATHER_POLICY} from './weather-policy';
import type {WeatherConfig} from './weather-policy';
import type {WeatherTransport} from './weather-ports';
import {WeatherUnavailable} from './weather-ports';

export function weatherTransport(config:WeatherConfig):WeatherTransport{return async(url,lastModified,signal)=>{
  const warnings:string[]=[];
  try{
    const response=await fetch(url,{method:'GET',redirect:'error',signal,
      headers:{'User-Agent':config.userAgent,Accept:'application/json',...(lastModified?{'If-Modified-Since':lastModified}:{})}});
    const now=Date.now(),retry=response.headers.get('retry-after');
    if(![200,203,304].includes(response.status)){
      let seconds=retry?(Number.isFinite(Number(retry))?Number(retry):(Date.parse(retry)-now)/1000):60;
      if(!Number.isFinite(seconds))seconds=60;
      throw new WeatherUnavailable(response.status===429?'budget_exhausted':'provider_unavailable','Weather upstream HTTP '+response.status,Math.max(1,Math.ceil(seconds)));
    }
    if(response.status===203)warnings.push('weather_product_deprecated');
    const expiry=Date.parse(response.headers.get('expires')??'');
    if(!Number.isFinite(expiry)||expiry<=now)warnings.push('weather_cache_header_missing_or_expired');
    const modified=response.headers.get('last-modified'),validModified=modified&&Number.isFinite(Date.parse(modified))?modified:null;
    if(!validModified)warnings.push('weather_last_modified_unavailable');
    let body:unknown=null;
    if(response.status!==304){
      const reader=response.body?.getReader();if(!reader)throw new Error('Missing weather body');
      const chunks:Uint8Array[]=[];let bytes=0;
      for(;;){const value=await reader.read();if(value.done)break;bytes+=value.value.length;
        if(bytes>1024*1024){await reader.cancel();throw new Error('Weather body too large');}chunks.push(value.value);}
      body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    return {status:response.status,body,expiresAt:new Date(Number.isFinite(expiry)&&expiry>now?expiry:now+WEATHER_POLICY.fallbackCacheSeconds*1000).toISOString(),
      lastModified:validModified,validatedAt:new Date(now).toISOString(),warnings};
  }catch(error){if(error instanceof WeatherUnavailable)throw error;throw new WeatherUnavailable('provider_unavailable','Weather transport failed');}
};}
