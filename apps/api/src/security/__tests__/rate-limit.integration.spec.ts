import 'reflect-metadata';
import { createHash, randomBytes } from 'node:crypto';
import { Controller, Get } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { AppModule } from '../../app.module';
import { DatabaseService } from '../../database/database.service';
import { migrate } from '../../database/migrate';
import { PostgresRateLimitStore } from '../postgres-rate-limit.store';
import { RATE_LIMIT_OPTIONS } from '../rate-limit.config';
import type { RateLimitOptions } from '../rate-limit.config';
import { RateLimitPolicy } from '../rate-limit.guard';
import type { RateLimitCommand, RateLimitDecision } from '../rate-limit.store';

@Controller('rate-test')
class TestController {
  @Get('general') general() { return { ok: true }; }
  @Get('auth') @RateLimitPolicy('auth') auth() { return { ok: true }; }
}

const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration('Shared PostgreSQL rate limiting', () => {
  let admin: Pool;
  let pool: Pool;
  let store: PostgresRateLimitStore;
  const apps: INestApplication[] = [];
  const urls: string[] = [];
  const schema = 'rate_test_' + randomBytes(8).toString('hex');
  const options: RateLimitOptions = {
    secret: 'test-only-shared-secret-32-characters',
    timezone: 'Europe/Istanbul', strikeLimit: 3, maxPending: 32,
    policies: { general: { limit: 1, windowSeconds: 60 },
      catalogue: { limit: 1, windowSeconds: 60 }, auth: { limit: 1, windowSeconds: 60 },planning:{limit:1,windowSeconds:60} },
  };
  const command = (name = 'test', policy = 'catalogue:v1'): RateLimitCommand => ({
    ipKey: createHash('sha256').update(name).digest('hex'),
    policy, limit: 1, windowSeconds: 60, strikeLimit: 3, timezone: 'Europe/Istanbul',
  });
  const at = async (time: string, cmd = command()): Promise<RateLimitDecision> => {
    const result = await pool.query<RateLimitDecision>(
      'SELECT outcome,remaining,strikes,retry_after_seconds AS "retryAfterSeconds" FROM consume_api_rate_limit($1,$2,$3,$4,$5,$6,$7)',
      [cmd.ipKey,cmd.policy,cmd.limit,cmd.windowSeconds,cmd.strikeLimit,cmd.timezone,time],
    );
    return result.rows[0];
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: '-c search_path=' + schema, max: 6 });
    await migrate(pool);
    const database = { pool, onModuleDestroy: async () => {} } as DatabaseService;
    store = new PostgresRateLimitStore(database);
    for (let i = 0; i < 2; i++) {
      const module = await Test.createTestingModule({ imports: [AppModule], controllers: [TestController] })
        .overrideProvider(DatabaseService).useValue(database)
        .overrideProvider(RATE_LIMIT_OPTIONS).useValue(options).compile();
      const app = module.createNestApplication({ logger: false });
      app.setGlobalPrefix('v1');
      await app.listen(0, '127.0.0.1');
      apps.push(app);
      urls.push(await app.getUrl());
    }
  }, 30000);

  beforeEach(async () => { await pool.query('DELETE FROM api_rate_limit_days'); });
  afterAll(async () => {
    for (const app of apps) await app.close();
    if (pool) await pool.end();
    if (admin) {
      if (!/^rate_test_[a-f0-9]{16}$/.test(schema)) throw new Error('Unsafe test schema');
      await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
      await admin.end();
    }
  });

  it('counts a burst as one violation, then blocks on the third distinct window', async () => {
    expect((await at('2026-11-10T09:00:01+03:00')).outcome).toBe('allowed');
    expect(await at('2026-11-10T09:00:02+03:00')).toMatchObject({ outcome: 'limited', strikes: 1, retryAfterSeconds: 58 });
    for (let i = 0; i < 8; i++) expect((await at('2026-11-10T09:00:03+03:00')).strikes).toBe(1);
    expect((await at('2026-11-10T09:01:01+03:00')).outcome).toBe('allowed');
    expect((await at('2026-11-10T09:01:02+03:00')).strikes).toBe(2);
    await at('2026-11-10T09:02:01+03:00');
    expect(await at('2026-11-10T09:02:02+03:00')).toMatchObject({ outcome: 'blocked', strikes: 3 });
    expect((await at('2026-11-10T10:00:01+03:00')).outcome).toBe('blocked');
  });

  it('shares the daily block across policies and isolates different IPs', async () => {
    for (const policy of ['catalogue:v1', 'auth:v1', 'general:v1']) {
      await at('2026-11-10T09:00:01+03:00', command('one',policy));
      await at('2026-11-10T09:00:02+03:00', command('one',policy));
    }
    expect((await at('2026-11-10T09:00:03+03:00', command('one','new-policy'))).outcome).toBe('blocked');
    expect((await at('2026-11-10T09:00:03+03:00', command('two'))).outcome).toBe('allowed');
  });

  it('resets at Istanbul midnight, not at UTC midnight', async () => {
    for (const minute of ['57','58','59']) {
      await at('2026-11-09T20:' + minute + ':01Z');
      await at('2026-11-09T20:' + minute + ':02Z');
    }
    expect(await at('2026-11-09T20:59:59Z')).toMatchObject({ outcome: 'blocked', retryAfterSeconds: 1 });
    expect(await at('2026-11-09T21:00:00Z')).toMatchObject({ outcome: 'allowed', strikes: 0 });
  });

  it('is atomic under concurrent requests from independent store instances', async () => {
    const other = new PostgresRateLimitStore({ pool } as DatabaseService);
    // Use a whole-day window to avoid the test straddling a one-minute boundary.
    const cmd = { ...command(), limit: 5, windowSeconds: 86400 };
    const results = await Promise.all(Array.from({ length: 30 }, (_, index) =>
      (index % 2 ? store : other).consume(cmd)));
    expect(results.filter((result) => result.outcome === 'allowed')).toHaveLength(5);
    expect(results.filter((result) => result.outcome === 'limited')).toHaveLength(25);
    expect(Math.max(...results.map((result) => result.strikes))).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS total FROM api_rate_limit_days')).rows[0].total).toBe(1);
  });

  it('enforces shared HTTP limits across two apps and does not trust spoofed forwarding headers', async () => {
    const get = (node: number, path: string, forwarded = '203.0.113.1') =>
      fetch(urls[node] + '/v1' + path, { headers: { 'X-Forwarded-For': forwarded } });
    expect((await get(0,'/vehicles/makes')).status).toBe(200);
    const limited = await get(1,'/vehicles/makes','203.0.113.99');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await limited.json()).code).toBe('RATE_LIMIT_EXCEEDED');
    expect((await get(0,'/rate-test/general')).status).toBe(200);
    expect((await get(1,'/rate-test/general')).status).toBe(429);
    expect((await get(0,'/rate-test/auth')).status).toBe(200);
    const blocked = await get(1,'/rate-test/auth');
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).code).toBe('IP_BLOCKED_UNTIL_DAY_END');
    expect((await (await get(0,'/vehicles/models?make=audi')).json()).code).toBe('IP_BLOCKED_UNTIL_DAY_END');
    expect((await get(0,'/health')).status).toBe(200);
  });

  it('cleans expired rows in bounded batches without deleting live state', async () => {
    for (const name of ['old-1','old-2','old-3']) await at('2000-01-01T12:00:00Z',command(name));
    await store.consume(command('current'));
    expect(await store.purgeExpired(2)).toBe(2);
    expect(await store.purgeExpired(2)).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS total FROM api_rate_limit_days')).rows[0].total).toBe(1);
  });
});
