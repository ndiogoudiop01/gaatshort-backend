import type Redis from 'ioredis';
import { RedisLockService } from '../lock/redis-lock.service';

describe('RedisLockService', () => {
  it('acquiert un verrou libre et le libère via le script de compare-and-delete', async () => {
    const evalMock = jest.fn(async () => 1);
    const redis = { set: jest.fn(async () => 'OK'), eval: evalMock } as unknown as Redis;
    const service = new RedisLockService(redis);

    const lock = await service.acquire('outbox:relay', 30_000);
    expect(lock).not.toBeNull();

    await lock?.release();
    expect(evalMock).toHaveBeenCalledTimes(1);
  });

  it('renvoie null quand le verrou est déjà détenu', async () => {
    const redis = { set: jest.fn(async () => null) } as unknown as Redis;
    const service = new RedisLockService(redis);
    expect(await service.acquire('outbox:relay', 30_000)).toBeNull();
  });

  it('withLock exécute la fonction puis libère systématiquement le verrou', async () => {
    const evalMock = jest.fn(async () => 1);
    const redis = { set: jest.fn(async () => 'OK'), eval: evalMock } as unknown as Redis;
    const service = new RedisLockService(redis);

    const result = await service.withLock('outbox:relay', 30_000, async () => 'done');

    expect(result).toBe('done');
    expect(evalMock).toHaveBeenCalledTimes(1);
  });

  it('withLock libère le verrou même si la fonction échoue', async () => {
    const evalMock = jest.fn(async () => 1);
    const redis = { set: jest.fn(async () => 'OK'), eval: evalMock } as unknown as Redis;
    const service = new RedisLockService(redis);

    await expect(
      service.withLock('outbox:relay', 30_000, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(evalMock).toHaveBeenCalledTimes(1);
  });

  it('withLock ne fait rien si le verrou est déjà pris', async () => {
    const fn = jest.fn();
    const redis = { set: jest.fn(async () => null) } as unknown as Redis;
    const service = new RedisLockService(redis);

    const result = await service.withLock('outbox:relay', 30_000, fn);

    expect(result).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });
});
