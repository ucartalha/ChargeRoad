import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { getEnvironment } from '../config/environment';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: getEnvironment().DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 30_000,
    });
    this.pool.on('error', () => new Logger(DatabaseService.name).error('Idle database connection failed'));
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
