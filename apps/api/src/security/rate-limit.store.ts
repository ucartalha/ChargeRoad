export type RateLimitCommand = {
  ipKey: string;
  policy: string;
  limit: number;
  windowSeconds: number;
  strikeLimit: number;
  timezone: string;
};

export type RateLimitDecision = {
  outcome: 'allowed' | 'limited' | 'blocked';
  remaining: number;
  strikes: number;
  retryAfterSeconds: number;
};

// Redis must implement the complete atomic operation, not a get/increment/set sequence.
export abstract class RateLimitStore {
  abstract consume(command: RateLimitCommand): Promise<RateLimitDecision>;
}
