import { createHash } from 'node:crypto';
import { openEvDatasetSchema } from './open-ev.schema';
import type { OpenEvVehicle } from './open-ev.schema';

export const OPEN_EV_SOURCE = {
  key: 'open-ev-data',
  name: 'OpenEV Data',
  homepageUrl: 'https://github.com/open-ev-data/open-ev-data-dataset',
  license: 'CDLA-Permissive-2.0',
} as const;

export type VehicleSnapshot = {
  source: typeof OPEN_EV_SOURCE;
  version: string;
  schemaVersion: string;
  sourceUrl: string;
  checksumSha256: string;
  generatedAt: string;
  fetchedAt: string;
  vehicles: OpenEvVehicle[];
};

export function stableId(...parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export function parseSnapshot(
  bytes: Uint8Array,
  version: string,
  sourceUrl: string,
  expectedDigest?: string,
): VehicleSnapshot {
  const checksumSha256 = createHash('sha256').update(bytes).digest('hex');
  if (expectedDigest && expectedDigest !== 'sha256:' + checksumSha256)
    throw new Error('Vehicle dataset checksum mismatch');
  const data = openEvDatasetSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')));
  return {
    source: OPEN_EV_SOURCE, version, sourceUrl, checksumSha256,
    schemaVersion: data.schema_version,
    generatedAt: data.generated_at,
    fetchedAt: new Date().toISOString(),
    vehicles: data.vehicles,
  };
}

// Upstream does not identify a test cycle for this field. Do not relabel it as WLTP.
export function consumptionKwhPer100Km(vehicle: OpenEvVehicle): number | null {
  const whPerKm = vehicle.efficiency?.energy_consumption_wh_per_km;
  return whPerKm === undefined ? null : whPerKm / 10;
}
