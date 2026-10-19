import type { ExecutionContext } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { of } from 'rxjs';
import type { TenantContextPort } from '@shared/kernel/ports/tenant-context.port';
import { LogCorrelationInterceptor } from '../observability/logger/log-correlation.interceptor';

function fakeContext(request: Record<string, unknown>, type: string | undefined = 'http'): ExecutionContext {
  return {
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const run = (interceptor: LogCorrelationInterceptor, ctx: ExecutionContext) =>
  new Promise((resolve) => interceptor.intercept(ctx, { handle: () => of('ok') }).subscribe(resolve));

describe('LogCorrelationInterceptor', () => {
  it('attache requestId + tenantId + userId au logger de la requête', async () => {
    const assign = jest.fn();
    const tenantContext = { getOrNull: () => ({ tenantId: 'tenant-42' }) } as unknown as TenantContextPort;
    const interceptor = new LogCorrelationInterceptor({ assign } as unknown as PinoLogger, tenantContext);

    const result = await run(
      interceptor,
      fakeContext({ id: 'req-7', user: { id: 'user-9' } }),
    );

    expect(result).toBe('ok');
    expect(assign).toHaveBeenCalledWith({ requestId: 'req-7', tenantId: 'tenant-42', userId: 'user-9' });
  });

  it('reste silencieux hors contexte tenant / hors authentification', async () => {
    const assign = jest.fn();
    const tenantContext = { getOrNull: () => null } as unknown as TenantContextPort;
    const interceptor = new LogCorrelationInterceptor({ assign } as unknown as PinoLogger, tenantContext);

    await run(interceptor, fakeContext({ id: 'req-8' }));

    expect(assign).toHaveBeenCalledWith({ requestId: 'req-8', tenantId: undefined, userId: undefined });
  });

  it('ne touche pas au logger pour un contexte non HTTP', async () => {
    const assign = jest.fn();
    const interceptor = new LogCorrelationInterceptor(
      { assign } as unknown as PinoLogger,
      { getOrNull: () => null } as unknown as TenantContextPort,
    );

    await run(interceptor, fakeContext({}, 'rpc'));

    expect(assign).not.toHaveBeenCalled();
  });
});
