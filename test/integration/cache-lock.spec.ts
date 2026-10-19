import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import Redis from 'ioredis';
import type { AppConfigService } from '@config/app-config.service';
import type { TenantContextService } from '@infra/tenancy/context/tenant-context.service';
import { RedisCacheService } from '@infra/cache/redis-cache.service';
import { RedisLockService } from '@infra/lock/redis-lock.service';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Cache / verrous — contre un vrai Redis.
 *
 *  Les tests unitaires de `RedisCacheService` / `RedisLockService` moquent
 *  `scan`/`set`/`eval` : ils ne peuvent PAS attraper une régression de
 *  l'interaction avec ioredis (préfixage du `MATCH` de SCAN, sémantique NX/PX,
 *  compare-and-delete sous contention réelle). D'où cette suite d'intégration.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const KEY_PREFIX = 'igtest';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeConfig(): AppConfigService {
  return {
    redis: { keyPrefix: KEY_PREFIX, cacheDefaultTtlSeconds: 300 },
  } as unknown as AppConfigService;
}

function tenantCtx(tenantId: string | null): TenantContextService {
  return { getOrNull: () => (tenantId ? { tenantId } : null) } as unknown as TenantContextService;
}

describe('Cache & verrous (Redis réel)', () => {
  let container: StartedRedisContainer;
  let redis: Redis;

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    // Même configuration que redis.provider.ts : keyPrefix suffixé de ':'.
    redis = new Redis(container.getConnectionUrl(), { keyPrefix: `${KEY_PREFIX}:` });
  }, 120_000);

  afterAll(async () => {
    if (redis) await redis.quit();
    if (container) await container.stop();
  });

  afterEach(async () => {
    await redis.flushdb();
  });

  // ── RedisCacheService ────────────────────────────────────────────────────
  describe('RedisCacheService.delByPattern', () => {
    it('supprime par SCAN les clés du tenant courant qui matchent, et rien d’autre', async () => {
      const t1 = new RedisCacheService(redis, tenantCtx('tenant-1'), fakeConfig());
      const t2 = new RedisCacheService(redis, tenantCtx('tenant-2'), fakeConfig());

      await t1.set('activities:list', [1, 2, 3]);
      await t1.set('activities:facets', { a: 1 });
      await t1.set('news:list', ['x']); // ne matche pas le motif
      await t2.set('activities:list', ['autre-tenant']); // autre tenant

      const deleted = await t1.delByPattern('activities:*');

      expect(deleted).toBe(2);
      expect(await t1.get('activities:list')).toBeNull();
      expect(await t1.get('activities:facets')).toBeNull();
      expect(await t1.get('news:list')).toEqual(['x']); // intact
      expect(await t2.get('activities:list')).toEqual(['autre-tenant']); // intact
    });

    it('parcourt plusieurs curseurs SCAN (> COUNT clés)', async () => {
      const cache = new RedisCacheService(redis, tenantCtx('tenant-1'), fakeConfig());
      // 260 > COUNT(200) → SCAN rend forcément la main en plusieurs fois.
      // Seed en pipeline (un seul aller-retour) pour rester rapide sous charge CI.
      const pipe = redis.pipeline();
      for (let i = 0; i < 260; i++) pipe.set(`t:tenant-1:bulk:${i}`, String(i));
      await pipe.exec();

      const deleted = await cache.delByPattern('bulk:*');

      expect(deleted).toBe(260);
      expect(await cache.get('bulk:0')).toBeNull();
      expect(await cache.get('bulk:259')).toBeNull();
    });
  });

  describe('RedisCacheService.remember (anti-stampede intra-process)', () => {
    it('n’exécute la factory qu’une fois pour N appels concurrents sur une clé froide', async () => {
      const cache = new RedisCacheService(redis, tenantCtx('tenant-1'), fakeConfig());
      let calls = 0;
      const factory = async () => {
        calls++;
        await sleep(50);
        return { value: 42 };
      };

      const results = await Promise.all(
        Array.from({ length: 25 }, () => cache.remember('hot:key', 60, factory)),
      );

      expect(calls).toBe(1);
      expect(results.every((r) => r.value === 42)).toBe(true);
      expect(await cache.get('hot:key')).toEqual({ value: 42 }); // bien mise en cache
    });

    it('relance la factory après échec (la clé en vol est libérée)', async () => {
      const cache = new RedisCacheService(redis, tenantCtx('tenant-1'), fakeConfig());
      let calls = 0;
      const factory = async () => {
        calls++;
        if (calls === 1) throw new Error('boom');
        return 'ok';
      };

      await expect(cache.remember('k', 60, factory)).rejects.toThrow('boom');
      await expect(cache.remember('k', 60, factory)).resolves.toBe('ok');
      expect(calls).toBe(2);
    });
  });

  // ── RedisLockService ────────────────────────────────────────────────────
  describe('RedisLockService', () => {
    it('un seul détenteur à la fois (SET NX)', async () => {
      const lock = new RedisLockService(redis);

      const a = await lock.acquire('job:relay', 5_000);
      const b = await lock.acquire('job:relay', 5_000);

      expect(a).not.toBeNull();
      expect(b).toBeNull();

      await a?.release();
      const c = await lock.acquire('job:relay', 5_000);
      expect(c).not.toBeNull();
      await c?.release();
    });

    it('le verrou expire après son TTL (PX)', async () => {
      const lock = new RedisLockService(redis);

      await lock.acquire('job:short', 120);
      expect(await lock.acquire('job:short', 5_000)).toBeNull(); // encore tenu

      await sleep(200);
      const after = await lock.acquire('job:short', 5_000); // TTL écoulé
      expect(after).not.toBeNull();
      await after?.release();
    });

    it('un release tardif ne supprime pas le verrou repris par un autre (compare-and-delete)', async () => {
      const lock = new RedisLockService(redis);

      const slow = await lock.acquire('job:contended', 120); // TTL court
      expect(slow).not.toBeNull();

      await sleep(200); // le TTL de `slow` expire

      const fresh = await lock.acquire('job:contended', 5_000); // un autre process prend le verrou
      expect(fresh).not.toBeNull();

      await slow?.release(); // release tardif : token différent → ne doit RIEN supprimer

      // le verrou de `fresh` tient toujours
      expect(await lock.acquire('job:contended', 5_000)).toBeNull();
      await fresh?.release();
    });

    it('withLock libère le verrou en succès comme en échec', async () => {
      const lock = new RedisLockService(redis);

      expect(await lock.withLock('job:w', 5_000, async () => 'done')).toBe('done');
      expect(await redis.get('lock:job:w')).toBeNull(); // libéré

      await expect(
        lock.withLock('job:w', 5_000, async () => {
          throw new Error('kaboom');
        }),
      ).rejects.toThrow('kaboom');
      expect(await redis.get('lock:job:w')).toBeNull(); // libéré malgré l’exception
    });

    it('withLock renvoie null sans exécuter fn si le verrou est pris', async () => {
      const lock = new RedisLockService(redis);
      const held = await lock.acquire('job:busy', 5_000);

      const fn = jest.fn();
      expect(await lock.withLock('job:busy', 5_000, fn)).toBeNull();
      expect(fn).not.toHaveBeenCalled();

      await held?.release();
    });
  });
});
