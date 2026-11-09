import type { ChargingStation, Coordinate } from '@chargeroad/shared' with { 'resolution-mode': 'import' };

export interface StationDataProvider {
  findNearby(location: Coordinate, radiusMeters: number): Promise<ChargingStation[]>;
}