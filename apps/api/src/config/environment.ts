import { resolve } from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';

config({ path: resolve(__dirname, '../../../../.env'), quiet: true });

const environmentSchema = z.object({
  DATABASE_URL: z.string().url().refine(
    (value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
    'DATABASE_URL must use PostgreSQL',
  ),
  VEHICLE_DATA_VERSION: z.string().default('v1.24.0'),
  RATE_LIMIT_IP_HASH_SECRET: z.preprocess((value) => value === '' ? undefined : value, z.string().min(32).optional()),
  RATE_LIMIT_DAY_TIMEZONE: z.string().default('Europe/Istanbul').refine((zone) => {
    try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; }
  }, 'Invalid rate limit timezone'),
  RATE_LIMIT_DAILY_STRIKES: z.coerce.number().int().min(1).max(100).default(3),
  RATE_LIMIT_GENERAL_PER_MINUTE: z.coerce.number().int().min(1).max(1000000).default(60),
  RATE_LIMIT_CATALOGUE_PER_MINUTE: z.coerce.number().int().min(1).max(1000000).default(120),
  RATE_LIMIT_AUTH_PER_MINUTE: z.coerce.number().int().min(1).max(1000000).default(10),
  RATE_LIMIT_MAX_PENDING: z.coerce.number().int().min(1).max(1000).default(32),
  TRUSTED_PROXY_CIDRS: z.string().default(''),
});

export function getEnvironment() {
  return environmentSchema.parse(process.env);
}
