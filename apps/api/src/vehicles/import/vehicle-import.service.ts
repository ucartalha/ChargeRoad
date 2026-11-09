import type { VehicleDataProvider } from './open-ev.provider';
import { VehicleImportRepository } from './vehicle-import.repository';

// A future job can invoke this same service. No request handler imports data implicitly.
export class VehicleImportService {
  constructor(
    private readonly provider: VehicleDataProvider,
    private readonly repository: VehicleImportRepository,
  ) {}

  async refresh(version: string) {
    const snapshot = await this.provider.fetchSnapshot(version);
    return this.repository.save(snapshot);
  }
}
