import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';
import { RateLimitGuard, normalizeIp } from '../rate-limit.guard';
import { RateLimitStore } from '../rate-limit.store';
import type { RateLimitDecision } from '../rate-limit.store';
import type { RateLimitOptions } from '../rate-limit.config';

const allowed: RateLimitDecision = { outcome: 'allowed', remaining: 1, strikes: 0, retryAfterSeconds: 0 };
const options: RateLimitOptions = {
  secret: 'test-only-secret-of-at-least-32-characters', timezone: 'Europe/Istanbul',
  strikeLimit: 3, maxPending: 1, policies: {
    general: { limit: 2, windowSeconds: 60 }, catalogue: { limit: 2, windowSeconds: 60 },
    auth: { limit: 2, windowSeconds: 60 },
  },
};
const makeContext = () => ({
  getHandler: () => () => {}, getClass: () => class {},
  switchToHttp: () => ({ getRequest: () => ({ ip: '::ffff:127.0.0.1', method: 'GET' }),
    getResponse: () => ({ setHeader: jest.fn() }) as unknown as Response }),
}) as unknown as ExecutionContext;

describe('Rate limit guard', () => {
  it('canonicalizes equivalent IPv4/IPv6 representations', () => {
    expect(normalizeIp('::ffff:192.0.2.1')).toBe(normalizeIp('192.0.2.1'));
    expect(normalizeIp('::ffff:c000:201')).toBe(normalizeIp('192.0.2.1'));
    expect(normalizeIp('2001:0DB8:0:0:0:0:0:1')).toBe(normalizeIp('2001:db8::1'));
    expect(() => normalizeIp('untrusted-ip')).toThrow();
  });

  it('never passes raw IP addresses to shared storage', async () => {
    const consume = jest.fn().mockResolvedValue(allowed);
    const guard = new RateLimitGuard(new Reflector(), { consume } as RateLimitStore, options);
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    expect(consume.mock.calls[0][0].ipKey).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(consume.mock.calls)).not.toContain('127.0.0.1');
  });

  it('fails closed when the shared store is unavailable', async () => {
    const guard = new RateLimitGuard(new Reflector(), {
      consume: async () => { throw new Error('database unavailable'); },
    },options);
    await expect(guard.canActivate(makeContext())).rejects.toMatchObject({ status: 503 });
  });

  it('bounds pending store operations and releases admission after completion', async () => {
    let release!: (decision: RateLimitDecision) => void;
    const consume = jest.fn().mockImplementationOnce(() => new Promise<RateLimitDecision>((resolve) => { release = resolve; }))
      .mockResolvedValue(allowed);
    const guard = new RateLimitGuard(new Reflector(), { consume }, options);
    const first = guard.canActivate(makeContext());
    await expect(guard.canActivate(makeContext())).rejects.toMatchObject({ status: 503 });
    expect(consume).toHaveBeenCalledTimes(1);
    release(allowed);
    await first;
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    expect(consume).toHaveBeenCalledTimes(2);
  });
});
