import type { Prisma } from '@prisma/client';
import type { TenantClient } from '@infra/persistence/prisma/tenant-prisma.service';
import type { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';

/**
 * Socle de tous les repositories Prisma.
 * `this.db` renvoie la transaction courante si elle existe, sinon un client
 * scopé au tenant : le repository n'a jamais à s'en préoccuper.
 */
export abstract class BasePrismaRepository {
  protected constructor(private readonly tenantPrisma: TenantPrismaService) {}

  protected get db(): TenantClient {
    return this.tenantPrisma.client;
  }

  /**
   * À utiliser pour TOUT `$queryRaw` / `$executeRaw`. `this.db` ne pose pas
   * `app.current_tenant_id` sur le SQL brut : la RLS, fail-closed, renverrait
   * alors zéro ligne sans lever la moindre erreur.
   * Cf. `TenantPrismaService.runRawInTenantScope()`.
   */
  protected runRawInTenantScope<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.tenantPrisma.runRawInTenantScope(run);
  }
}
