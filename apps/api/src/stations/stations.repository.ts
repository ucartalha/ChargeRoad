import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class StationsRepository {
  constructor(private readonly database:DatabaseService){}
  async list(bounds:{west:number;south:number;east:number;north:number;limit:number;offset:number}){
    const result=await this.database.pool.query(`WITH matches AS (
      SELECT location_id,payload FROM station_catalogue_heads WHERE public_access IS DISTINCT FROM false
      AND lifecycle IN ('operating','unknown')
      AND public.ST_Intersects(location_geog,public.ST_MakeEnvelope($1,$2,$3,$4,4326)::public.geography))
      SELECT (SELECT count(*)::int FROM matches) AS total,COALESCE((SELECT jsonb_agg(p ORDER BY id)
      FROM (SELECT location_id AS id,payload FROM matches ORDER BY location_id LIMIT $5 OFFSET $6) p),'[]'::jsonb) AS items`,
      [bounds.west,bounds.south,bounds.east,bounds.north,bounds.limit,bounds.offset]);
    return {...result.rows[0],limit:bounds.limit,offset:bounds.offset};
  }
  async detail(id:string){
    const result=await this.database.pool.query(`SELECT location_id AS id,payload FROM station_catalogue_heads
      WHERE location_id=$1 AND public_access IS DISTINCT FROM false AND lifecycle IN ('operating','unknown')`,[id]);
    return result.rows[0]??null;
  }
}
