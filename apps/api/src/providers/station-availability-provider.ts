import type { SourceReference,StationAvailability } from '@chargeroad/shared' with { 'resolution-mode':'import' };

// A future live feed has a separate port. Catalogue status 50 / IsLive never implements this.
export interface LiveStationObservation {
  canonicalEvseId:string;providerEvseId:string;reportedStatus:StationAvailability;
  observedAt:string|null;receivedAt:string;source:SourceReference;
}
export abstract class StationAvailabilityProvider {
  abstract readonly key:string;
  abstract getByEvseIds(ids:readonly {canonicalEvseId:string;providerEvseId:string}[],signal:AbortSignal):
    Promise<{observations:LiveStationObservation[];missingEvseIds:string[]}>;
}
