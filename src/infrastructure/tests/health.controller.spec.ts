import type {
  HealthCheckService,
  MemoryHealthIndicator,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import type { PrismaService } from '@infra/persistence/prisma/prisma.service';
import type { AppConfigService } from '@config/app-config.service';
import { HealthController } from '../observability/health/health.controller';
import type { RedisHealthIndicator } from '../observability/health/redis.health';

/**
 * `live` et `ready` ont des sémantiques VOLONTAIREMENT distinctes :
 *  - live  ne doit dépendre d'AUCUNE ressource externe (un échec = redémarrage) ;
 *  - ready agrège les dépendances (un échec = retrait du load balancer).
 */
describe('HealthController', () => {
  const config = { app: { version: 'a1b2c3d' } } as unknown as AppConfigService;

  it('live : répond sans jamais interroger une dépendance', () => {
    const check = jest.fn();
    const controller = new HealthController(
      { check } as unknown as HealthCheckService,
      {} as PrismaHealthIndicator,
      {} as RedisHealthIndicator,
      {} as MemoryHealthIndicator,
      {} as PrismaService,
      config,
    );

    const result = controller.live();

    expect(result.status).toBe('ok');
    expect(typeof result.uptime).toBe('number');
    // Le smoke test du déploiement compare cette valeur au SHA du pipeline.
    expect(result.version).toBe('a1b2c3d');
    expect(check).not.toHaveBeenCalled();
  });

  it('ready : agrège base + Redis + heap via Terminus', async () => {
    const check = jest.fn(async (indicators: (() => unknown)[]) => {
      indicators.forEach((fn) => fn());
      return { status: 'ok' };
    });
    const pingCheck = jest.fn(() => ({ database: { status: 'up' } }));
    const isHealthy = jest.fn(() => ({ redis: { status: 'up' } }));
    const checkHeap = jest.fn(() => ({ memory_heap: { status: 'up' } }));

    const controller = new HealthController(
      { check } as unknown as HealthCheckService,
      { pingCheck } as unknown as PrismaHealthIndicator,
      { isHealthy } as unknown as RedisHealthIndicator,
      { checkHeap } as unknown as MemoryHealthIndicator,
      {} as PrismaService,
      config,
    );

    await controller.ready();

    expect(check).toHaveBeenCalledTimes(1);
    expect(pingCheck).toHaveBeenCalledWith('database', expect.anything(), { timeout: 2_000 });
    expect(isHealthy).toHaveBeenCalledWith('redis');
    expect(checkHeap).toHaveBeenCalledWith('memory_heap', 512 * 1024 * 1024);
  });

  it('ready : propage l’échec quand une dépendance est down', async () => {
    const check = jest.fn(async () => {
      throw new Error('database unreachable');
    });
    const controller = new HealthController(
      { check } as unknown as HealthCheckService,
      { pingCheck: jest.fn() } as unknown as PrismaHealthIndicator,
      { isHealthy: jest.fn() } as unknown as RedisHealthIndicator,
      { checkHeap: jest.fn() } as unknown as MemoryHealthIndicator,
      {} as PrismaService,
      config,
    );

    await expect(controller.ready()).rejects.toThrow('database unreachable');
  });
});
