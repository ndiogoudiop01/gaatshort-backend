export const LOCK = Symbol('LOCK');

export interface LockPort {
  /**
   * Verrou distribué. Retourne null si le verrou est déjà tenu.
   * Indispensable dès qu'il y a plus d'une instance d'API (donc toujours).
   */
  acquire(key: string, ttlMs: number): Promise<{ release: () => Promise<void> } | null>;
  withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null>;
}
