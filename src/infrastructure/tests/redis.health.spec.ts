import { HealthCheckError } from '@nestjs/terminus';
import type Redis from 'ioredis';
import { RedisHealthIndicator } from '../observability/health/redis.health';

describe('RedisHealthIndicator', () => {
  it('rapporte Redis en bonne santé avec sa latence', async () => {
    const redis = { ping: async () => 'PONG' } as unknown as Redis;
    const indicator = new RedisHealthIndicator(redis);
    const result = await indicator.isHealthy('redis');
    expect(result.redis.status).toBe('up');
  });

  it('lève une HealthCheckError quand Redis est injoignable', async () => {
    const redis = {
      ping: async () => {
        throw new Error('ECONNREFUSED');
      },
    } as unknown as Redis;
    const indicator = new RedisHealthIndicator(redis);
    await expect(indicator.isHealthy('redis')).rejects.toThrow(HealthCheckError);
  });
});
