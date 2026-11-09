import type { RoadRoutingRequest, RoadRoutingResult } from '@chargeroad/shared' with { 'resolution-mode': 'import' };

// Road providers supply road alternatives only. Our planner chooses charging stops.
export interface RoutingProvider {
  routes(request: RoadRoutingRequest): Promise<RoadRoutingResult>;
}
