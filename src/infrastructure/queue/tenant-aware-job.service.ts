import { Injectable } from '@nestjs/common';
import { TenantContextService } from '@infra/tenancy/context/tenant-context.service';
import { TenantRegistryService } from '@infra/tenancy/registry/tenant-registry.service';

export interface TenantJobPayload<T = unknown> {
  readonly tenantId: string;
  readonly correlationId?: string;
  readonly data: T;
}

/**
 * Un worker n'a pas de requête HTTP, donc pas de sous-domaine ni de JWT :
 * le tenant DOIT voyager dans le payload du job, et le contexte être
 * reconstruit avant tout accès base. Sans ça, le worker écrit hors RLS
 * ou plante — c'est le piège numéro un des architectures multi-tenant.
 */
@Injectable()
export class TenantAwareJobService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly registry: TenantRegistryService,
  ) {}

  public wrap<T>(data: T): TenantJobPayload<T> {
    return { tenantId: this.tenantContext.tenantId, data };
  }

  public async runInTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const tenant = await this.registry.resolve(tenantId);
    return this.tenantContext.runWith(tenant, fn);
  }
}
