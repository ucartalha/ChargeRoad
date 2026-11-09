import { Injectable } from '@nestjs/common';
import type { VehicleCatalogueEntry, VehicleCatalogueDetail, VehicleCataloguePage } from '@chargeroad/shared' with { 'resolution-mode': 'import' };
import { DatabaseService } from '../database/database.service';

export type VehicleFilters = {
  q?: string;
  make?: string;
  model?: string;
  year?: number;
  market?: string;
  limit: number;
  offset: number;
};

const fields = `
  v.id, ma.name AS make, ma.slug AS "makeSlug", mo.name AS model, mo.slug AS "modelSlug",
  v.model_year AS "modelYear", v.trim_name AS trim, v.trim_slug AS "trimSlug",
  v.variant_name AS variant, v.variant_slug AS "variantSlug",
  v.vehicle_type AS "vehicleType", v.markets,
  v.usable_battery_kwh AS "usableBatteryKwh", v.gross_battery_kwh AS "grossBatteryKwh",
  v.max_ac_charge_kw AS "maxAcChargeKw", v.max_dc_charge_kw AS "maxDcChargeKw",
  cp.consumption_kwh_per_100km AS "consumptionKwhPer100Km",
  cp.basis AS "consumptionBasis",
  ARRAY(SELECT DISTINCT p.connector FROM vehicle_charge_ports p WHERE p.vehicle_id=v.id ORDER BY p.connector) AS "connectorTypes",
  v.is_active AS "isActive",
  jsonb_build_object(
    'key', ds.key, 'name', ds.name, 'license', ds.license, 'homepageUrl', ds.homepage_url,
    'vehicleId', v.source_vehicle_id, 'version', im.source_version, 'schemaVersion', im.schema_version,
    'generatedAt', im.source_generated_at, 'fetchedAt', im.fetched_at,
    'sourceUpdatedAt', v.source_updated_at
  ) AS source`;
const joins = `FROM vehicle_variants v
  JOIN vehicle_models mo ON mo.id=v.model_id
  JOIN vehicle_makes ma ON ma.id=mo.make_id
  JOIN vehicle_data_sources ds ON ds.key=v.source_key
  JOIN vehicle_imports im ON im.id=v.last_import_id
  LEFT JOIN vehicle_consumption_profiles cp ON cp.vehicle_id=v.id`;
const ordering = '"make", "model", "modelYear", "id"';

@Injectable()
export class VehiclesRepository {
  constructor(private readonly database: DatabaseService) {}

  async list(filters: VehicleFilters): Promise<VehicleCataloguePage> {
    const values: unknown[] = [];
    const conditions = ['v.is_active'];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      conditions.push(sql.replace('?', '$' + values.length));
    };
    if (filters.make) add('ma.slug=?', filters.make);
    if (filters.model) add('mo.slug=?', filters.model);
    if (filters.year) add('v.model_year=?', filters.year);
    if (filters.market) add('?=ANY(v.markets)', filters.market);
    if (filters.q) {
      const escaped = filters.q.replace(/[\\%_]/g, '\\$&');
      add("concat_ws(' ',ma.name,mo.name,v.trim_name,v.variant_name) ILIKE ?", '%' + escaped + '%');
    }
    values.push(filters.limit, filters.offset);
    const result = await this.database.pool.query<{ total: number; items: VehicleCatalogueEntry[] }>(
      `WITH filtered AS (SELECT ${fields} ${joins} WHERE ${conditions.join(' AND ')})
       SELECT (SELECT count(*)::integer FROM filtered) AS total,
       COALESCE((SELECT jsonb_agg(page ORDER BY ${ordering}) FROM
         (SELECT * FROM filtered ORDER BY ${ordering} LIMIT $${values.length - 1} OFFSET $${values.length}) page), '[]'::jsonb) AS items`,
      values,
    );
    return { ...result.rows[0], limit: filters.limit, offset: filters.offset };
  }

  async makes() {
    const result = await this.database.pool.query<{ slug: string; name: string; sourceKey: string }>(
      `SELECT DISTINCT ma.slug,ma.name,ma.source_key AS "sourceKey"
       FROM vehicle_makes ma JOIN vehicle_models mo ON mo.make_id=ma.id
       JOIN vehicle_variants v ON v.model_id=mo.id WHERE v.is_active ORDER BY ma.name,ma.slug,ma.source_key`,
    );
    return result.rows;
  }

  async models(make: string) {
    const result = await this.database.pool.query<{ slug: string; name: string; sourceKey: string }>(
      `SELECT DISTINCT mo.slug,mo.name,ma.source_key AS "sourceKey" FROM vehicle_models mo
       JOIN vehicle_makes ma ON ma.id=mo.make_id JOIN vehicle_variants v ON v.model_id=mo.id
       WHERE ma.slug=$1 AND v.is_active ORDER BY mo.name,mo.slug,ma.source_key`, [make],
    );
    return result.rows;
  }

  async findById(id: string): Promise<VehicleCatalogueDetail | null> {
    const result = await this.database.pool.query<VehicleCatalogueDetail>(
      `SELECT ${fields},
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'kind',p.kind,'connector',p.connector) ORDER BY p.ordinal)
         FROM vehicle_charge_ports p WHERE p.vehicle_id=v.id),'[]'::jsonb) AS "chargePorts",
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'kind',r.kind,'profile',r.profile,'rangeKm',r.range_km,'conditions',r.conditions) ORDER BY r.ordinal)
         FROM vehicle_range_ratings r WHERE r.vehicle_id=v.id),'[]'::jsonb) AS "rangeRatings",
       (SELECT jsonb_build_object('type',c.curve_type,'conditions',c.conditions,'sourceUrl',c.source_url,
         'points',(SELECT jsonb_agg(jsonb_build_object(
           'socPercent',p.soc_percent,'powerKw',p.power_kw,'currentA',p.current_a,'voltageV',p.voltage_v) ORDER BY p.soc_percent)
           FROM vehicle_charge_curve_points p WHERE p.vehicle_id=c.vehicle_id))
         FROM vehicle_charge_curves c WHERE c.vehicle_id=v.id) AS "dcChargeCurve"
       ${joins} WHERE v.id=$1`, [id],
    );
    return result.rows[0] ?? null;
  }
}
