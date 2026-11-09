import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { AppModule } from '../../app.module';
import { DatabaseService } from '../../database/database.service';
import { migrate } from '../../database/migrate';
import { VehicleImportRepository } from '../import/vehicle-import.repository';
import { parseSnapshot, stableId, OPEN_EV_SOURCE } from '../import/vehicle-snapshot';
import { VehiclesRepository } from '../vehicles.repository';
import { fixtureBytes, fixtureDataset, fixtureVehicle } from './fixtures';

// Opt-in and isolated: no migrations or fixture writes to the existing catalogue schema.
const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration('Vehicle catalogue with PostgreSQL and HTTP', () => {
  let admin: Pool;
  let pool: Pool;
  let importer: VehicleImportRepository;
  let repository: VehiclesRepository;
  let app: INestApplication;
  let baseUrl: string;
  const schema = 'vehicle_test_' + randomBytes(8).toString('hex');
  const snapshot = (vehicles: unknown[] = [fixtureVehicle()], time = '2026-01-01T00:00:00Z') =>
    parseSnapshot(fixtureBytes(fixtureDataset(vehicles, time)), 'v1.0.0', 'https://example.test/data.json');

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: '-c search_path=' + schema, max: 5 });
    await migrate(pool);
    const database = { pool, onModuleDestroy: async () => {} } as DatabaseService;
    importer = new VehicleImportRepository(database);
    repository = new VehiclesRepository(database);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService).useValue(database).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (pool) await pool.end();
    if (admin) {
      if (!/^vehicle_test_[a-f0-9]{16}$/.test(schema)) throw new Error('Unsafe test schema');
      await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
      await admin.end();
    }
  });

  it('applies migrations once and detects ledger drift', async () => {
    expect(await migrate(pool)).toEqual([]);
    const ledger = await pool.query<{ name: string; checksum: string }>('SELECT name,checksum FROM app_migrations');
    await pool.query("UPDATE app_migrations SET checksum='changed'");
    try {
      await expect(migrate(pool)).rejects.toThrow('migration changed');
    } finally {
      for (const row of ledger.rows) await pool.query('UPDATE app_migrations SET checksum=$1 WHERE name=$2', [row.checksum,row.name]);
    }
  });

  it('imports twice without duplicates and preserves IDs', async () => {
    await importer.save(snapshot());
    const first = await repository.list({ limit: 25, offset: 0 });
    await importer.save(snapshot());
    const second = await repository.list({ limit: 25, offset: 0 });
    expect(second.total).toBe(1);
    expect(second.items[0].id).toBe(first.items[0].id);
    expect(second.items[0].consumptionKwhPer100Km).toBeNull();
    expect(second.items[0].source.version).toBe('v1.0.0');
    expect((await pool.query("SELECT count(*)::int AS total FROM vehicle_imports WHERE status='succeeded'")).rows[0].total).toBe(2);
  });

  it('updates specifications and replaces obsolete child values', async () => {
    const changed = { ...fixtureVehicle(), battery: { pack_capacity_kwh_net: 61, pack_capacity_kwh_gross: 64 },
      charge_ports: [{ kind: 'ac_only', connector: 'type2' }],
      efficiency: { energy_consumption_wh_per_km: 180 },
      charging: { dc_charge_curve: { curve_type: 'power_by_soc', points: [{ soc_percent: 10, power_kw: 120 }] } } };
    await importer.save(snapshot([changed]));
    const id = stableId(OPEN_EV_SOURCE.key, changed.unique_code);
    const detail = await repository.findById(id);
    expect(detail?.usableBatteryKwh).toBe(61);
    expect(detail?.connectorTypes).toEqual(['type2']);
    expect(detail?.consumptionKwhPer100Km).toBe(18);
    expect(detail?.dcChargeCurve?.points[0].powerKw).toBe(120);
    await importer.save(snapshot());
    const restored = await repository.findById(id);
    expect(restored?.consumptionKwhPer100Km).toBeNull();
    expect(restored?.dcChargeCurve).toBeNull();
    expect(restored?.connectorTypes).toEqual(['ccs2']);
  });

  it('retains distinct variants and deactivates missing records without deleting IDs', async () => {
    const extra = { ...fixtureVehicle('test:ev:2025:long_range'), variant: { slug: 'long_range', name: 'Long Range' } };
    await importer.save(snapshot([fixtureVehicle(), extra]));
    expect((await repository.list({ limit: 25, offset: 0 })).total).toBe(2);
    const result = await importer.save(snapshot());
    expect(result.deactivated).toBe(1);
    expect((await repository.findById(stableId(OPEN_EV_SOURCE.key, extra.unique_code)))?.isActive).toBe(false);
    expect((await repository.list({ limit: 25, offset: 0 })).total).toBe(1);
  });

  it('rolls back the complete import on a database failure', async () => {
    const data = snapshot([fixtureVehicle(), fixtureVehicle('test:bad')]);
    // Bypass source validation to simulate a persistence-time failure on a later row.
    data.vehicles[0].battery.pack_capacity_kwh_net = 59;
    data.vehicles[1].battery.pack_capacity_kwh_net = -1;
    await expect(importer.save(data)).rejects.toThrow();
    const entry = (await repository.list({ limit: 25, offset: 0 })).items[0];
    expect(entry.usableBatteryKwh).toBe(60);
    expect((await repository.list({ limit: 25, offset: 0 })).total).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS total FROM vehicle_imports WHERE status='failed'")).rows[0].total).toBe(1);
  });

  it('rejects stale snapshots and concurrent writers', async () => {
    await expect(importer.save(snapshot([fixtureVehicle()], '2025-01-01T00:00:00Z'))).rejects.toThrow('older');
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query("SELECT pg_advisory_xact_lock(hashtext('chargeroad:vehicles:open-ev-data'))");
      await expect(importer.save(snapshot())).rejects.toThrow('Another');
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
  });

  it('serves DB-only catalogue endpoints with filters, pagination and validation', async () => {
    const externalFetch = jest.spyOn(global, 'fetch');
    const get = (path: string) => fetch(baseUrl + '/v1' + path);
    const response = await get('/vehicles?make=test_make&model=test_ev&year=2025&market=TR&limit=1');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(1);
    expect(body.items[0].source.key).toBe(OPEN_EV_SOURCE.key);
    const emptyPage = await (await get('/vehicles?offset=100')).json();
    expect(emptyPage.items).toEqual([]);
    expect(emptyPage.total).toBe(1);
    expect((await (await get('/vehicles?q=%25')).json()).total).toBe(0);
    expect((await (await get("/vehicles?q=" + encodeURIComponent("' OR 1=1 --"))).json()).total).toBe(0);
    expect((await get('/vehicles?limit=101')).status).toBe(400);
    expect((await get('/vehicles?limit=0')).status).toBe(400);
    expect((await get('/vehicles?year=abc')).status).toBe(400);
    expect((await get('/vehicles/models')).status).toBe(400);
    expect((await get('/vehicles/not-an-id')).status).toBe(404);
    expect((await get('/vehicles/' + '0'.repeat(64))).status).toBe(404);
    expect((await (await get('/vehicles/makes')).json())[0].slug).toBe('test_make');
    expect((await (await get('/vehicles/models?make=test_make')).json())[0].slug).toBe('test_ev');
    const detail = await (await get('/vehicles/' + body.items[0].id)).json();
    expect(detail.rangeRatings[0].rangeKm).toBe(400);
    expect(externalFetch.mock.calls.every(([url]) => String(url).startsWith(baseUrl))).toBe(true);
    externalFetch.mockRestore();
  });
});
