// Synthetic values for tests; never imported into the real catalogue.
export function fixtureVehicle(code = 'test:ev:2025:standard') {
  return {
    schema_version: '1.0.0',
    unique_code: code,
    make: { slug: 'test_make', name: 'Test Make' },
    model: { slug: 'test_ev', name: 'Test EV' },
    year: 2025,
    trim: { slug: 'standard', name: 'Standard' },
    variant: { slug: 'rwd', name: 'RWD' },
    vehicle_type: 'passenger_car',
    markets: ['TR'],
    battery: { pack_capacity_kwh_net: 60, pack_capacity_kwh_gross: 64 },
    charge_ports: [{ kind: 'combo', connector: 'ccs2' }],
    charging: { ac: { max_power_kw: 11 }, dc: { max_power_kw: 150 } },
    range: { rated: [{ cycle: 'wltp', range_km: 400 }] },
    sources: [{ type: 'testing_org', title: 'Synthetic fixture', url: 'https://example.test', accessed_at: '2026-01-01T00:00:00Z' }],
  };
}

export function fixtureDataset(vehicles: unknown[] = [fixtureVehicle()], generatedAt = '2026-01-01T00:00:00Z') {
  return {
    schema_version: '1.0.0',
    generated_at: generatedAt,
    vehicle_count: vehicles.length,
    vehicles,
    metadata: { test_fixture: true },
  };
}

export function fixtureBytes(data: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(data));
}
