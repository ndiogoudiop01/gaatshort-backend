import type { TenantContextService } from '../tenancy/context/tenant-context.service';
import type { TenantRegistryService } from '../tenancy/registry/tenant-registry.service';
import { TenantAwareJobService } from '../queue/tenant-aware-job.service';

describe('TenantAwareJobService', () => {
  it('enveloppe les données du job avec le tenant courant', () => {
    const tenantContext = { tenantId: 'tenant-1' } as unknown as TenantContextService;
    const service = new TenantAwareJobService(tenantContext, {} as TenantRegistryService);
    expect(service.wrap({ applicationId: 'app-1' })).toEqual({
      tenantId: 'tenant-1',
      data: { applicationId: 'app-1' },
    });
  });

  it('résout le tenant du job puis restaure son contexte avant d’exécuter le worker', async () => {
    const tenant = { tenantId: 'tenant-1', slug: 'gaatshort' };
    const resolve = jest.fn(async () => tenant);
    const runWith = jest.fn((_t: unknown, fn: () => Promise<unknown>) => fn());
    const tenantContext = { runWith } as unknown as TenantContextService;
    const registry = { resolve } as unknown as TenantRegistryService;
    const service = new TenantAwareJobService(tenantContext, registry);

    const result = await service.runInTenant('tenant-1', async () => 'done');

    expect(resolve).toHaveBeenCalledWith('tenant-1');
    expect(runWith).toHaveBeenCalledWith(tenant, expect.any(Function));
    expect(result).toBe('done');
  });
});
