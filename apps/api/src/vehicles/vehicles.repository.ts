import { Injectable } from '@nestjs/common';
import type { VehicleCatalogueEntry, VehicleCatalogueDetail, VehicleCataloguePage } from '@chargeroad/shared' with { 'resolution-mode': 'import' };
import { DatabaseService } from '../database/database.service';

export type VehicleFilters = { q?: string; make?: string; model?: string; year?: number; market?: string; limit: number; offset: number };
const summary = `detail - ARRAY['chargePorts','rangeRatings','dcChargeCurve']`;
const resolveEntity = `SELECT entity_id FROM catalogue_bindings WHERE legacy_id=$1
  UNION SELECT id AS entity_id FROM catalogue_entities WHERE id=CASE
    WHEN $1 ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN $1::uuid ELSE NULL END`;

@Injectable()
export class VehiclesRepository {
  constructor(private readonly database: DatabaseService) {}
  async list(filters: VehicleFilters): Promise<VehicleCataloguePage> {
    const values: unknown[] = [];
    const conditions = ['is_active'];
    const add = (sql: string, value: unknown) => { values.push(value); conditions.push(sql.replace('?', '$'+values.length)); };
    if (filters.make) add('make_slug=?',filters.make);
    if (filters.model) add('model_slug=?',filters.model);
    if (filters.year) add('model_year=?',filters.year);
    if (filters.market) add('?=ANY(markets)',filters.market);
    if (filters.q) add('search_text ILIKE ?', '%'+filters.q.replace(/[\\%_]/g,'\\$&')+'%');
    values.push(filters.limit,filters.offset);
    const result = await this.database.pool.query<{total:number;items:VehicleCatalogueEntry[]}>(
      `WITH filtered AS (SELECT *,${summary} AS item FROM catalogue_entries WHERE ${conditions.join(' AND ')})
       SELECT (SELECT count(*)::int FROM filtered) AS total,
       COALESCE((SELECT jsonb_agg(item ORDER BY make_slug,model_slug,model_year,entity_id) FROM
         (SELECT * FROM filtered ORDER BY make_slug,model_slug,model_year,entity_id LIMIT $${values.length-1} OFFSET $${values.length}) p),'[]'::jsonb) AS items`,values);
    return {...result.rows[0],limit:filters.limit,offset:filters.offset};
  }
  async makes() {
    return (await this.database.pool.query(
      `SELECT DISTINCT make_slug AS slug,detail->>'make' AS name,'chargeroad-catalogue' AS "sourceKey"
       FROM catalogue_entries WHERE is_active ORDER BY name,slug`)).rows;
  }
  async models(make:string) {
    return (await this.database.pool.query(
      `SELECT DISTINCT model_slug AS slug,detail->>'model' AS name,'chargeroad-catalogue' AS "sourceKey"
       FROM catalogue_entries WHERE is_active AND make_slug=$1 ORDER BY name,slug`,[make])).rows;
  }
  async findById(id:string):Promise<VehicleCatalogueDetail|null> {
    const result = await this.database.pool.query<{detail:VehicleCatalogueDetail}>(
      `SELECT detail FROM catalogue_entries WHERE entity_id IN (${resolveEntity})`,[id]);
    return result.rows[0]?.detail ?? null;
  }
  async references(id:string,options:{limit:number;offset:number}={limit:100,offset:0}) {
    const vehicle = await this.findById(id);
    if (!vehicle) return null;
    const result=await this.database.pool.query(
      `WITH records AS (SELECT r.reference_id AS id,r.kind,r.quality,r.payload,b.source_key AS "sourceKey",b.version,
        b.checksum_sha256 AS "snapshotSha256",b.generated_at AS "generatedAt"
       FROM vehicle_reference_revisions r JOIN vehicle_knowledge_batches b ON b.id=r.batch_id
       JOIN vehicle_knowledge_publications pub ON pub.source_key=b.source_key AND pub.batch_id=b.id AND pub.external_id=r.external_id
       WHERE r.entity_id=$1)
       SELECT (SELECT count(*)::int FROM records) AS total,
       COALESCE((SELECT jsonb_agg(p ORDER BY kind,id,"sourceKey") FROM
         (SELECT * FROM records ORDER BY kind,id,"sourceKey" LIMIT $2 OFFSET $3) p),'[]'::jsonb) AS items`,
      [vehicle.id,options.limit,options.offset]);
    return {...result.rows[0],...options};
  }
}
