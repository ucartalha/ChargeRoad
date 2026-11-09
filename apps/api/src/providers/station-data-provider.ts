import type { ChargingStation, RoadRoute } from '@chargeroad/shared' with { 'resolution-mode': 'import' };
import type { ProviderResponse } from './provider-response';

export abstract class StationDataProvider {
  // Geographic candidates only; actual road access/reachability remains our planner's responsibility.
  abstract findAlongRoutes(routes: RoadRoute[], corridorMeters: number, signal: AbortSignal): Promise<ProviderResponse<ChargingStation[]>>;
}
