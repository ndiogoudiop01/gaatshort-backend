import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppConfigService } from '@config/app-config.service';
import { CACHE, type CachePort } from '@shared/kernel/ports/cache.port';
import type { TenantContextData } from '@shared/kernel/ports/tenant-context.port';
import { PrismaService } from '@infra/persistence/prisma/prisma.service';
import { TenantNotFoundError, TenantSuspendedError } from '../tenancy.errors';

/**
 * Annuaire des tenants (slug | domaine | id → contexte), mis en cache Redis.
 *
 * Sans ce cache, chaque requête HTTP paierait un aller-retour Postgres AVANT
 * même de commencer son travail : c'est le premier goulot d'étranglement d'une
 * architecture multi-tenant. TTL court + invalidation explicite à l'écriture.
 */
@Injectable()
export class TenantRegistryService {
  private readonly logger = new Logger(TenantRegistryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Inject(CACHE) private readonly cache: CachePort,
  ) {}

  public async resolve(identifier: string): Promise<TenantContextData> {
    const key = `tenant:lookup:${identifier}`;
    const ttl = this.config.tenancy.cacheTtlSeconds;

    const tenant = await this.cache.remember(key, ttl, async () => {
      // `{ id: undefined }` dans un `OR` est ambigu selon les versions de Prisma —
      // on ne l'ajoute que si l'identifiant est réellement un UUID.
      const or: Prisma.TenantWhereInput[] = [
        { slug: identifier },
        { domains: { some: { domain: identifier } } },
      ];
      if (this.isUuid(identifier)) or.push({ id: identifier });

      const record = await this.prisma.$privileged((tx) =>
        tx.tenant.findFirst({ where: { deletedAt: null, OR: or } }),
      );
      if (!record) throw new TenantNotFoundError(identifier);
      return record;
    });

    if (tenant.status === 'SUSPENDED' || tenant.status === 'ARCHIVED') {
      throw new TenantSuspendedError(tenant.slug);
    }

    return {
      tenantId: tenant.id,
      slug: tenant.slug,
      isolation: tenant.isolation,
      schemaName: tenant.schemaName ?? undefined,
      defaultLocale: tenant.defaultLocale,
      defaultCountry: tenant.defaultCountry,
      defaultCurrency: tenant.defaultCurrency,
      timezone: tenant.timezone,
      featureFlags: (tenant.featureFlags ?? {}) as Record<string, boolean>,
    };
  }

  /** Appelé après toute mutation d'un tenant (settings, domaines, statut). */
  public async invalidate(tenantId: string, slug: string, domains: string[] = []): Promise<void> {
    await Promise.all([
      this.cache.del(`tenant:lookup:${tenantId}`),
      this.cache.del(`tenant:lookup:${slug}`),
      ...domains.map((d) => this.cache.del(`tenant:lookup:${d}`)),
    ]);
    this.logger.log(`Cache tenant invalidé : ${slug}`);
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }
}
