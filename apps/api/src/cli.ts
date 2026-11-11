import 'reflect-metadata';
import { DatabaseService } from './database/database.service';
import { migrate } from './database/migrate';
import { getEnvironment } from './config/environment';
import { OpenEvProvider } from './vehicles/import/open-ev.provider';
import { VehicleImportRepository } from './vehicles/import/vehicle-import.repository';
import { VehicleImportService } from './vehicles/import/vehicle-import.service';
import { PostgresRateLimitStore } from './security/postgres-rate-limit.store';
import { open } from 'node:fs/promises';
import { VehicleKnowledgeRepository } from './vehicles/knowledge/knowledge.repository';
import { stageKilowattSnapshot } from './vehicles/knowledge/kilowatt-staging';
import { KilowattDataProvider } from './vehicles/knowledge/kilowatt.provider';
import { EpdkStationService } from './stations/epdk.service';
import { StationImportRepository } from './stations/station-import.repository';
import { createStationSourceService } from './stations/sources/create-source-service';

async function readBounded(path:string,maxBytes=16*1024*1024){
  const file=await open(path,'r');
  try{if((await file.stat()).size>maxBytes)throw new Error('Input exceeds size limit');return await file.readFile();}
  finally{await file.close();}
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!['db:migrate','stations:sources','stations:sync','stations:rebuild','stations:publish','stations:sync-epdk','stations:import-epdk', 'vehicles:import', 'vehicles:publish','vehicles:stage-kilowatt','vehicles:sync-kilowatt', 'security:cleanup'].includes(command))
    throw new Error('Usage: cli.ts db:migrate | vehicles:import [--version VERSION] | vehicles:publish --file PATH | security:cleanup');
  if (!['stations:sync','stations:publish','stations:import-epdk','vehicles:import','vehicles:publish','vehicles:stage-kilowatt','vehicles:sync-kilowatt'].includes(command) && args.length) throw new Error(command + ' does not accept arguments');
  if(command==='stations:sync'&&(args.length!==2||args[0]!=='--provider'))throw new Error('Usage: stations:sync --provider KEY');
  if(command==='stations:publish' && (args.length!==4||args[0]!=='--file'||args[2]!=='--raw-file'))
    throw new Error('Usage: stations:publish --file NORMALIZED --raw-file SOURCE');
  if(command==='stations:import-epdk' && (!([2,4].includes(args.length))||args[0]!=='--file'||(args.length===4&&args[2]!=='--manifest')))
    throw new Error('Usage: stations:import-epdk --file PATH [--manifest PATH]');
  if(command==='vehicles:sync-kilowatt' && args.length && (args.length!==2 || args[0]!=='--version'))
    throw new Error('Usage: vehicles:sync-kilowatt [--version latest|COMMIT]');
  if(command==='vehicles:stage-kilowatt' && (args.length!==4 || args[0]!=='--file' || args[2]!=='--manifest'))
    throw new Error('Usage: vehicles:stage-kilowatt --file PATH --manifest PATH');
  if (command==='vehicles:publish' && (args.length!==2 || args[0]!=='--file')) throw new Error('Usage: vehicles:publish --file PATH');
  if (command==='vehicles:import' && args.length && (args.length !== 2 || args[0] !== '--version'))
    throw new Error('Usage: vehicles:import [--version latest|vMAJOR.MINOR.PATCH]');
  const database = new DatabaseService();
  try {
    if (command === 'db:migrate') {
      console.log(JSON.stringify({ applied: await migrate(database.pool) }, null, 2));
    } else if(command==='stations:sources'){
      const service=createStationSourceService(database);
      console.log(JSON.stringify({policyVersion:service.registry.policy.version,providers:service.registry.describe(),
        acquisitionPlan:service.registry.planMissingFields('TR',['station','connectorClaims','access.membershipRequired'])},null,2));
    } else if(command==='stations:sync'){
      console.log(JSON.stringify(await createStationSourceService(database).sync(args[1]),null,2));
    } else if(command==='stations:rebuild'){
      console.log(JSON.stringify(await createStationSourceService(database).rebuild(),null,2));
    } else if (command === 'security:cleanup') {
      console.log(JSON.stringify({ removed: await new PostgresRateLimitStore(database).purgeExpired() }, null, 2));
    } else if(command==='stations:publish'){
      const p=JSON.parse((await readBounded(args[1],64*1024*1024)).toString('utf8'));
      console.log(JSON.stringify(await new StationImportRepository(database).publish(p,await readBounded(args[3],64*1024*1024),
        {policy:createStationSourceService(database).registry.policy}),null,2));
    } else if(command==='stations:sync-epdk'){
      console.log(JSON.stringify(await new EpdkStationService(database).sync(),null,2));
    } else if(command==='stations:import-epdk'){
      const receipt=JSON.parse((await readBounded(args[3]??args[1]+'.manifest.json')).toString('utf8'));
      console.log(JSON.stringify(await new EpdkStationService(database).importSnapshot(await readBounded(args[1],64*1024*1024),receipt),null,2));
    } else if(command==='vehicles:sync-kilowatt') {
      const snapshot=await new KilowattDataProvider().fetchSnapshot(args[1]??'latest');
      console.log(JSON.stringify(await stageKilowattSnapshot(database,snapshot.bytes,snapshot.manifest),null,2));
    } else if(command==='vehicles:stage-kilowatt') {
      const bytes=await readBounded(args[1]),manifest=JSON.parse((await readBounded(args[3])).toString('utf8'));
      console.log(JSON.stringify(await stageKilowattSnapshot(database,bytes,manifest),null,2));
    } else if (command === 'vehicles:publish') {
      console.log(JSON.stringify(await new VehicleKnowledgeRepository(database).publish(await readBounded(args[1])),null,2));
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
