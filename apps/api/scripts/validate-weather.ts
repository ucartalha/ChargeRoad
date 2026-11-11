import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {NestFactory} from '@nestjs/core';
import {roadRouteSchema} from '@chargeroad/shared';
import {DatabaseService} from '../src/database/database.service';
import {createWeatherService} from '../src/weather/weather.module';
import {AppModule} from '../src/app.module';
import {sampleRouteWeather} from '../src/weather/weather-sampler';

async function main(){
  const input=process.argv[2];if(!input)throw new Error('Usage: weather:validate NORMALIZED_ROAD.json');
  const file=await readFile(resolve(input),'utf8');if(file.length>8*1024*1024)throw new Error('Road file too large');
  const parsed=JSON.parse(file),route=roadRouteSchema.parse(parsed.data?.routes?.[0]??parsed.route??parsed);
  const database=new DatabaseService();let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
  try{
    const service=createWeatherService(database),request={route,departureAt:new Date(Date.now()+300000).toISOString(),stops:[]};
    const before=await used(database),start=performance.now();
    const result=await service.forRoute(request,AbortSignal.timeout(20000));
    if(result.status!=='weather_ready')throw new Error('Real weather not ready: '+result.reasons.join(','));
    const after=await used(database);
    app=await NestFactory.create(AppModule,{logger:false});app.setGlobalPrefix('v1');await app.listen(0,'127.0.0.1');
    const httpStart=performance.now();
    const batch={departureAt:request.departureAt,queries:sampleRouteWeather(request).queries.slice(0,64)};
    const response=await fetch((await app.getUrl())+'/v1/weather/forecast',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(batch)});
    const http=await response.json();if(response.status!==200||http.status!=='weather_ready')throw new Error('Weather HTTP check failed: '+response.status);
    const report={generatedAt:new Date().toISOString(),status:result.status,routeSegments:route.segments.length,
      queryCount:result.forecasts.length,samples:result.sampling?.locations.length,acquisitionMs:httpStart-start,
      sourceCalls:after-before,sharedProviderState:(await database.pool.query('SELECT provider_id,used,day::text AS day FROM weather_provider_state')).rows,
      http:{status:response.status,elapsedMs:performance.now()-httpStart,extraSourceCalls:await used(database)-after},
      firstForecast:result.forecasts[0],lastForecast:result.forecasts.at(-1),
      missingCoreFields:result.forecasts.filter(f=>f.temperatureCelsius===null||f.windSpeedKph===null).length,
      issuedAtUnknown:result.forecasts.every(f=>f.forecastIssuedAt===null)};
    await writeFile(resolve(__dirname,'../../../docs/validation/task10-weather-validation.json'),JSON.stringify(report,null,2)+'\n');
    const raw=(await database.pool.query(`SELECT document FROM weather_forecast_cache WHERE provider_id='met-norway' AND document IS NOT NULL ORDER BY expires_at DESC LIMIT 1`)).rows[0]?.document;
    if(raw){const directory=resolve(__dirname,'../../../artifacts/task10-weather');await mkdir(directory,{recursive:true});await writeFile(resolve(directory,'met-document.json'),JSON.stringify(raw,null,2)+'\n');}
    console.log(JSON.stringify(report,null,2));
  }finally{if(app)await app.close();await database.onModuleDestroy();}
}
async function used(database:DatabaseService){return (await database.pool.query(`SELECT coalesce(sum(used),0)::int AS n FROM weather_provider_state`)).rows[0].n;}
void main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:'Weather validation failed');process.exitCode=1;});
