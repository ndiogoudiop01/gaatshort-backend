export const CACHE = Symbol('CACHE');

export interface CachePort {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Invalidation par motif — utilisé pour purger un tenant entier. */
  delByPattern(pattern: string): Promise<number>;
  /** Anti stampede : une seule exécution concurrente pour une clé froide. */
  remember<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T>;
}
