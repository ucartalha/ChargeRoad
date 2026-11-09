import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import {
  CanActivate, ExecutionContext, HttpException, Inject, Injectable, Logger, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { RateLimitStore } from './rate-limit.store';
import { RATE_LIMIT_OPTIONS } from './rate-limit.config';
import type { RateLimitOptions, RateLimitPolicyName } from './rate-limit.config';

const POLICY_KEY = 'chargeroad:rate-limit-policy';
export const RateLimitPolicy = (policy: RateLimitPolicyName) => SetMetadata(POLICY_KEY, policy);
export const SkipRateLimit = () => SetMetadata(POLICY_KEY, 'skip');

export function normalizeIp(value: string): string {
  let ip = value.toLowerCase();
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  if (!isIP(ip)) throw new Error('Invalid client IP');
  // WHATWG URL canonicalizes equivalent IPv6 spellings. Do not trust client headers here.
  if (isIP(ip) === 4) return ip;
  const canonical = new URL('http://[' + ip + ']').hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1],16);
  const low = parseInt(mapped[2],16);
  return [high >> 8,high & 255,low >> 8,low & 255].join('.');
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private pending = 0;
  private lastErrorLogAt = 0;
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly store: RateLimitStore,
    @Inject(RATE_LIMIT_OPTIONS) private readonly options: RateLimitOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policyName = this.reflector.getAllAndOverride<RateLimitPolicyName | 'skip'>(
      POLICY_KEY, [context.getHandler(), context.getClass()],
    ) ?? 'general';
    if (policyName === 'skip') return true;
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    // CORS preflights carry no application work and must not consume the caller's allowance.
    if (request.method === 'OPTIONS') return true;
    response.setHeader('Cache-Control', 'no-store');
    if (this.pending >= this.options.maxPending) this.unavailable(response);
    this.pending++;
    let decision;
    try {
      const ip = normalizeIp(request.ip ?? request.socket.remoteAddress ?? '');
      const ipKey = createHmac('sha256', this.options.secret).update(ip).digest('hex');
      const policy = this.options.policies[policyName];
      decision = await this.store.consume({ ipKey, policy: policyName + ':v1', ...policy,
        strikeLimit: this.options.strikeLimit, timezone: this.options.timezone });
    } catch {
      if (Date.now() - this.lastErrorLogAt > 10000) {
        this.lastErrorLogAt = Date.now();
        this.logger.error('Shared rate limit state unavailable');
      }
      this.unavailable(response);
    } finally {
      this.pending--;
    }
    response.setHeader('X-RateLimit-Limit', this.options.policies[policyName].limit);
    response.setHeader('X-RateLimit-Remaining', decision.remaining);
    if (decision.outcome !== 'allowed') {
      response.setHeader('Retry-After', decision.retryAfterSeconds);
      throw new HttpException({
        statusCode: 429,
        code: decision.outcome === 'blocked' ? 'IP_BLOCKED_UNTIL_DAY_END' : 'RATE_LIMIT_EXCEEDED',
        message: decision.outcome === 'blocked' ? 'Günlük aşım sınırı nedeniyle erişim geçici olarak engellendi.' : 'Çok fazla istek. Lütfen belirtilen süre sonunda tekrar deneyin.',
        retryAfterSeconds: decision.retryAfterSeconds,
      }, 429);
    }
    return true;
  }

  private unavailable(response: Response): never {
    response.setHeader('Retry-After', '1');
    throw new HttpException({ statusCode: 503, code: 'RATE_LIMIT_STATE_UNAVAILABLE',
      message: 'İstek şu anda işlenemiyor. Lütfen kısa süre sonra tekrar deneyin.' }, 503);
  }
}
