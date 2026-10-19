import { RequestTimeoutException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { delay } from 'rxjs/operators';
import { TimeoutInterceptor } from '../interceptors/timeout.interceptor';

describe('TimeoutInterceptor', () => {
  it('laisse passer une réponse rapide', async () => {
    const interceptor = new TimeoutInterceptor(50);
    const result = await new Promise((resolve) =>
      interceptor.intercept({} as never, { handle: () => of('ok') }).subscribe(resolve),
    );
    expect(result).toBe('ok');
  });

  it('convertit un dépassement de délai en RequestTimeoutException', async () => {
    const interceptor = new TimeoutInterceptor(20);
    const observable = interceptor.intercept({} as never, { handle: () => of('trop-tard').pipe(delay(100)) });

    await expect(
      new Promise((_, reject) => observable.subscribe({ error: reject })),
    ).rejects.toBeInstanceOf(RequestTimeoutException);
  });

  it('propage telle quelle une erreur qui n’est pas un dépassement de délai', async () => {
    const interceptor = new TimeoutInterceptor(1000);
    const observable = interceptor.intercept({} as never, {
      handle: () => throwError(() => new Error('échec applicatif')),
    });

    await expect(new Promise((_, reject) => observable.subscribe({ error: reject }))).rejects.toThrow(
      'échec applicatif',
    );
  });
});
