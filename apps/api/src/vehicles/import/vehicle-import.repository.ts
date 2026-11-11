import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { consumptionKwhPer100Km, stableId } from './vehicle-snapshot';
import type { VehicleSnapshot } from './vehicle-snapshot';
import type { OpenEvVehicle } from './open-ev.schema';

export class VehicleImportRepository {
  constructor(private readonly database: DatabaseService) {}

  async save(snapshot: VehicleSnapshot) {
    const pool = this.database.pool;
    const source = snapshot.source;
    const importId = randomUUID();
    await pool.query(
      'INSERT INTO vehicle_data_sources (key, name, homepage_url, license) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING',
      [source.key, source.name, source.homepageUrl, source.license],
    );
    await pool.query(
      `INSERT INTO vehicle_imports
       (id, source_key, source_version, schema_version, source_url, checksum_sha256, source_generated_at, fetched_at, status, record_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'running',$9)`,
      [importId, source.key, snapshot.version, snapshot.schemaVersion, snapshot.sourceUrl,
        snapshot.checksumSha256, snapshot.generatedAt, snapshot.fetchedAt, snapshot.vehicles.length],
    );

    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const lock = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtext('chargeroad:vehicles:' || $1)) AS acquired", [source.key],
      );
      if (!lock.rows[0].acquired) throw new Error('Another vehicle import is running');
      const latest = await client.query<{ generated_at: Date | null }>(
        "SELECT max(source_generated_at) AS generated_at FROM vehicle_imports WHERE source_key=$1 AND status='succeeded'",
        [source.key],
      );
      if (latest.rows[0].generated_at && new Date(snapshot.generatedAt) < latest.rows[0].generated_at)
        throw new Error('Refusing an older vehicle snapshot');

      for (const vehicle of snapshot.vehicles) await this.saveVehicle(client, snapshot, vehicle, importId);
      const deactivated = await client.query(
        'UPDATE vehicle_variants SET is_active=false, updated_at=now() WHERE source_key=$1 AND last_import_id<>$2 AND is_active',
        [source.key, importId],
      );
      await client.query('SELECT sync_open_ev_catalogue()');
      await client.query("UPDATE vehicle_imports SET status='succeeded', finished_at=now() WHERE id=$1", [importId]);
      await client.query('COMMIT');
      return { importId, source: source.key, version: snapshot.version,
        records: snapshot.vehicles.length, deactivated: deactivated.rowCount ?? 0, checksumSha256: snapshot.checksumSha256 };
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      await pool.query(
        "UPDATE vehicle_imports SET status='failed', finished_at=now(), error_message=$2 WHERE id=$1",
        [importId, 'Import failed; previous catalogue preserved'],
      );
      throw error;
    } finally {
      client?.release();
    }
  }

  private async saveVehicle(client: PoolClient, snapshot: VehicleSnapshot, vehicle: OpenEvVehicle, importId: string) {
    const sourceKey = snapshot.source.key;
    const makeId = stableId(sourceKey, vehicle.make.slug);
    const modelId = stableId(sourceKey, vehicle.make.slug, vehicle.model.slug);
    const id = stableId(sourceKey, vehicle.unique_code);
    await client.query(
      'INSERT INTO vehicle_makes (id, source_key, slug, name) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name',
      [makeId, sourceKey, vehicle.make.slug, vehicle.make.name],
    );
    await client.query(
      'INSERT INTO vehicle_models (id, make_id, slug, name) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name',
      [modelId, makeId, vehicle.model.slug, vehicle.model.name],
    );
    await client.query(
      `INSERT INTO vehicle_variants
       (id,source_key,source_vehicle_id,model_id,model_year,trim_slug,trim_name,variant_slug,variant_name,
        vehicle_type,markets,usable_battery_kwh,gross_battery_kwh,max_ac_charge_kw,max_dc_charge_kw,source_updated_at,raw_data,last_import_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18)
       ON CONFLICT (id) DO UPDATE SET
        model_id=EXCLUDED.model_id,model_year=EXCLUDED.model_year,trim_slug=EXCLUDED.trim_slug,trim_name=EXCLUDED.trim_name,
        variant_slug=EXCLUDED.variant_slug,variant_name=EXCLUDED.variant_name,vehicle_type=EXCLUDED.vehicle_type,
        markets=EXCLUDED.markets,usable_battery_kwh=EXCLUDED.usable_battery_kwh,gross_battery_kwh=EXCLUDED.gross_battery_kwh,
        max_ac_charge_kw=EXCLUDED.max_ac_charge_kw,max_dc_charge_kw=EXCLUDED.max_dc_charge_kw,
        source_updated_at=EXCLUDED.source_updated_at,raw_data=EXCLUDED.raw_data,last_import_id=EXCLUDED.last_import_id,
        is_active=true,updated_at=CASE WHEN vehicle_variants.raw_data IS DISTINCT FROM EXCLUDED.raw_data
          OR NOT vehicle_variants.is_active THEN now() ELSE vehicle_variants.updated_at END`,
      [id,sourceKey,vehicle.unique_code,modelId,vehicle.year,vehicle.trim.slug,vehicle.trim.name,
        vehicle.variant?.slug ?? null,vehicle.variant?.name ?? null,vehicle.vehicle_type,vehicle.markets ?? [],
        vehicle.battery.pack_capacity_kwh_net ?? null,vehicle.battery.pack_capacity_kwh_gross ?? null,
        vehicle.charging.ac?.max_power_kw ?? null,vehicle.charging.dc?.max_power_kw ?? null,
        vehicle.metadata?.updated_at ?? null,JSON.stringify(vehicle),importId],
    );

    // Child rows belong to this source record. Replace them atomically to remove obsolete values.
    for (const table of ['vehicle_charge_ports', 'vehicle_consumption_profiles', 'vehicle_range_ratings',
      'vehicle_charge_curve_points', 'vehicle_charge_curves']) {
      await client.query('DELETE FROM ' + table + ' WHERE vehicle_id=$1', [id]);
    }
    for (const [ordinal, port] of vehicle.charge_ports.entries()) {
      await client.query(
        'INSERT INTO vehicle_charge_ports (vehicle_id,ordinal,kind,connector) VALUES ($1,$2,$3,$4)',
        [id,ordinal,port.kind,port.connector],
      );
    }
    const consumption = consumptionKwhPer100Km(vehicle);
    if (consumption !== null) {
      await client.query(
        "INSERT INTO vehicle_consumption_profiles (vehicle_id,consumption_kwh_per_100km,basis,notes) VALUES ($1,$2,'unspecified',$3)",
        [id,consumption,vehicle.efficiency?.notes ?? null],
      );
    }
    const ratings = [
      ...vehicle.range.rated.map((item) => ({ kind: 'rated', profile: item.cycle, range: item.range_km, conditions: null })),
      ...(vehicle.range.real_world ?? []).map((item) => ({ kind: 'real_world', profile: item.profile,
        range: item.range_km, conditions: item.conditions ?? null })),
    ];
    for (const [ordinal, rating] of ratings.entries()) {
      await client.query(
        'INSERT INTO vehicle_range_ratings (vehicle_id,ordinal,kind,profile,range_km,conditions) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',
        [id,ordinal,rating.kind,rating.profile,rating.range,JSON.stringify(rating.conditions)],
      );
    }
    const curve = vehicle.charging.dc_charge_curve;
    if (curve) {
      await client.query(
        'INSERT INTO vehicle_charge_curves (vehicle_id,curve_type,conditions,source_url) VALUES ($1,$2,$3::jsonb,$4)',
        [id,curve.curve_type,JSON.stringify(curve.conditions ?? null),curve.source_url ?? null],
      );
      for (const point of curve.points) {
        await client.query(
          'INSERT INTO vehicle_charge_curve_points (vehicle_id,soc_percent,power_kw,current_a,voltage_v) VALUES ($1,$2,$3,$4,$5)',
          [id,point.soc_percent,point.power_kw ?? null,point.current_a ?? null,point.voltage_v ?? null],
        );
      }
    }
  }
}
