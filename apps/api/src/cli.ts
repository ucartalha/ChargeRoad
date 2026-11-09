import 'reflect-metadata';
import { DatabaseService } from './database/database.service';
import { migrate } from './database/migrate';
import { getEnvironment } from './config/environment';
import { OpenEvProvider } from './vehicles/import/open-ev.provider';
import { VehicleImportRepository } from './vehicles/import/vehicle-import.repository';
import { VehicleImportService } from './vehicles/import/vehicle-import.service';
import { PostgresRateLimitStore } from './security/postgres-rate-limit.store';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!['db:migrate', 'vehicles:import', 'security:cleanup'].includes(command))
    throw new Error('Usage: cli.ts db:migrate | vehicles:import [--version latest|vMAJOR.MINOR.PATCH] | security:cleanup');
  if (command !== 'vehicles:import' && args.length) throw new Error(command + ' does not accept arguments');
  if (args.length && (args.length !== 2 || args[0] !== '--version'))
    throw new Error('Usage: vehicles:import [--version latest|vMAJOR.MINOR.PATCH]');
  const database = new DatabaseService();
  try {
    if (command === 'db:migrate') {
      console.log(JSON.stringify({ applied: await migrate(database.pool) }, null, 2));
    } else if (command === 'security:cleanup') {
      console.log(JSON.stringify({ removed: await new PostgresRateLimitStore(database).purgeExpired() }, null, 2));
    } else {
      const service = new VehicleImportService(new OpenEvProvider(), new VehicleImportRepository(database));
      console.log(JSON.stringify(await service.refresh(args[1] ?? getEnvironment().VEHICLE_DATA_VERSION), null, 2));
    }
  } finally {
    await database.onModuleDestroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Command failed');
  process.exitCode = 1;
});
