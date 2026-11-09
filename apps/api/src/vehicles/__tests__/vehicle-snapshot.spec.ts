import { createHash } from 'node:crypto';
import { parseSnapshot, consumptionKwhPer100Km, stableId } from '../import/vehicle-snapshot';
import { fixtureBytes, fixtureDataset, fixtureVehicle } from './fixtures';

const parse = (data: unknown) => parseSnapshot(fixtureBytes(data), 'v1.0.0', 'https://example.test/data.json');

describe('Vehicle dataset validation', () => {
  it('preserves missing net capacity and consumption instead of inventing them from range', () => {
    const raw = fixtureVehicle();
    const vehicle = { ...raw, battery: { pack_capacity_kwh_gross: 64 } };
    const imported = parse(fixtureDataset([vehicle])).vehicles[0];
    expect(imported.battery.pack_capacity_kwh_net).toBeUndefined();
    expect(consumptionKwhPer100Km(imported)).toBeNull();
    expect(imported.range.rated[0].range_km).toBe(400);
  });

  it('converts Wh/km to kWh/100 km without assigning a test cycle', () => {
    const vehicle = { ...fixtureVehicle(), efficiency: { energy_consumption_wh_per_km: 180 } };
    expect(consumptionKwhPer100Km(parse(fixtureDataset([vehicle])).vehicles[0])).toBe(18);
  });

  it('keeps source metadata and unknown source fields for future reprocessing', () => {
    const vehicle = { ...fixtureVehicle(), future_field: { value: 7 } };
    expect(parse(fixtureDataset([vehicle])).vehicles[0].future_field).toEqual({ value: 7 });
  });

  it('rejects duplicate source IDs, mismatched counts, unsupported schemas, and empty data', () => {
    expect(() => parse(fixtureDataset([fixtureVehicle(), fixtureVehicle()]))).toThrow();
    expect(() => parse({ ...fixtureDataset(), vehicle_count: 2 })).toThrow();
    expect(() => parse({ ...fixtureDataset(), schema_version: '2.0.0' })).toThrow();
    expect(() => parse(fixtureDataset([]))).toThrow();
  });

  it('rejects physically invalid capacities and malformed charge curves', () => {
    expect(() => parse(fixtureDataset([{ ...fixtureVehicle(),
      battery: { pack_capacity_kwh_net: 70, pack_capacity_kwh_gross: 64 } }]))).toThrow();
    expect(() => parse(fixtureDataset([{ ...fixtureVehicle(),
      charging: { dc_charge_curve: { curve_type: 'power_by_soc', points: [{ soc_percent: 50 }] } } }]))).toThrow();
    expect(() => parse(fixtureDataset([{ ...fixtureVehicle(),
      charging: { dc_charge_curve: { curve_type: 'power_by_soc',
        points: [{ soc_percent: 50, power_kw: 100 }, { soc_percent: 50, power_kw: 80 }] } } }]))).toThrow();
  });

  it('verifies source bytes against the release digest', () => {
    const bytes = fixtureBytes(fixtureDataset());
    const digest = createHash('sha256').update(bytes).digest('hex');
    expect(parseSnapshot(bytes, 'v1.0.0', 'https://example.test', 'sha256:' + digest).checksumSha256).toBe(digest);
    expect(() => parseSnapshot(bytes, 'v1.0.0', 'https://example.test', 'sha256:' + '0'.repeat(64))).toThrow('checksum');
  });

  it('keeps IDs stable and distinguishes source variants', () => {
    const first = fixtureVehicle();
    const second = { ...fixtureVehicle('test:ev:2025:long_range'), variant: { slug: 'long_range', name: 'Long Range' } };
    const snapshot = parse(fixtureDataset([first, second]));
    const ids = snapshot.vehicles.map((vehicle) => stableId(snapshot.source.key, vehicle.unique_code));
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe(stableId(snapshot.source.key, first.unique_code));
  });
});
