import type Redis from 'ioredis';
import type { AppConfigService } from '@config/app-config.service';
import type { TenantContextService } from '../tenancy/context/tenant-context.service';
import { RedisCacheService } from '../cache/redis-cache.service';

function fakeRedis(overrides: Partial<Redis> = {}): Redis {
  return {
    get: async () => null,
    set: async () => 'OK',
    del: async () => 1,
    scan: async () => ['0', []],
    ...overrides,
  } as unknown as Redis;
}

const CONFIG = {
  redis: { cacheDefaultTtlSeconds: 300, keyPrefix: 'ig' },
} as unknown as AppConfigService;

function withTenant(tenantId: string | null): TenantContextService {
  return { getOrNull: () => (tenantId ? { tenantId } : null) } as unknown as TenantContextService;
}

describe('RedisCacheService', () => {
  it('préfixe chaque clé par le tenant courant', async () => {
    const get = jest.fn(async () => null);
    const cache = new RedisCacheService(fakeRedis({ get }), withTenant('tenant-1'), CONFIG);
    await cache.get('activities:list');
    expect(get).toHaveBeenCalledWith('t:tenant-1:activities:list');
  });

  it('préfixe en « global » hors de tout contexte tenant', async () => {
    const get = jest.fn(async () => null);
    const cache = new RedisCacheService(fakeRedis({ get }), withTenant(null), CONFIG);
    await cache.get('countries');
    expect(get).toHaveBeenCalledWith('global:countries');
  });

  it('sérialise et désérialise les valeurs stockées', async () => {
    const store = new Map<string, string>();
    const redis = fakeRedis({
      set: async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      },
      get: async (key: string) => store.get(key) ?? null,
    });
    const cache = new RedisCacheService(redis, withTenant('tenant-1'), CONFIG);

    await cache.set('x', { a: 1 });
    expect(await cache.get('x')).toEqual({ a: 1 });
  });

  it('remember ne recalcule pas une valeur déjà en cache', async () => {
    const cache = new RedisCacheService(
      fakeRedis({ get: async () => JSON.stringify('cached') }),
      withTenant('tenant-1'),
      CONFIG,
    );
    const factory = jest.fn(async () => 'fresh');
    expect(await cache.remember('key', 60, factory)).toBe('cached');
    expect(factory).not.toHaveBeenCalled();
  });

  it('remember calcule et met en cache une valeur absente', async () => {
    const set = jest.fn(async () => 'OK' as const);
    const cache = new RedisCacheService(fakeRedis({ get: async () => null, set }), withTenant('tenant-1'), CONFIG);
    const result = await cache.remember('key', 60, async () => 'fresh');
    expect(result).toBe('fresh');
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('remember ne déclenche la factory qu’une fois pour des appels concurrents (anti-stampede)', async () => {
    const cache = new RedisCacheService(
      fakeRedis({ get: async () => null, set: async () => 'OK' }),
      withTenant('tenant-1'),
      CONFIG,
    );
    const factory = jest.fn(async () => 'fresh');

    const [a, b] = await Promise.all([cache.remember('hot-key', 60, factory), cache.remember('hot-key', 60, factory)]);

    expect(a).toBe('fresh');
    expect(b).toBe('fresh');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('purge par motif en parcourant tous les curseurs SCAN', async () => {
    const scan = jest
      .fn()
      .mockResolvedValueOnce(['17', ['ig:t:tenant-1:a', 'ig:t:tenant-1:b']])
      .mockResolvedValueOnce(['0', ['ig:t:tenant-1:c']]);
    const del = jest.fn(async () => 1);
    const cache = new RedisCacheService(fakeRedis({ scan: scan as never, del }), withTenant('tenant-1'), CONFIG);

    const deleted = await cache.delByPattern('activities:*');

    expect(scan).toHaveBeenCalledTimes(2);
    expect(del).toHaveBeenCalledTimes(2);
    expect(deleted).toBe(2);
  });
});
