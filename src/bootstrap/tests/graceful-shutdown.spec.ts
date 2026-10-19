import { Logger, type INestApplicationContext } from '@nestjs/common';
import { setupGracefulShutdown } from '../graceful-shutdown';

/**
 * Le drainage est partagé API / worker : sur SIGTERM/SIGINT on ferme l'app
 * (ce qui draine les jobs BullMQ actifs), avec une borne de 30 s.
 */
describe('setupGracefulShutdown', () => {
  const handlers = new Map<string, () => void>();
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    handlers.clear();
    jest.spyOn(process, 'on').mockImplementation(((event: string, cb: () => void) => {
      handlers.set(event, cb);
      return process;
    }) as never);
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  interface FakeApp extends INestApplicationContext {
    enableShutdownHooks: jest.Mock;
    close: jest.Mock;
  }
  const fakeApp = (close: () => Promise<void>): FakeApp =>
    ({ enableShutdownHooks: jest.fn(), close: jest.fn(close) }) as unknown as FakeApp;

  const flush = () => new Promise((r) => setImmediate(r));

  it('active les shutdown hooks et écoute SIGTERM + SIGINT', () => {
    const app = fakeApp(async () => undefined);
    setupGracefulShutdown(app);
    expect(app.enableShutdownHooks).toHaveBeenCalledTimes(1);
    expect([...handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM']);
  });

  it('sur SIGTERM : ferme l’app (draine les jobs) puis exit(0)', async () => {
    const app = fakeApp(async () => undefined);
    setupGracefulShutdown(app);

    handlers.get('SIGTERM')!();
    await flush();

    expect(app.close).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('si app.close() échoue : exit(1)', async () => {
    const app = fakeApp(async () => {
      throw new Error('close boom');
    });
    setupGracefulShutdown(app);

    handlers.get('SIGINT')!();
    await flush();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  // Régression CI : le minuteur de garde survivait à un arrêt réussi et tirait
  // un vrai `process.exit(1)` 30 s plus tard, dans une autre suite (`--runInBand`).
  it.each([
    ['réussi', async () => undefined],
    [
      'en échec',
      async () => {
        throw new Error('close boom');
      },
    ],
  ])('arrêt %s : le minuteur de garde est annulé', async (_label, close) => {
    jest.useFakeTimers();
    const app = fakeApp(close);
    setupGracefulShutdown(app);

    handlers.get('SIGTERM')!();
    // Laisse `close()` puis `.then/.catch` s'exécuter (microtâches).
    for (let i = 0; i < 3; i++) await Promise.resolve();

    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(30_000);
    expect(exitSpy).toHaveBeenCalledTimes(1);
  });

  it('si le drainage dépasse 30 s : exit(1) forcé', () => {
    jest.useFakeTimers();
    const app = fakeApp(() => new Promise<void>(() => undefined)); // ne résout jamais
    setupGracefulShutdown(app);

    handlers.get('SIGTERM')!();
    jest.advanceTimersByTime(30_000);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
