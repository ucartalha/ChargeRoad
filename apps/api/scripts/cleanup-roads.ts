import { DatabaseService } from '../src/database/database.service';

async function main(){
  const database=new DatabaseService();
  try{
    const cache=await database.pool.query(`DELETE FROM road_response_cache WHERE expires_at<=now()
      AND (token IS NULL OR lease_until<=now())`);
    const ways=await database.pool.query('DELETE FROM osm_way_attributes WHERE expires_at<=now()');
    console.log(JSON.stringify({expiredResponses:cache.rowCount,expiredWayAttributes:ways.rowCount}));
  }finally{await database.onModuleDestroy();}
}
void main().catch(()=>{console.error('Road cleanup failed');process.exitCode=1;});
