import { DatabaseService } from '../../database/database.service';
import { EpdkCatalogueSource } from './epdk-source';
import { OcmCatalogueSource } from './ocm-source';
import { StationSourceRegistry } from './catalogue-source';
import { loadStationSourcePolicy } from './source-policy';
import { StationSourceService } from './source-service';

// Composition root only: adding an adapter does not change import, DB reads, or the EV planner.
export function createStationSourceService(database:DatabaseService){
  return new StationSourceService(database,new StationSourceRegistry([
    new EpdkCatalogueSource(),new OcmCatalogueSource(process.env.OPEN_CHARGE_MAP_API_KEY),
  ],loadStationSourcePolicy()));
}
