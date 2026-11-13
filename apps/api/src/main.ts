import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getEnvironment } from './config/environment';
import type {NestExpressApplication} from '@nestjs/platform-express';
import {configureHttpApi} from './config/http-api';
import {PlanningJobsWorker} from './planning/http/planning-jobs.worker';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule,{bodyParser:false});
  const proxies = getEnvironment().TRUSTED_PROXY_CIDRS.split(',').map((value) => value.trim()).filter(Boolean);
  configureHttpApi(app,proxies);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.API_PORT) || 3000, '0.0.0.0');
  app.get(PlanningJobsWorker).start();
}

void bootstrap();
