import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import type { LockPort } from '@shared/kernel/ports/lock.port';
import { REDIS_CLIENT } from '@infra/cache/redis.provider';

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

/**
 * Verrou distribué (SET NX PX + libération conditionnelle par script Lua).
 *
 * - `SET key token PX ttl NX` : pose le verrou si — et seulement si — il est
 *   libre, avec une **expiration** (aucun verrou orphelin si le process meurt).
 * - Libération = compare-and-delete atomique : on ne supprime que si la valeur
 *   est toujours NOTRE jeton. Sinon, un process lent qui déborde son TTL
 *   supprimerait le verrou repris entre-temps par un autre.
 * - Le TTL doit majorer la durée d'exécution attendue. S'il déborde quand
 *   même, deux process peuvent exécuter `fn` en parallèle : les traitements
 *   protégés (relais outbox, crons) sont donc écrits **idempotents**. Pas de
 *   watchdog / renouvellement automatique : simple et prévisible.
 * - Clé : `lock:{key}` (+ `keyPrefix` ioredis). Non préfixée par tenant — les
 *   verrous sont plateforme ; un besoin par tenant se code dans `key`.
 */
@Injectable()
export class RedisLockService implements LockPort {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  public async acquire(key: string, ttlMs: number) {
    const token = randomUUID();
    const acquired = await this.redis.set(`lock:${key}`, token, 'PX', ttlMs, 'NX');
    if (!acquired) return null;
    return {
      release: async () => {
        await this.redis.eval(RELEASE_SCRIPT, 1, `lock:${key}`, token);
      },
    };
  }

  public async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    const lock = await this.acquire(key, ttlMs);
    if (!lock) return null;
    try {
      return await fn();
    } finally {
      await lock.release();
    }
  }
}
