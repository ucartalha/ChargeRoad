import {DatabaseService} from '../src/database/database.service';
import {WeatherCacheStore} from '../src/weather/weather-cache';
async function main(){const database=new DatabaseService();try{
  const store=new WeatherCacheStore(database,async()=>{throw new Error('Cleanup never calls network');},'');
  console.log(JSON.stringify({removed:await store.cleanup()}));
}finally{await database.onModuleDestroy();}}
void main().catch(()=>{console.error('Weather cleanup failed');process.exitCode=1;});
