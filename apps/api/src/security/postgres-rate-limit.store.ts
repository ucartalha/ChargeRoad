import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RateLimitStore } from './rate-limit.store';
import type { RateLimitCommand, RateLimitDecision } from './rate-limit.store';

@Injectable()
export class PostgresRateLimitStore extends RateLimitStore {
  constructor(private readonly database: DatabaseService) { super(); }

  async consume(command: RateLimitCommand): Promise<RateLimitDecision> {
    const { rows } = await this.database.pool.query<RateLimitDecision>(
      `SELECT outcome, remaining, strikes, retry_after_seconds AS "retryAfterSeconds"
       FROM consume_api_rate_limit($1,$2,$3,$4,$5,$6,statement_timestamp())`,
      [command.ipKey,command.policy,command.limit,command.windowSeconds,command.strikeLimit,command.timezone],
    );
    if (!rows[0]) throw new Error('Rate limit store returned no decision');
    return rows[0];
  }

  async purgeExpired(batchSize = 1000): Promise<number> {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10000) throw new Error('Invalid cleanup batch size');
    const result = await this.database.pool.query(
      `WITH expired AS (
         SELECT ip_key,local_day FROM api_rate_limit_days WHERE expires_at <= statement_timestamp()
         ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED
       ) DELETE FROM api_rate_limit_days d USING expired e
         WHERE d.ip_key=e.ip_key AND d.local_day=e.local_day`, [batchSize],
    );
    return result.rowCount ?? 0;
  }
}
