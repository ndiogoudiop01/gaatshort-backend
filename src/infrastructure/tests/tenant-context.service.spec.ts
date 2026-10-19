import { MissingTenantContextError } from '../tenancy/tenancy.errors';
import { TenantContextService } from '../tenancy/context/tenant-context.service';

const TENANT = {
  tenantId: 'tenant-1',
  slug: 'gaatshort',
  isolation: 'SHARED_RLS' as const,
  defaultLocale: 'fr',
  defaultCountry: 'SN',
  defaultCurrency: 'XOF',
  timezone: 'Africa/Dakar',
  featureFlags: {},
};

describe('TenantContextService', () => {
  it('lève une erreur explicite hors de tout contexte', () => {
    const service = new TenantContextService();
    expect(() => service.get()).toThrow(MissingTenantContextError);
    expect(service.getOrNull()).toBeNull();
  });

  it('expose le tenant courant à l’intérieur de runWith', async () => {
    const service = new TenantContextService();
    await service.runWith(TENANT, async () => {
      expect(service.get()).toEqual(TENANT);
      expect(service.tenantId).toBe('tenant-1');
    });
  });

  it('ne fuit pas le contexte en dehors de runWith', async () => {
    const service = new TenantContextService();
    await service.runWith(TENANT, async () => undefined);
    expect(service.getOrNull()).toBeNull();
  });

  it('isole les contextes de deux exécutions concurrentes', async () => {
    const service = new TenantContextService();
    const other = { ...TENANT, tenantId: 'tenant-2' };

    const [a, b] = await Promise.all([
      service.runWith(TENANT, async () => {
        await new Promise((r) => setTimeout(r, 10));
        return service.tenantId;
      }),
      service.runWith(other, async () => service.tenantId),
    ]);

    expect(a).toBe('tenant-1');
    expect(b).toBe('tenant-2');
  });

  it('runPrivileged s’exécute hors tenant mais marque le mode privilégié', async () => {
    const service = new TenantContextService();
    await service.runPrivileged('purge RGPD', async () => {
      expect(service.isPrivileged()).toBe(true);
      expect(service.privilegeReason).toBe('purge RGPD');
      expect(service.getOrNull()).toBeNull();
    });
  });

  it('n’est pas privilégié par défaut', async () => {
    const service = new TenantContextService();
    await service.runWith(TENANT, async () => {
      expect(service.isPrivileged()).toBe(false);
    });
  });
});
