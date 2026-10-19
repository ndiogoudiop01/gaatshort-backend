import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, throwError } from 'rxjs';
import { PaginatedResult } from '@shared/kernel/application/pagination';
import type { TenantContextPort } from '@shared/kernel/ports/tenant-context.port';
import { LoggingInterceptor } from '../interceptors/logging.interceptor';
import { RAW_RESPONSE_KEY, ResponseEnvelopeInterceptor } from '../interceptors/response-envelope.interceptor';
import { RawResponse } from '../decorators/raw-response.decorator';

function fakeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('LoggingInterceptor', () => {
  it('journalise une réponse réussie avec la route, le tenant et l’utilisateur', async () => {
    const tenantContext = { getOrNull: () => ({ tenantId: 'tenant-1' }) } as unknown as TenantContextPort;
    const interceptor = new LoggingInterceptor(tenantContext);
    const request = { method: 'GET', url: '/x', id: 'req-1', user: { id: 'user-1' }, route: { path: '/x/:id' } };

    const result = await new Promise((resolve) =>
      interceptor.intercept(fakeContext(request), { handle: () => of('ok') }).subscribe(resolve),
    );

    expect(result).toBe('ok');
  });

  it('journalise une erreur sans faire échouer le flux', async () => {
    const tenantContext = { getOrNull: () => null } as unknown as TenantContextPort;
    const interceptor = new LoggingInterceptor(tenantContext);
    const request = { method: 'POST', url: '/x' };

    await expect(
      new Promise((_, reject) =>
        interceptor
          .intercept(fakeContext(request), { handle: () => throwError(() => new Error('boom')) })
          .subscribe({ error: reject }),
      ),
    ).rejects.toThrow('boom');
  });
});

describe('ResponseEnvelopeInterceptor', () => {
  it('laisse passer une réponse marquée « brute »', async () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const interceptor = new ResponseEnvelopeInterceptor(reflector);
    const result = await new Promise((resolve) =>
      interceptor.intercept(fakeContext({}), { handle: () => of('raw-payload') }).subscribe(resolve),
    );
    expect(result).toBe('raw-payload');
  });

  it('enveloppe une réponse simple dans le format standard', async () => {
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
    const interceptor = new ResponseEnvelopeInterceptor(reflector);
    const request = { id: 'req-1' };

    const value = await new Promise((resolve) =>
      interceptor.intercept(fakeContext(request), { handle: () => of({ id: 'x' }) }).subscribe(resolve),
    );
    const result = value as { success: boolean; data: unknown; requestId: string };

    expect(result).toMatchObject({ success: true, data: { id: 'x' }, requestId: 'req-1' });
  });

  it('déplie un résultat paginé en data + meta', async () => {
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
    const interceptor = new ResponseEnvelopeInterceptor(reflector);
    const page = PaginatedResult.offset(['a', 'b'], 2, 1, 20);

    const value = await new Promise((resolve) =>
      interceptor.intercept(fakeContext({}), { handle: () => of(page) }).subscribe(resolve),
    );
    const result = value as { data: unknown; meta: unknown };

    expect(result.data).toEqual(['a', 'b']);
    expect(result.meta).toEqual(page.meta);
  });

  it('déplie aussi un résultat paginé qui a perdu son prototype (cache Redis)', async () => {
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
    const interceptor = new ResponseEnvelopeInterceptor(reflector);
    // Ce que renvoie RedisCacheService.remember sur un cache hit : JSON.parse
    // d'un PaginatedResult, donc un objet nu.
    const deserialized = JSON.parse(JSON.stringify(PaginatedResult.offset(['a', 'b'], 2, 1, 20)));

    const value = await new Promise((resolve) =>
      interceptor.intercept(fakeContext({}), { handle: () => of(deserialized) }).subscribe(resolve),
    );
    const result = value as { data: unknown; meta: unknown };

    expect(result.data).toEqual(['a', 'b']);
    expect(result.meta).toMatchObject({ total: 2, hasMore: false });
  });

  it('n’emballe pas comme paginée une réponse métier qui a items sans meta.hasMore', async () => {
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
    const interceptor = new ResponseEnvelopeInterceptor(reflector);
    const payload = { items: [1, 2], meta: { note: 'pas une pagination' } };

    const value = await new Promise((resolve) =>
      interceptor.intercept(fakeContext({}), { handle: () => of(payload) }).subscribe(resolve),
    );
    const result = value as { data: unknown; meta?: unknown };

    expect(result.data).toEqual(payload);
    expect(result.meta).toBeUndefined();
  });

  it('renvoie null comme identifiant de requête quand il est absent', async () => {
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
    const interceptor = new ResponseEnvelopeInterceptor(reflector);
    const value = await new Promise((resolve) =>
      interceptor.intercept(fakeContext({}), { handle: () => of('x') }).subscribe(resolve),
    );
    const result = value as { requestId: string | null };
    expect(result.requestId).toBeNull();
  });

  it('exporte la clé de métadonnées utilisée par le décorateur RawResponse', () => {
    expect(RAW_RESPONSE_KEY).toBe('http:rawResponse');
  });

  it('@RawResponse() écrit la clé RAW_RESPONSE_KEY (= true) sur le handler', () => {
    const handler = jest.fn(() => 'binaire');
    // On applique le décorateur à la main sur une fonction nue (pas de méthode
    // de classe → pas de piège `this`).
    const decorate = RawResponse() as (t: object, k: string, d: PropertyDescriptor) => void;
    decorate({}, 'download', { value: handler });

    const reflector = new Reflector();
    expect(reflector.get(RAW_RESPONSE_KEY, handler)).toBe(true);
  });

  it('l’intercepteur n’emballe pas quand la clé « brute » est posée', async () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const interceptor = new ResponseEnvelopeInterceptor(reflector);
    const value = await new Promise((resolve) =>
      interceptor.intercept(fakeContext({ id: 'r' }), { handle: () => of('binaire') }).subscribe(resolve),
    );
    expect(value).toBe('binaire'); // pas d'enveloppe { success, data, … }
  });
});
