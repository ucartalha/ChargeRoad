import type { VehicleEnergyProfile } from '@chargeroad/shared' with { 'resolution-mode': 'import' };
import type { ProviderResponse } from './provider-response';

export abstract class VehicleEnergyProvider {
  // A catalogue record alone is not an energy profile. Do not invent missing references/curves.
  abstract profile(vehicleVariantId: string, signal: AbortSignal): Promise<ProviderResponse<VehicleEnergyProfile | null>>;
}
