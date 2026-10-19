import { passThroughCache } from '@shared/tests/test-utils/pass-through-cache';
import type { AppConfigService } from '@config/app-config.service';
import type { PrismaService } from '@infra/persistence/prisma/prisma.service';
import { TenantRegistryService } from '../tenancy/registry/tenant-registry.service';
import { TenantNotFoundError, TenantSuspendedError } from '../tenancy/tenancy.errors';

const ACTIVE_TENANT = {
  id: 'tenant-1',
  slug: 'gaatshort',
  isolation: 'SHARED_RLS',
  schemaName: null,
  defaultLocale: 'fr',
  defaultCountry: 'SN',
  defaultCurrency: 'XOF',
  timezone: 'Africa/Dakar',
  featureFlags: { simulator: true },
  status: 'ACTIVE',
};

function fakePrisma(findFirst: () => Promise<typeof ACTIVE_TENANT | null>): PrismaService {
  return { $privileged: (fn: (tx: unknown) => unknown) => fn({ tenant: { findFirst } }) } as unknown as PrismaService;
}

const CONFIG = { tenancy: { cacheTtlSeconds: 60 } } as unknown as AppConfigService;

describe('TenantRegistryService', () => {
  it('résout un tenant actif par son slug', async () => {
    const service = new TenantRegistryService(fakePrisma(async () => ACTIVE_TENANT), CONFIG, passThroughCache());
    const result = await service.resolve('gaatshort');
    expect(result.tenantId).toBe('tenant-1');
    expect(result.featureFlags).toEqual({ simulator: true });
  });

  it('lève une erreur quand aucun tenant ne correspond', async () => {
    const service = new TenantRegistryService(fakePrisma(async () => null), CONFIG, passThroughCache());
    await expect(service.resolve('inconnu')).rejects.toThrow(TenantNotFoundError);
  });

  it('refuse un tenant suspendu', async () => {
    const service = new TenantRegistryService(
      fakePrisma(async () => ({ ...ACTIVE_TENANT, status: 'SUSPENDED' })),
      CONFIG,
      passThroughCache(),
    );
    await expect(service.resolve('gaatshort')).rejects.toThrow(TenantSuspendedError);
  });

  it('refuse un tenant archivé', async () => {
    const service = new TenantRegistryService(
      fakePrisma(async () => ({ ...ACTIVE_TENANT, status: 'ARCHIVED' })),
      CONFIG,
      passThroughCache(),
    );
    await expect(service.resolve('gaatshort')).rejects.toThrow(TenantSuspendedError);
  });

  it('invalide le cache du tenant, de son slug et de ses domaines', async () => {
    const del = jest.fn(async () => undefined);
    const service = new TenantRegistryService(fakePrisma(async () => ACTIVE_TENANT), CONFIG, {
      ...passThroughCache(),
      del,
    });

    await service.invalidate('tenant-1', 'gaatshort', ['kaay.gaatshort.com']);

    expect(del).toHaveBeenCalledTimes(3);
  });
});
