import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { AppConfigService } from '@config/app-config.service';
import type { TenantContextService } from '../tenancy/context/tenant-context.service';
import type { TenantRegistryService } from '../tenancy/registry/tenant-registry.service';
import type { TenantResolver } from '../tenancy/resolvers/tenant-resolver.interface';
import { TenantMiddleware } from '../tenancy/middleware/tenant.middleware';
import { TenantNotFoundError } from '../tenancy/tenancy.errors';

const TENANT = { tenantId: 'tenant-1', slug: 'gaatshort' };

/** Annuaire à deux tenants, joignables par UUID ou par slug. */
const DIRECTORY: Record<string, { tenantId: string; slug: string }> = {
  'tenant-1': TENANT,
  'gaatshort': TENANT,
  'tenant-2': { tenantId: 'tenant-2', slug: 'autre-tenant' },
  'autre-tenant': { tenantId: 'tenant-2', slug: 'autre-tenant' },
};
const directory: Partial<TenantRegistryService> = {
  resolve: async (identifier: string) => {
    const tenant = DIRECTORY[identifier];
    if (!tenant) throw new TenantNotFoundError(identifier);
    return tenant as never;
  },
};

function resolver(name: string, value: string | null): TenantResolver {
  return { name, resolve: () => value };
}

function buildMiddleware(
  resolvers: TenantResolver[],
  configOverrides: Partial<AppConfigService['tenancy']> = {},
  registryOverrides: Partial<TenantRegistryService> = {},
) {
  const context = { runWith: (_t: unknown, fn: () => Promise<void>) => fn() } as unknown as TenantContextService;
  const registry = { resolve: async () => TENANT, ...registryOverrides } as unknown as TenantRegistryService;
  const config = {
    tenancy: { resolvers: resolvers.map((r) => r.name), allowAnonymousFallback: false, ...configOverrides },
  } as unknown as AppConfigService;
  return new TenantMiddleware(context, registry, config, resolvers);
}

function fakeRes(setHeader = jest.fn()): Response {
  return { setHeader } as unknown as Response;
}

describe('TenantMiddleware', () => {
  it('résout le tenant depuis le premier résolveur qui répond', async () => {
    const middleware = buildMiddleware([resolver('header', 'gaatshort')]);
    const setHeader = jest.fn();
    const res = fakeRes(setHeader);
    const next = jest.fn() as NextFunction;

    await middleware.use({} as Request, res, next);

    expect(setHeader).toHaveBeenCalledWith('x-tenant', 'gaatshort');
    expect(next).toHaveBeenCalledWith();
  });

  it('refuse quand le tenant du JWT diverge de l’en-tête (tentative de traversée) et journalise en warn', async () => {
    const middleware = buildMiddleware(
      [resolver('jwt', 'tenant-1'), resolver('header', 'autre-tenant')],
      {},
      directory,
    );
    const next = jest.fn();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await middleware.use({ headers: {} } as Request, fakeRes(), next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(TenantNotFoundError));
    // Critère d'acceptation : un conflit inter-résolveurs produit un log de niveau warn.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('traversée de tenant'));

    warn.mockRestore();
  });

  it('accepte un en-tête qui confirme le tenant du JWT', async () => {
    const middleware = buildMiddleware([resolver('jwt', 'tenant-1'), resolver('header', 'tenant-1')]);
    const next = jest.fn();

    await middleware.use({} as Request, fakeRes(), next as NextFunction);

    expect(next).toHaveBeenCalledWith();
  });

  it('accepte le slug en en-tête quand le JWT porte l’UUID du même tenant', async () => {
    const middleware = buildMiddleware([resolver('jwt', 'tenant-1'), resolver('header', 'gaatshort')], {}, directory);
    const next = jest.fn();

    await middleware.use({} as Request, fakeRes(), next as NextFunction);

    expect(next).toHaveBeenCalledWith();
  });

  it('refuse un en-tête qui ne désigne aucun tenant quand un JWT est présent', async () => {
    const middleware = buildMiddleware([resolver('jwt', 'tenant-1'), resolver('header', 'inconnu')], {}, directory);
    const next = jest.fn();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await middleware.use({} as Request, fakeRes(), next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(TenantNotFoundError));
    warn.mockRestore();
  });

  it('retombe sur le tenant par défaut si autorisé et aucun identifiant fourni', async () => {
    const middleware = buildMiddleware([resolver('header', null)], {
      allowAnonymousFallback: true,
      defaultSlug: 'gaatshort',
    });
    const next = jest.fn();

    await middleware.use({} as Request, fakeRes(), next as NextFunction);

    expect(next).toHaveBeenCalledWith();
  });

  it('refuse la requête sans identifiant et sans repli anonyme autorisé', async () => {
    const middleware = buildMiddleware([resolver('header', null)], { allowAnonymousFallback: false });
    const next = jest.fn();

    await middleware.use({} as Request, fakeRes(), next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(TenantNotFoundError));
  });

  it('transmet au middleware suivant l’erreur levée par l’annuaire des tenants', async () => {
    const middleware = buildMiddleware([resolver('header', 'tenant-suspendu')], {}, {
      resolve: async () => {
        throw new TenantNotFoundError('tenant-suspendu');
      },
    });
    const next = jest.fn();

    await middleware.use({} as Request, fakeRes(), next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(TenantNotFoundError));
  });
});
