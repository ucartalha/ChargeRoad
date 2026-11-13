import { getEnvironment } from '../config/environment';

export const RATE_LIMIT_OPTIONS = Symbol('RATE_LIMIT_OPTIONS');
export type RateLimitPolicyName = 'general' | 'catalogue' | 'auth' | 'planning';
export type RateLimitOptions = {
  secret: string;
  timezone: string;
  strikeLimit: number;
  maxPending: number;
  policies: Record<RateLimitPolicyName, { limit: number; windowSeconds: number }>;
};

export function rateLimitOptions(): RateLimitOptions {
  const env = getEnvironment();
  if (!env.RATE_LIMIT_IP_HASH_SECRET) throw new Error('Set RATE_LIMIT_IP_HASH_SECRET to a shared secret of at least 32 characters');
  return {
    secret: env.RATE_LIMIT_IP_HASH_SECRET,
    timezone: env.RATE_LIMIT_DAY_TIMEZONE,
    strikeLimit: env.RATE_LIMIT_DAILY_STRIKES,
    maxPending: env.RATE_LIMIT_MAX_PENDING,
    policies: {
      general: { limit: env.RATE_LIMIT_GENERAL_PER_MINUTE, windowSeconds: 60 },
      catalogue: { limit: env.RATE_LIMIT_CATALOGUE_PER_MINUTE, windowSeconds: 60 },
      auth: { limit: env.RATE_LIMIT_AUTH_PER_MINUTE, windowSeconds: 60 },
      planning: { limit: env.RATE_LIMIT_PLANNING_PER_MINUTE, windowSeconds: 60 },
    },
  };
}
