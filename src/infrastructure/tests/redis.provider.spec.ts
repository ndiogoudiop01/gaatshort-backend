import { Logger } from '@nestjs/common';
import type { AppConfigService } from '@config/app-config.service';

const onMock = jest.fn();
const RedisMock = jest.fn().mockImplementation(() => ({ on: onMock }));

jest.mock('ioredis', () => ({ __esModule: true, default: RedisMock }));

import { redisProviders, REDIS_CLIENT, REDIS_QUEUE_CLIENT } from '../cache/redis.provider';

const CONFIG = {
  redis: { url: 'redis://localhost:6379', keyPrefix: 'ig' },
} as unknown as AppConfigService;

describe('redisProviders', () => {
  beforeEach(() => {
    RedisMock.mockClear();
    onMock.mockClear();
  });

  it('déclare un provider pour le client applicatif et un pour BullMQ', () => {
    expect(redisProviders.map((p) => (p as { provide: symbol }).provide)).toEqual([
      REDIS_CLIENT,
      REDIS_QUEUE_CLIENT,
    ]);
  });

  it('préfixe les clés et laisse ioredis reconnecter sans plafond de tentatives', () => {
    const provider = redisProviders[0] as { useFactory: (config: AppConfigService) => unknown };
    provider.useFactory(CONFIG);

    // `maxRetriesPerRequest: null` : une commande émise pendant une coupure
    // attend la reconnexion au lieu de rejeter en MaxRetriesPerRequestError.
    // Le plafond réel est `commandTimeout`.
    expect(RedisMock).toHaveBeenCalledWith(
      'redis://localhost:6379',
      expect.objectContaining({
        keyPrefix: 'ig:',
        maxRetriesPerRequest: null,
        commandTimeout: 5_000,
      }),
    );
    expect(onMock).toHaveBeenCalledWith('error', expect.any(Function));
    expect(onMock).toHaveBeenCalledWith('ready', expect.any(Function));
  });

  it('configure le client BullMQ sans limite de tentatives (exigence de la lib)', () => {
    const provider = redisProviders[1] as { useFactory: (config: AppConfigService) => unknown };
    provider.useFactory(CONFIG);

    expect(RedisMock).toHaveBeenCalledWith(
      'redis://localhost:6379',
      expect.objectContaining({ maxRetriesPerRequest: null }),
    );
  });

  it('attache un écouteur error au client BullMQ', () => {
    // Sans écouteur, ioredis écrit « [ioredis] Unhandled error event » sur
    // stderr, hors de Pino : des centaines de lignes non structurées.
    const provider = redisProviders[1] as { useFactory: (config: AppConfigService) => unknown };
    provider.useFactory(CONFIG);

    expect(onMock).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('ne journalise qu’une fois une erreur de connexion répétée', () => {
    const logged: string[] = [];
    const listeners = new Map<string, (arg: unknown) => void>();
    onMock.mockImplementation((event: string, handler: (arg: unknown) => void) => {
      listeners.set(event, handler);
    });
    jest.spyOn(Logger.prototype, 'error').mockImplementation((message) => {
      logged.push(String(message));
    });

    const provider = redisProviders[0] as { useFactory: (config: AppConfigService) => unknown };
    provider.useFactory(CONFIG);

    const refused = Object.assign(new Error(''), { code: 'ECONNREFUSED' });
    for (let i = 0; i < 10; i += 1) listeners.get('error')?.(refused);

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('ECONNREFUSED');
  });
});
