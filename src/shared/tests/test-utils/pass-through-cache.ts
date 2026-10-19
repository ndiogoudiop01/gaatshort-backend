import type { CachePort } from '@shared/kernel/ports/cache.port';

/** Fake de CachePort qui n'a jamais rien en cache : exécute toujours la factory. */
export function passThroughCache(): CachePort {
  return {
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(undefined),
    del: () => Promise.resolve(undefined),
    delByPattern: () => Promise.resolve(0),
    remember: (_key, _ttlSeconds, factory) => factory(),
  };
}
