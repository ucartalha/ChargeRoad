import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getEnvironment } from './config/environment';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const proxies = getEnvironment().TRUSTED_PROXY_CIDRS.split(',').map((value) => value.trim()).filter(Boolean);
  app.getHttpAdapter().getInstance().set('trust proxy', proxies.length ? proxies : false);
  app.setGlobalPrefix('v1');
  app.enableCors();
  app.enableShutdownHooks();
  await app.listen(Number(process.env.API_PORT) || 3000, '0.0.0.0');
}

void bootstrap();
