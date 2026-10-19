import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import type { PrismaService } from '@infra/persistence/prisma/prisma.service';
import type { TenantContextService } from '../tenancy/context/tenant-context.service';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor';

function fakeContext(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as never;
}

function fakeHandler(response: unknown = 'ok') {
  return { handle: () => of(response) };
}

function buildInterceptor(
  meta: { ttlSeconds: number } | undefined,
  prisma: Record<string, unknown>,
) {
  const reflector = { getAllAndOverride: () => meta } as unknown as Reflector;
  const tenantContext = { tenantId: 'tenant-1' } as unknown as TenantContextService;
  return new IdempotencyInterceptor(reflector, prisma as unknown as PrismaService, tenantContext);
}

describe('IdempotencyInterceptor', () => {
  it('laisse passer les routes non marquées @Idempotent', async () => {
    const interceptor = buildInterceptor(undefined, {});
    const handler = fakeHandler('untouched');
    const result = await interceptor.intercept(fakeContext({}), handler);
    const value = await new Promise((resolve) => result.subscribe(resolve));
    expect(value).toBe('untouched');
  });

  it('exige un en-tête idempotency-key valide', async () => {
    const interceptor = buildInterceptor({ ttlSeconds: 3600 }, {});
    await expect(
      interceptor.intercept(fakeContext({ headers: {}, method: 'POST', url: '/x' }), fakeHandler()),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejoue la réponse déjà enregistrée pour une clé déjà traitée', async () => {
    // Le hash doit correspondre à celui que l'intercepteur dérive du corps de la requête.
    const request = { headers: { 'idempotency-key': 'abcdefgh' }, method: 'POST', url: '/x', body: {} };
    const crypto = await import('node:crypto');
    const hash = crypto.createHash('sha256').update(JSON.stringify({})).digest('hex');
    const idempotencyKey = {
      findUnique: async () => ({ requestHash: hash, completedAt: new Date(), responseBody: { ok: true } }),
    };

    const interceptor = buildInterceptor({ ttlSeconds: 3600 }, { idempotencyKey });
    const observable = await interceptor.intercept(fakeContext(request), fakeHandler());
    const value = await new Promise((resolve) => observable.subscribe(resolve));
    expect(value).toEqual({ ok: true });
  });

  it('refuse la réutilisation d’une clé avec un contenu différent', async () => {
    const idempotencyKey = {
      findUnique: async () => ({ requestHash: 'un-autre-hash', completedAt: new Date(), responseBody: {} }),
    };
    const interceptor = buildInterceptor({ ttlSeconds: 3600 }, { idempotencyKey });
    await expect(
      interceptor.intercept(
        fakeContext({ headers: { 'idempotency-key': 'abcdefgh' }, method: 'POST', url: '/x', body: {} }),
        fakeHandler(),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('refuse une requête identique déjà en cours de traitement', async () => {
    const crypto = await import('node:crypto');
    const hash = crypto.createHash('sha256').update(JSON.stringify({})).digest('hex');
    const idempotencyKey = { findUnique: async () => ({ requestHash: hash, completedAt: null }) };
    const interceptor = buildInterceptor({ ttlSeconds: 3600 }, { idempotencyKey });
    await expect(
      interceptor.intercept(
        fakeContext({ headers: { 'idempotency-key': 'abcdefgh' }, method: 'POST', url: '/x', body: {} }),
        fakeHandler(),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('crée la clé puis laisse passer une nouvelle requête', async () => {
    const create = jest.fn(async () => undefined);
    const idempotencyKey = { findUnique: async () => null, create };
    const interceptor = buildInterceptor({ ttlSeconds: 3600 }, { idempotencyKey });

    await interceptor.intercept(
      fakeContext({ headers: { 'idempotency-key': 'abcdefgh' }, method: 'POST', url: '/x', body: {} }),
      fakeHandler({ ok: true }),
    );

    expect(create).toHaveBeenCalledTimes(1);
  });
});
