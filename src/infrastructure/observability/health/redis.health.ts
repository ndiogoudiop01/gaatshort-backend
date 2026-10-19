import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicator, type HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@infra/cache/redis.provider';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    super();
  }

  public async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const startedAt = Date.now();
      await this.redis.ping();
      return this.getStatus(key, true, { latencyMs: Date.now() - startedAt });
    } catch (error) {
      throw new HealthCheckError(
        'Redis injoignable',
        this.getStatus(key, false, { message: (error as Error).message }),
      );
    }
  }
}
