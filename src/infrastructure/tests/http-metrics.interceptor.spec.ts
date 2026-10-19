import type { ExecutionContext } from '@nestjs/common';
import { type Observable, of, throwError } from 'rxjs';
import { MetricsService } from '../observability/metrics/metrics.service';
import { HttpMetricsInterceptor } from '../observability/metrics/http-metrics.interceptor';

function fakeContext(
  request: Record<string, unknown>,
  response: Record<string, unknown> = { statusCode: 200 },
  type: string | undefined = 'http',
): ExecutionContext {
  return {
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
}

const drain = (obs: Observable<unknown>): Promise<unknown> =>
  new Promise((resolve, reject) =>
    obs.subscribe({ next: resolve, error: reject, complete: () => resolve(undefined) }),
  );

describe('HttpMetricsInterceptor', () => {
  it('mesure avec le PATRON de route, jamais l’URL réelle (cardinalité)', async () => {
    const metrics = new MetricsService();
    const interceptor = new HttpMetricsInterceptor(metrics);
    const ctx = fakeContext(
      { method: 'GET', url: '/api/v1/users/6f3c1b2a-0000-4000-8000-000000000000', route: { path: '/users/:id' }, baseUrl: '/api/v1' },
      { statusCode: 200 },
    );

    await drain(interceptor.intercept(ctx, { handle: () => of('ok') }));

    const snapshot = await metrics.scrape();
    expect(snapshot).toContain('route="/api/v1/users/:id"');
    expect(snapshot).not.toContain('000000000000');
  });

  it('n’ajoute jamais de label tenant sur la métrique HTTP', async () => {
    const metrics = new MetricsService();
    const interceptor = new HttpMetricsInterceptor(metrics);
    const ctx = fakeContext(
      { method: 'GET', url: '/api/v1/things', route: { path: '/things' }, baseUrl: '/api/v1' },
      { statusCode: 200 },
    );

    await drain(interceptor.intercept(ctx, { handle: () => of('ok') }));

    const sample = (await metrics.scrape())
      .split('\n')
      .find((l) => l.startsWith('http_request_duration_seconds_count'));
    expect(sample).toBeDefined();
    expect(sample).toContain('method="GET"');
    expect(sample).toContain('route="/api/v1/things"');
    expect(sample).toContain('status="200"');
    expect(sample).not.toMatch(/tenant/i);
  });

  it('enregistre le statut 500 quand le handler échoue', async () => {
    const metrics = new MetricsService();
    const interceptor = new HttpMetricsInterceptor(metrics);
    const ctx = fakeContext({ method: 'POST', url: '/api/v1/things', route: { path: '/things' }, baseUrl: '/api/v1' });

    await expect(
      drain(interceptor.intercept(ctx, { handle: () => throwError(() => ({ status: 500 })) })),
    ).rejects.toBeDefined();

    const snapshot = await metrics.scrape();
    expect(snapshot).toMatch(/http_request_duration_seconds_count\{[^}]*status="500"[^}]*\}/);
  });

  it('ne mesure pas les sondes ni le scrape Prometheus', async () => {
    const metrics = new MetricsService();
    const interceptor = new HttpMetricsInterceptor(metrics);
    const ctx = fakeContext({ method: 'GET', url: '/health/ready', path: '/health/ready' });

    await drain(interceptor.intercept(ctx, { handle: () => of('ok') }));

    expect(await metrics.scrape()).not.toContain('http_request_duration_seconds_count');
  });

  it('laisse passer un contexte non HTTP sans rien mesurer', async () => {
    const metrics = new MetricsService();
    const interceptor = new HttpMetricsInterceptor(metrics);

    const result = await drain(
      interceptor.intercept(fakeContext({}, {}, 'rpc'), { handle: () => of('passthrough') }),
    );

    expect(result).toBe('passthrough');
    expect(await metrics.scrape()).not.toContain('http_request_duration_seconds_count');
  });
});
