import { createHash,randomUUID } from 'node:crypto';
import { stationImportPackageSchema } from '@chargeroad/shared';
import type { StationImportPackage } from '@chargeroad/shared';
import { DatabaseService } from '../database/database.service';
import { canonicalJson } from '../vehicles/knowledge/knowledge-package';
import type { PoolClient } from 'pg';
import { rebuildStationHeads } from './station-materialization';
import type { StationSourcePolicy } from './sources/source-policy';
import { STATION_POLICY } from './station-policy';

export class StationImportRepository {
  constructor(private readonly database:DatabaseService){}
  async publish(rawPackage:StationImportPackage,rawBytes:Buffer,options:{guard?:(client:PoolClient)=>Promise<void>;policy?:StationSourcePolicy}={}){
    const p=stationImportPackageSchema.parse(rawPackage);
    if(Date.parse(p.retrievedAt)>Date.now()+300000)throw new Error('Station acquisition cannot be in the future');
    if(createHash('sha256').update(rawBytes).digest('hex')!==p.rawSha256)throw new Error('Station raw snapshot checksum mismatch');
    const semanticRecords=p.records.map(r=>({...r,station:{...r.station,source:{...r.station.source,version:null,retrievedAt:'1970-01-01T00:00:00Z'}}}))
      .sort((a,b)=>JSON.stringify([a.partyId,a.externalId]).localeCompare(JSON.stringify([b.partyId,b.externalId])));
    const contentHash=createHash('sha256').update(canonicalJson({source:p.source,scope:p.scope,records:semanticRecords,quarantine:p.quarantine})).digest('hex');
    const report={source:p.source.key,sourceRows:p.sourceRowCount,accepted:p.records.length,quarantined:p.quarantine.length,
      publicLocations:p.records.filter(r=>r.station.access.publicAccess===true).length,
      privateLocations:p.records.filter(r=>r.station.access.publicAccess===false).length,
      connectorClaims:p.records.reduce((n,r)=>n+r.connectorClaims.length,0),
      actualEvses:p.records.reduce((n,r)=>n+r.station.evses.length,0),rawSha256:p.rawSha256,contentSha256:contentHash};
    const client=await this.database.pool.connect();
    const runId=randomUUID();let snapshotId:string|undefined;
    try{
      await client.query("INSERT INTO station_import_runs(id,source_key,status,receipt) VALUES($1,$2,'running',$3::jsonb)",
        [runId,p.source.key,JSON.stringify({retrievedAt:p.retrievedAt,rawSha256:p.rawSha256,contentSha256:contentHash,version:p.version})]);
      await client.query('BEGIN');
      await options.guard?.(client);
      await client.query("SET LOCAL lock_timeout='3s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('chargeroad:station-import:'||$1))",[p.source.key]);
      const existing=await client.query<{id:string;status:string}>(
        'SELECT id,status FROM station_source_snapshots WHERE source_key=$1 AND scope_key=$2 AND content_sha256=$3',
        [p.source.key,p.scope.key,contentHash]);
      if(existing.rows[0]?.status==='published'){
        snapshotId=existing.rows[0].id;
        const current=await client.query('SELECT 1 FROM station_source_publications WHERE source_key=$1 AND scope_key=$2 AND snapshot_id=$3',
          [p.source.key,p.scope.key,snapshotId]);
        if(current.rowCount)await client.query('UPDATE station_source_publications SET last_checked_at=GREATEST(last_checked_at,$3) WHERE source_key=$1 AND scope_key=$2',
          [p.source.key,p.scope.key,p.retrievedAt]);
        if(current.rowCount){
          await client.query("UPDATE station_import_runs SET status='unchanged',snapshot_id=$2,finished_at=now() WHERE id=$1",[runId,snapshotId]);
          await client.query('COMMIT');return {snapshotId,unchanged:true,published:true,report};
        }
        // The content can legitimately return to an earlier state after a newer verified acquisition.
        // Reuse immutable evidence but evaluate the incoming receipt against the current publication below.
      }
      const source=await client.query<{permission:string;license:string|null;priority:number}>(
        `INSERT INTO station_data_sources(key,name,homepage_url,permission,permission_reference,attribution,license,priority)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(key) DO UPDATE SET key=EXCLUDED.key RETURNING permission,license,priority`,
        [p.source.key,p.source.name,p.source.homepageUrl,p.source.permission,p.source.permissionReference,p.source.attribution,p.source.license,p.source.priority]);
      if(source.rows[0].permission!==p.source.permission || source.rows[0].license!==p.source.license || source.rows[0].priority!==p.source.priority)
        throw new Error('Station source terms/priority changed; explicit review required');
      snapshotId=existing.rows[0]?.id ?? randomUUID();
      if(!existing.rowCount){
        await client.query(`INSERT INTO station_source_snapshots(id,source_key,scope_key,country_code,version,retrieved_at,source_updated_at,
          raw_sha256,content_sha256,source_complete,geographic_coverage_verified,source_row_count,quality_exclusions,status,raw_bytes,report,coverage_bounds)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'staged',$14,$15::jsonb,$16::jsonb)`,
          [snapshotId,p.source.key,p.scope.key,p.scope.countryCode,p.version,p.retrievedAt,p.sourceUpdatedAt,p.rawSha256,contentHash,
            p.scope.completeSourceSnapshot,p.scope.geographicCoverageVerified,p.sourceRowCount,p.quarantine.length,rawBytes,
            JSON.stringify({...report,quarantine:p.quarantine}),JSON.stringify(p.scope.coverageBounds)]);
        for(let offset=0;offset<p.records.length;offset+=250){
          const records=p.records.slice(offset,offset+250);
          const old=await client.query<{external_id:string;party_id:string;location_id:string}>(
            `SELECT a.external_id,a.party_id,a.location_id FROM station_source_aliases a
             JOIN jsonb_to_recordset($2::jsonb) AS x("externalId" text,"partyId" text,"countryCode" text)
             ON a.external_id=x."externalId" AND a.party_id=x."partyId" AND a.country_code=x."countryCode" WHERE a.source_key=$1`,
            [p.source.key,JSON.stringify(records.map(r=>({externalId:r.externalId,partyId:r.partyId,countryCode:r.countryCode})))]);
          const aliases=new Map(old.rows.map(r=>[JSON.stringify([r.party_id,r.external_id]),r.location_id]));
          const rows=records.map(record=>{
            const previous=aliases.get(JSON.stringify([record.partyId,record.externalId]));
            if(previous && record.matchCanonicalId && previous!==record.matchCanonicalId)throw new Error('Station identity cannot be silently remapped');
            const locationId=previous??record.matchCanonicalId??randomUUID();
            const station=structuredClone(record.station);station.id=locationId;
            return {id:randomUUID(),location_id:locationId,external_id:record.externalId,party_id:record.partyId,country_code:record.countryCode,
              create_entity:!previous&&!record.matchCanonicalId,match_rationale:record.matchRationale??'Exact source namespace identity; no geographic merge',
              longitude:station.location.longitude,latitude:station.location.latitude,lifecycle:record.lifecycle,public_access:station.access.publicAccess,
              standards:[...new Set([...record.connectorClaims.map(c=>c.standard),...station.evses.flatMap(e=>e.connectors.map(c=>c.standard))])],
              payload:{station,connectorClaims:record.connectorClaims,warnings:record.warnings,lifecycle:record.lifecycle,
                ...(record.licenseEvidence?{licenseEvidence:record.licenseEvidence}:{}),
                ...(record.recordUpdatedAt!==undefined?{recordUpdatedAt:record.recordUpdatedAt}:{})}};
          });
          const json=JSON.stringify(rows);
          const moved=await client.query(`SELECT h.location_id FROM station_catalogue_heads h
            JOIN jsonb_to_recordset($1::jsonb) AS x(location_id uuid,longitude double precision,latitude double precision) ON x.location_id=h.location_id
            WHERE public.ST_Distance(h.location_geog,public.ST_SetSRID(public.ST_MakePoint(x.longitude,x.latitude),4326)::public.geography)>$2 LIMIT 1`,
            [json,STATION_POLICY.maxAutomaticCoordinateMoveMeters]);
          if(moved.rowCount)throw new Error('Station coordinate move requires explicit review');
          await client.query(`INSERT INTO charging_locations(id) SELECT DISTINCT location_id FROM jsonb_to_recordset($1::jsonb)
            AS x(location_id uuid,create_entity boolean) WHERE create_entity`,[json]);
          await client.query(`INSERT INTO station_source_aliases(source_key,country_code,party_id,external_id,location_id,match_rationale)
            SELECT $1,country_code,party_id,external_id,location_id,match_rationale FROM jsonb_to_recordset($2::jsonb)
            AS x(country_code text,party_id text,external_id text,location_id uuid,match_rationale text) ON CONFLICT DO NOTHING`,[p.source.key,json]);
          await client.query(`INSERT INTO station_location_revisions(id,snapshot_id,location_id,location_geog,lifecycle,public_access,connector_standards,payload)
            SELECT id,$1,location_id,public.ST_SetSRID(public.ST_MakePoint(longitude,latitude),4326)::public.geography,
              lifecycle,public_access,standards,payload FROM jsonb_to_recordset($2::jsonb)
            AS x(id uuid,location_id uuid,longitude double precision,latitude double precision,lifecycle text,public_access boolean,standards text[],payload jsonb)`,
            [snapshotId,json]);
          await client.query(`INSERT INTO station_connector_claims(revision_id,external_id,standard,power_type,max_power_kw,payload)
            SELECT x.id,c->>'sourceConnectorId',c->>'standard',c->>'powerType',(c->>'maxPowerKw')::double precision,c
            FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,payload jsonb),jsonb_array_elements(x.payload->'connectorClaims') c`,[json]);
          await client.query(`INSERT INTO charging_evses(revision_id,id,payload)
            SELECT x.id,e->>'id',e FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,payload jsonb),jsonb_array_elements(x.payload->'station'->'evses') e`,[json]);
          await client.query(`INSERT INTO charging_connectors(revision_id,evse_id,id,payload)
            SELECT revision_id,e.id,c->>'id',c FROM charging_evses e,jsonb_array_elements(e.payload->'connectors') c
            WHERE revision_id=ANY($1::uuid[])`,[rows.map(r=>r.id)]);
          await client.query(`INSERT INTO charging_power_pools(revision_id,id,payload)
            SELECT x.id,p->>'id',p FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,payload jsonb),jsonb_array_elements(x.payload->'station'->'sharedPowerPools') p`,[json]);
        }
      }
      await client.query('COMMIT');
      // Stage is durable first. Readers see no partial revisions until the short publication below.
      await client.query('BEGIN');
      await options.guard?.(client);
      await client.query("SET LOCAL lock_timeout='3s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('chargeroad:station-publication'))");
      const review=options.policy?.providers[p.source.key]?.quarantineReview;
      const reviewed=p.quarantine.every(q=>q.externalId!==null&&review?.exclusions.some(e=>e.externalId===q.externalId&&e.reason===q.reason));
      if(!p.scope.completeSourceSnapshot || (p.quarantine.length&&!reviewed))throw new Error('Incomplete/invalid source snapshot staged; previous publication preserved');
      const newer=await client.query(`SELECT 1 FROM station_source_publications pub
        WHERE pub.source_key=$1 AND pub.scope_key=$2 AND pub.last_checked_at>$3`,[p.source.key,p.scope.key,p.retrievedAt]);
      if(newer.rowCount)throw new Error('Refusing older station publication');
      const already=await client.query('SELECT 1 FROM station_source_publications WHERE source_key=$1 AND scope_key=$2 AND snapshot_id=$3',
        [p.source.key,p.scope.key,snapshotId]);
      if(already.rowCount){
        await client.query('UPDATE station_source_publications SET last_checked_at=GREATEST(last_checked_at,$3) WHERE source_key=$1 AND scope_key=$2',
          [p.source.key,p.scope.key,p.retrievedAt]);
        await client.query("UPDATE station_import_runs SET status='unchanged',snapshot_id=$2,finished_at=now() WHERE id=$1",[runId,snapshotId]);
        await client.query('COMMIT');return {snapshotId,unchanged:true,published:true,report};
      }
      await client.query(`INSERT INTO station_source_publications(source_key,scope_key,snapshot_id,last_checked_at) VALUES($1,$2,$3,$4)
        ON CONFLICT(source_key,scope_key) DO UPDATE SET snapshot_id=EXCLUDED.snapshot_id,last_checked_at=EXCLUDED.last_checked_at`,
        [p.source.key,p.scope.key,snapshotId,p.retrievedAt]);
      await rebuildStationHeads(client,options.policy);
      await client.query("UPDATE station_source_snapshots SET status='published' WHERE id=$1",[snapshotId]);
      await client.query("UPDATE station_import_runs SET status='published',snapshot_id=$2,finished_at=now() WHERE id=$1",[runId,snapshotId]);
      await client.query('COMMIT');
      return {snapshotId,unchanged:false,published:true,report};
    }catch(error){
      await client.query('ROLLBACK');
      await client.query("UPDATE station_import_runs SET status='failed',finished_at=now(),error_code='STATION_IMPORT_REJECTED' WHERE id=$1",[runId]);
      throw error;
    }finally{client.release();}
  }
}
