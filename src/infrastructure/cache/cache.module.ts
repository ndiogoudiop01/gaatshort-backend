import { Global, Module } from '@nestjs/common';
import { CACHE } from '@shared/kernel/ports/cache.port';
import { LOCK } from '@shared/kernel/ports/lock.port';
import { RedisLockService } from '@infra/lock/redis-lock.service';
import { RedisCacheService } from './redis-cache.service';
import { redisProviders, REDIS_CLIENT, REDIS_QUEUE_CLIENT } from './redis.provider';

@Global()
@Module({
  providers: [
    ...redisProviders,
    RedisCacheService,
    { provide: CACHE, useExisting: RedisCacheService },
    RedisLockService,
    { provide: LOCK, useExisting: RedisLockService },
  ],
  exports: [REDIS_CLIENT, REDIS_QUEUE_CLIENT, CACHE, LOCK, RedisCacheService],
})
export class CacheModule {}
