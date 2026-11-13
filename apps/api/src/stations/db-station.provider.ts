import { stationCandidateSetSchema,roadRouteSchema } from '@chargeroad/shared';
import type { RoadRoute,StationCandidateSet } from '@chargeroad/shared';
import { z } from 'zod';
import { DatabaseService } from '../database/database.service';
import { StationDataProvider } from '../providers/station-data-provider';
import { STATION_POLICY } from './station-policy';

export type StationQueryPolicy={version:string;corridorStepsMeters:readonly number[];maxCandidates:number;maxRoutes:number;maxGeometryPoints:number;statementTimeoutMs:number;staticSoftAgeSeconds:number};
export const CORRIDOR_SQL=`WITH segments AS (
  SELECT "routeId","segmentId",((row_number() OVER(PARTITION BY "routeId" ORDER BY ordinal))-1)/64 AS chunk,
    public.ST_SetSRID(public.ST_GeomFromGeoJSON(geometry::text),4326) AS geom
  FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS input(value,ordinal)
    CROSS JOIN LATERAL jsonb_to_record(input.value) AS x("routeId" text,"segmentId" text,geometry jsonb)
), chunks AS (
  SELECT "routeId",chunk,public.ST_Collect(geom)::public.geography AS geog FROM segments GROUP BY "routeId",chunk
), chunk_matches AS (
  SELECT h.location_id,c."routeId",c.chunk FROM chunks c JOIN station_catalogue_heads h
    ON public.ST_DWithin(h.location_geog,c.geog,$2)
  WHERE h.public_access IS DISTINCT FROM false AND h.lifecycle IN ('operating','unknown')
    AND (cardinality($4::text[])=0 OR cardinality(h.connector_standards)=0 OR 'other'=ANY(h.connector_standards) OR h.connector_standards && $4::text[])
), ids AS (SELECT DISTINCT location_id FROM chunk_matches ORDER BY location_id LIMIT $3
), matches AS (
  SELECT h.location_id,s."routeId",s."segmentId",
    public.ST_Distance(h.location_geog,s.geom::public.geography) AS distance_meters,
    public.ST_LineLocatePoint(s.geom,public.ST_ClosestPoint(s.geom,h.location_geog::public.geometry)) AS progress
  FROM chunk_matches c JOIN ids ON ids.location_id=c.location_id
    JOIN station_catalogue_heads h ON h.location_id=c.location_id JOIN segments s ON s."routeId"=c."routeId" AND s.chunk=c.chunk
  WHERE public.ST_DWithin(h.location_geog,s.geom::public.geography,$2)
)
SELECT m.location_id,h.payload,m.route_matches FROM (
SELECT m.location_id,jsonb_agg(jsonb_build_object('routeId',m."routeId",'segmentId',m."segmentId",
  'distanceMeters',m.distance_meters,'segmentProgress',m.progress) ORDER BY m."routeId",m."segmentId") AS route_matches
FROM matches m JOIN ids ON ids.location_id=m.location_id GROUP BY m.location_id
) m JOIN station_catalogue_heads h ON h.location_id=m.location_id ORDER BY m.location_id`;

