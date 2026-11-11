import type { PoolClient } from 'pg';
import { mergeStationEvidence,type StationPayload } from './merge-evidence';
import { DEFAULT_SOURCE_POLICY,type StationSourcePolicy } from './sources/source-policy';

// Runs only during explicit publication/rebuild, never during a mobile read.
export async function rebuildStationHeads(client:PoolClient,policy:StationSourcePolicy=DEFAULT_SOURCE_POLICY){
  const settings=JSON.stringify(policy.providers),preferences=policy.fields.station??[];
  const enabled=`COALESCE(($1::jsonb->s.source_key->>'enabled')::boolean,true)`;
  const ordering=`COALESCE(array_position($2::text[],s.source_key),2147483647),
    COALESCE(($1::jsonb->s.source_key->>'priority')::int,ds.priority),
    COALESCE(($1::jsonb->s.source_key->>'costRank')::int,1000),s.source_key,s.scope_key`;
  await client.query(`INSERT INTO station_catalogue_heads(location_id,revision_id,snapshot_id,source_key,location_geog,lifecycle,public_access,connector_standards,payload)
    SELECT DISTINCT ON(r.location_id) r.location_id,r.id,r.snapshot_id,s.source_key,r.location_geog,r.lifecycle,r.public_access,r.connector_standards,r.payload
    FROM station_location_revisions r JOIN station_source_snapshots s ON s.id=r.snapshot_id
    JOIN station_source_publications pub ON pub.snapshot_id=s.id JOIN station_data_sources ds ON ds.key=s.source_key
    WHERE ${enabled} ORDER BY r.location_id,${ordering}
    ON CONFLICT(location_id) DO UPDATE SET revision_id=EXCLUDED.revision_id,snapshot_id=EXCLUDED.snapshot_id,source_key=EXCLUDED.source_key,
      location_geog=EXCLUDED.location_geog,lifecycle=EXCLUDED.lifecycle,public_access=EXCLUDED.public_access,
      connector_standards=EXCLUDED.connector_standards,payload=EXCLUDED.payload
    WHERE station_catalogue_heads.revision_id<>EXCLUDED.revision_id
      OR station_catalogue_heads.payload IS DISTINCT FROM EXCLUDED.payload`,[settings,preferences]);
  await client.query(`DELETE FROM station_catalogue_heads h WHERE NOT EXISTS(SELECT 1 FROM station_location_revisions r
    JOIN station_source_snapshots s ON s.id=r.snapshot_id JOIN station_source_publications pub ON pub.snapshot_id=r.snapshot_id
    WHERE r.location_id=h.location_id AND ${enabled})`,[settings]);
  const overlapping=await client.query<{location_id:string;payload:StationPayload}>(`WITH shared AS (
    SELECT r.location_id FROM station_location_revisions r JOIN station_source_publications pub ON pub.snapshot_id=r.snapshot_id
    JOIN station_source_snapshots s ON s.id=r.snapshot_id WHERE ${enabled} GROUP BY r.location_id HAVING count(*)>1)
    SELECT r.location_id,r.payload FROM shared JOIN station_location_revisions r ON r.location_id=shared.location_id
    JOIN station_source_snapshots s ON s.id=r.snapshot_id JOIN station_source_publications pub ON pub.snapshot_id=r.snapshot_id
    JOIN station_data_sources ds ON ds.key=pub.source_key WHERE ${enabled} ORDER BY r.location_id,${ordering}`,[settings,preferences]);
  const groups=new Map<string,StationPayload[]>();
  for(const row of overlapping.rows){const list=groups.get(row.location_id)??[];list.push(row.payload);groups.set(row.location_id,list);}
  if(groups.size){
    const merged=[...groups].map(([locationId,records])=>{
      const payload=mergeStationEvidence(records,policy);
      const standards=[...new Set([...payload.connectorClaims.map(c=>c.standard),...payload.station.evses.flatMap(e=>e.connectors.map(c=>c.standard))])];
      return {locationId,lifecycle:payload.lifecycle,publicAccess:payload.station.access.publicAccess,standards,payload};
    });
    await client.query(`UPDATE station_catalogue_heads h SET payload=x.payload,lifecycle=x.lifecycle,public_access=x."publicAccess",connector_standards=x.standards
      FROM jsonb_to_recordset($1::jsonb) AS x("locationId" uuid,lifecycle text,"publicAccess" boolean,standards text[],payload jsonb)
      WHERE h.location_id=x."locationId"`,[JSON.stringify(merged)]);
  }
  await client.query(`INSERT INTO station_catalogue_materializations(policy_version,policy,snapshot_ids)
    SELECT $1,$2::jsonb,COALESCE(jsonb_agg(snapshot_id ORDER BY source_key,scope_key),'[]'::jsonb) FROM station_source_publications`,
    [policy.version,JSON.stringify(policy)]);
}
