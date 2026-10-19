import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { AppConfigService } from '@config/app-config.service';
import type { CachePort } from '@shared/kernel/ports/cache.port';
import { TenantContextService } from '@infra/tenancy/context/tenant-context.service';
import { REDIS_CLIENT } from './redis.provider';

/**
 * Cache Redis avec préfixage automatique par tenant.
 *
 * Le bug de cache multi-tenant le plus fréquent — et le plus grave — est la
 * clé partagée : `activities:list` renvoie le catalogue d'un autre client.
 * Ici, aucune clé n'échappe au préfixe `t:{tenantId}:`.
 */
@Injectable()
export class RedisCacheService implements CachePort {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly tenantContext: TenantContextService,
    private readonly config: AppConfigService,
  ) {}

  public async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(this.scoped(key));
    return raw ? (JSON.parse(raw) as T) : null;
  }

  public async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? this.config.redis.cacheDefaultTtlSeconds;
    await this.redis.set(this.scoped(key), JSON.stringify(value), 'EX', ttl);
  }

  public async del(key: string): Promise<void> {
    await this.redis.del(this.scoped(key));
  }

  /**
   * SCAN et non KEYS : `KEYS *` bloque le thread Redis, `SCAN` est incrémental.
   *
   * Détails ioredis (5.x) : le `keyPrefix` du client est ajouté aux *clés* des
   * commandes, PAS au `MATCH` de SCAN — on le préfixe donc à la main. Inversement
   * SCAN renvoie les clés complètes (préfixe inclus) : on retire le préfixe
   * avant `del`, qui le réappliquera. Couvert par `test/integration/cache-lock.spec.ts`.
   */
  public async delByPattern(pattern: string): Promise<number> {
    const match = `${this.config.redis.keyPrefix}:${this.scoped(pattern)}`;
    let cursor = '0';
    let deleted = 0;
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', match, 'COUNT', 200);
      cursor = next;
      if (keys.length) {
        const unprefixed = keys.map((k) => k.slice(this.config.redis.keyPrefix.length + 1));
        deleted += await this.redis.del(...unprefixed);
      }
    } while (cursor !== '0');
    return deleted;
  }

  /**
   * Anti « cache stampede » : à l'expiration d'une clé chaude (le catalogue
   * d'activités par exemple), 500 requêtes concurrentes ne doivent pas
   * déclencher 500 fois la même requête SQL. Une seule passe, les autres
   * attendent la même promesse.
   *
   * PORTÉE : intra-process. La `Map` `inFlight` déduplique les appels d'UNE
   * instance d'API. Avec N instances, la factory tourne au pire N fois (pas
   * N × 500) — largement suffisant contre le thundering herd. Un verrouillage
   * cross-instance (RedisLockService) coûterait un aller-retour Redis et de
   * la latence d'attente à chaque miss : non retenu. Décision documentée dans
   * docs/12-cache-lock-ratelimit.md.
   */
  public async remember<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const scoped = this.scoped(key);
    const pending = this.inFlight.get(scoped);
    if (pending) return pending as Promise<T>;

    const promise = factory()
      .then(async (value) => {
        await this.set(key, value, ttlSeconds);
        return value;
      })
      .finally(() => this.inFlight.delete(scoped));

    this.inFlight.set(scoped, promise);
    return promise;
  }

  private scoped(key: string): string {
    const tenant = this.tenantContext.getOrNull();
    return tenant ? `t:${tenant.tenantId}:${key}` : `global:${key}`;
  }
}
