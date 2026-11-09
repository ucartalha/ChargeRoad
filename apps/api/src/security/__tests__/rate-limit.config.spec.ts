import { getEnvironment } from '../../config/environment';
import { rateLimitOptions } from '../rate-limit.config';

describe('Rate limit secret configuration', () => {
  it('lets CLI configuration load an empty example secret but requires a real secret for HTTP', () => {
    const original = process.env.RATE_LIMIT_IP_HASH_SECRET;
    try {
      process.env.RATE_LIMIT_IP_HASH_SECRET = '';
      expect(getEnvironment().RATE_LIMIT_IP_HASH_SECRET).toBeUndefined();
      expect(() => rateLimitOptions()).toThrow('RATE_LIMIT_IP_HASH_SECRET');
    } finally {
      if (original === undefined) delete process.env.RATE_LIMIT_IP_HASH_SECRET;
      else process.env.RATE_LIMIT_IP_HASH_SECRET = original;
    }
  });

  it('rejects fractional request limits', () => {
    const original = process.env.RATE_LIMIT_GENERAL_PER_MINUTE;
    try {
      process.env.RATE_LIMIT_GENERAL_PER_MINUTE = '2.5';
      expect(() => getEnvironment()).toThrow();
    } finally {
      if (original === undefined) delete process.env.RATE_LIMIT_GENERAL_PER_MINUTE;
      else process.env.RATE_LIMIT_GENERAL_PER_MINUTE = original;
    }
  });
});
