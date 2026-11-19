import type { RoadRoutingRequest, RoadRoutingResult } from '@chargeroad/shared' with { 'resolution-mode': 'import' };
import type { ProviderResponse } from './provider-response';

// Road providers supply road alternatives only. Our planner chooses charging stops.
export abstract class RoutingProvider {
  // null means the provider successfully confirmed no road route; transport errors must reject.
  abstract routes(request: RoadRoutingRequest, signal: AbortSignal): Promise<ProviderResponse<RoadRoutingResult | null>>;
  /** Optional: totals of the first route only (same distance/time as routes()), for callers that need no geometry. */
  measure?(request: RoadRoutingRequest, signal: AbortSignal): Promise<{ distanceMeters: number; drivingDurationSeconds: number } | null>;
}