export class DbStationDataProvider extends StationDataProvider {
  constructor(private readonly database:DatabaseService,private readonly policy:StationQueryPolicy=STATION_POLICY){super();}
  async findAlongRoutes(rawRoutes:RoadRoute[],corridorMeters:number,signal:AbortSignal,standards:string[]=[]){
    signal.throwIfAborted();
    const routes=z.array(roadRouteSchema).min(1).max(this.policy.maxRoutes).parse(rawRoutes);
    if(!Number.isFinite(corridorMeters)||corridorMeters<=0||corridorMeters>Math.max(...this.policy.corridorStepsMeters))
      throw new Error('Station corridor exceeds server policy');
    if(!Number.isSafeInteger(this.policy.maxCandidates)||this.policy.maxCandidates<1||this.policy.maxCandidates>500)
      throw new Error('Invalid server candidate budget');
    const points=routes.reduce((n,r)=>n+r.segments.reduce((m,s)=>m+s.geometry.length,0),0);
    if(points>this.policy.maxGeometryPoints)throw new Error('Station geometry budget exceeded');
    const segments=routes.flatMap(r=>r.segments.map(s=>({routeId:r.id,segmentId:s.id,
      geometry:{type:'LineString',coordinates:s.geometry.map(p=>[p.longitude,p.latitude])}})));
    const client=await this.database.pool.connect();
    try{
      signal.throwIfAborted();
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query('SELECT set_config($1,$2,true)',['statement_timeout',String(this.policy.statementTimeoutMs)]);
      const coverage=await client.query(`SELECT s.id,s.source_key,s.scope_key,s.country_code,s.source_complete,
        s.geographic_coverage_verified,s.source_updated_at,s.quality_exclusions,s.coverage_bounds,s.content_sha256,pub.last_checked_at FROM station_source_publications pub
        JOIN station_source_snapshots s ON s.id=pub.snapshot_id
        WHERE COALESCE((SELECT (m.policy->'providers'->s.source_key->>'enabled')::boolean
          FROM station_catalogue_materializations m ORDER BY m.id DESC LIMIT 1),true)
        ORDER BY s.source_key,s.scope_key`);
      signal.throwIfAborted();
      let usedCorridor=corridorMeters;
      let result=await client.query(CORRIDOR_SQL,[JSON.stringify(segments),usedCorridor,this.policy.maxCandidates+1,standards]);
      while(!result.rowCount){
        const next=this.policy.corridorStepsMeters.find(n=>n>usedCorridor);
        if(next===undefined)break;
        signal.throwIfAborted();usedCorridor=next;
        result=await client.query(CORRIDOR_SQL,[JSON.stringify(segments),usedCorridor,this.policy.maxCandidates+1,standards]);
      }
      signal.throwIfAborted();
      const now=Date.now();
      const sourceRows=coverage.rows.map(s=>({sourceId:s.source_key,scopeKey:s.scope_key,countryCode:s.country_code,
        snapshotId:s.id,sourceSnapshotComplete:s.source_complete,geographicCoverageVerified:s.geographic_coverage_verified,
        retrievedAt:s.last_checked_at.toISOString(),sourceUpdatedAt:s.source_updated_at?.toISOString()??null,
        stale:now-s.last_checked_at.getTime()>this.policy.staticSoftAgeSeconds*1000,qualityExclusions:s.quality_exclusions}));
      const truncated=result.rows.length>this.policy.maxCandidates;
      const usableCoverage=coverage.rows.filter((s,i)=>sourceRows[i].sourceSnapshotComplete&&!sourceRows[i].stale&&
        sourceRows[i].qualityExclusions===0&&s.geographic_coverage_verified&&s.coverage_bounds);
      // Each complete segment must fit one verified convex coverage box; points across a gap are insufficient.
      const completeForQuery=!truncated&&sourceRows.length>0&&sourceRows.every(s=>s.sourceSnapshotComplete&&s.geographicCoverageVerified&&!s.stale&&s.qualityExclusions===0)
        &&segments.every(s=>usableCoverage.some(c=>s.geometry.coordinates.every(([lon,lat])=>
        lon>=c.coverage_bounds.minLongitude&&lon<=c.coverage_bounds.maxLongitude&&lat>=c.coverage_bounds.minLatitude&&lat<=c.coverage_bounds.maxLatitude)));
      const data:StationCandidateSet=stationCandidateSetSchema.parse({
        metadata:{schemaVersion:'station-search/1.0.0',coverage:{completeForQuery,sources:sourceRows,
          notes:completeForQuery?[]:['Candidate completeness is limited to the available source coverage; no global station guarantee.']},
          search:{policyVersion:this.policy.version,corridorMeters:usedCorridor,maxCandidates:this.policy.maxCandidates,truncated,
            nextCorridorMeters:this.policy.corridorStepsMeters.find(n=>n>usedCorridor)??null,
            emptyReason:result.rows.length?'none':completeForQuery?'no_matches_in_known_data':'coverage_missing'},
          revisions:coverage.rows.map(s=>({snapshotId:s.id,checksumSha256:s.content_sha256}))},
        candidates:result.rows.slice(0,this.policy.maxCandidates).map(r=>({...r.payload,routeMatches:r.route_matches,
          warnings:[...new Set([...r.payload.warnings,
            ...(r.payload.station.access.publicAccess===null?['public_access_unknown']:[]),
            ...(r.payload.station.access.membershipRequired===null?['membership_requirement_unknown']:[]),
            ...(r.payload.station.access.openingHours===null?['opening_hours_unknown']:[])])]})),
      });
      await client.query('COMMIT');
      return {data,source:{sourceId:'chargeroad-station-catalogue',recordId:null,version:this.policy.version,url:null,
        retrievedAt:new Date().toISOString(),publishedAt:null,license:null}};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
}
