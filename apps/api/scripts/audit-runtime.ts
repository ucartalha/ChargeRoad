import {NestFactory} from '@nestjs/core';
import {AppModule} from '../src/app.module';
import {DatabaseService} from '../src/database/database.service';
async function main(){const app=await NestFactory.createApplicationContext(AppModule,{logger:false});try{
 const db=app.get(DatabaseService);
 const roads=await db.pool.query(`SELECT provider_id,day,used,day=(now() AT TIME ZONE 'UTC')::date AS today,
  blocked_until>now() AS blocked,GREATEST(0,ceil(extract(epoch FROM blocked_until-now())))::int AS retry_seconds FROM road_provider_budget`);
 const weather=await db.pool.query(`SELECT provider_id,day,used,day=(now() AT TIME ZONE 'UTC')::date AS today,blocked_until>now() AS blocked FROM weather_provider_state`);
 const cache=await db.pool.query(`SELECT provider_id,count(*)::int total,count(*) FILTER(WHERE expires_at>now())::int fresh FROM road_response_cache GROUP BY provider_id`);
 console.log(JSON.stringify({checkedAt:new Date().toISOString(),roads:roads.rows,weather:weather.rows,roadCache:cache.rows},null,2));
 }finally{await app.close();}}void main().catch(e=>{console.error(e instanceof Error?e.message:'Audit failed');process.exitCode=1;});
