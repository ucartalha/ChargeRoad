import type { VehicleEnergyProfile } from '@chargeroad/shared' with { 'resolution-mode': 'import' };
import type { ProviderResponse } from './provider-response';
import type { DataQualityPolicy } from '@chargeroad/shared';

export abstract class VehicleEnergyProvider {
  // A catalogue record alone is not an energy profile. Do not invent missing references/curves.
  async resolveId(vehicleVariantId:string, signal:AbortSignal):Promise<string> {
    signal.throwIfAborted(); return vehicleVariantId;
  }
  abstract profile(vehicleVariantId: string, signal: AbortSignal, policy?:DataQualityPolicy): Promise<ProviderResponse<VehicleEnergyProfile | null>>;
}
