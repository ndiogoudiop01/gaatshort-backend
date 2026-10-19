import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PaginatedResult } from '@shared/kernel/application/pagination';
import { BusinessRuleViolationError, ResourceNotFoundError } from '@shared/kernel/errors/domain.error';
import { PrismaService } from '@infra/persistence/prisma/prisma.service';
import { TenantRegistryService } from '@infra/tenancy/registry/tenant-registry.service';
import { TENANT_DATA_INVENTORY, type TenantDataInventoryPort } from '../domain/ports/tenant-data-inventory.port';
import {
  TenantAdminRules,
  TenantLifecycleRules,
  type TenantCreateInput,
  type TenantPatch,
  type TenantStatusValue,
} from '../domain/services/tenant-admin-rules';

export interface TenantCriteria {
  readonly statuses?: readonly TenantStatusValue[];
  readonly search?: string;
  readonly page: number;
  readonly perPage: number;
  readonly sortBy?: 'name' | 'slug' | 'status' | 'createdAt' | 'updatedAt';
  readonly sortDir: 'asc' | 'desc';
}

/** Ce que l'écran affiche. Jamais `schemaName` ni `settings` (infrastructure). */
const TENANT_SELECT = {
  id: true,
  slug: true,
  name: true,
  legalName: true,
  status: true,
  isolation: true,
  defaultLocale: true,
  defaultCountry: true,
  defaultCurrency: true,
  timezone: true,
  branding: true,
  featureFlags: true,
  createdAt: true,
  updatedAt: true,
  domains: { select: { domain: true, isPrimary: true, verifiedAt: true }, orderBy: { domain: 'asc' } },
  _count: { select: { users: true } },
} satisfies Prisma.TenantSelect;

type TenantRow = Prisma.TenantGetPayload<{ select: typeof TENANT_SELECT }>;

/**
 * BSG-13 — administration des tenants (SUPER_ADMIN, `@RequireRoles`).
 *
 * `$privileged()` est justifié ici et SEULEMENT ici : lister ou modifier un
 * tenant, c'est par définition sortir du tenant courant. La contrepartie est
 * une écriture strictement bornée (DTO whitelist + `toTenantUpdate` champ par
 * champ) et tracée (`audit_logs` du tenant modifié).
 */
@Injectable()
export class AdminTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: TenantRegistryService,
    @Inject(TENANT_DATA_INVENTORY)
    private readonly inventory: TenantDataInventoryPort<Prisma.TransactionClient>,
  ) {}

  /** Inventaire + suppression : plus long qu'une écriture ordinaire (une requête par table). */
  private static readonly LIFECYCLE_TX = { timeout: 15_000 } as const;

  public async list(callerTenantId: string, criteria: TenantCriteria) {
    const where: Prisma.TenantWhereInput = {
      deletedAt: null,
      ...(criteria.statuses?.length ? { status: { in: [...criteria.statuses] } } : {}),
      ...(criteria.search
        ? {
            OR: [
              { name: { contains: criteria.search, mode: 'insensitive' } },
              { legalName: { contains: criteria.search, mode: 'insensitive' } },
              { slug: { contains: criteria.search.toLowerCase() } },
            ],
          }
        : {}),
    };
    // Tous les champs de tri sont NON nullables : `{ champ: sens }` suffit
    // (Prisma refuse `{ sort, nulls }` sur une colonne obligatoire).
    const [rows, total] = await this.prisma.$privileged((tx) =>
      Promise.all([
        tx.tenant.findMany({
          where,
          select: TENANT_SELECT,
          orderBy: [{ [criteria.sortBy ?? 'name']: criteria.sortDir }, { id: 'asc' }],
          skip: (criteria.page - 1) * criteria.perPage,
          take: criteria.perPage,
        }),
        tx.tenant.count({ where }),
      ]),
    );
    return PaginatedResult.offset(
      rows.map((row) => this.present(row, callerTenantId)),
      total,
      criteria.page,
      criteria.perPage,
    );
  }

  public async detail(callerTenantId: string, id: string) {
    const row = await this.prisma.$privileged((tx) =>
      tx.tenant.findFirst({ where: { id, deletedAt: null }, select: TENANT_SELECT }),
    );
    if (!row) throw new ResourceNotFoundError('Organisation', id);
    return this.present(row, callerTenantId);
  }

  /** Pays et devises actifs : les seules valeurs acceptées par défaut. */
  public async reference() {
    const [countries, currencies] = await this.prisma.$privileged((tx) =>
      Promise.all([
        tx.country.findMany({ where: { isActive: true }, orderBy: { nameFr: 'asc' } }),
        tx.currency.findMany({ orderBy: { code: 'asc' } }),
      ]),
    );
    return {
      countries: countries.map((c) => ({ code: c.code, name: c.nameFr, flag: c.flagEmoji, currencyCode: c.currencyCode })),
      currencies: currencies.map((c) => ({ code: c.code, name: c.name, symbol: c.symbol })),
    };
  }

  public async update(caller: { tenantId: string; userId: string }, id: string, patch: TenantPatch) {
    TenantAdminRules.assertNotEmpty(patch);
    if (patch.timezone !== undefined && !TenantAdminRules.isValidTimezone(patch.timezone)) {
      throw new BusinessRuleViolationError('TENANT_INVALID', 'Fuseau horaire inconnu', {
        issues: [`timezone: « ${patch.timezone} » n'est pas un fuseau IANA (ex. Africa/Dakar)`],
      });
    }

    const updated = await this.prisma.$privileged(async (tx) => {
      const current = await tx.tenant.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw new ResourceNotFoundError('Organisation', id);
      TenantAdminRules.assertNotSelfLockout(caller.tenantId, current, patch);

      const issues: string[] = [];
      if (patch.defaultCountry && !(await tx.country.findFirst({ where: { code: patch.defaultCountry, isActive: true } }))) {
        issues.push(`defaultCountry: « ${patch.defaultCountry} » n'est pas un pays actif`);
      }
      if (patch.defaultCurrency && !(await tx.currency.findUnique({ where: { code: patch.defaultCurrency } }))) {
        issues.push(`defaultCurrency: « ${patch.defaultCurrency} » n'est pas une devise connue`);
      }
      if (issues.length) throw new BusinessRuleViolationError('TENANT_INVALID', 'Référence inconnue', { issues });

      const data = TenantAdminRules.toTenantUpdate(current, patch);
      const row = await tx.tenant.update({ where: { id }, data, select: TENANT_SELECT });

      // Trace dans le tenant MODIFIÉ : c'est là qu'on la cherchera.
      const before = Object.fromEntries(Object.keys(data).map((k) => [k, (current as Record<string, unknown>)[k]]));
      await tx.auditLog.create({
        data: {
          tenantId: id,
          actorId: caller.userId,
          action: 'tenant.updated',
          resourceType: 'Tenant',
          resourceId: id,
          before: before as Prisma.InputJsonValue,
          after: data as Prisma.InputJsonValue,
        },
      });
      return row;
    });

    // Sans invalidation, un tenant suspendu resterait servi pendant le TTL du cache.
    await this.registry.invalidate(updated.id, updated.slug, updated.domains.map((d) => d.domain));
    return this.present(updated, caller.tenantId);
  }

  /**
   * Crée une organisation (un pays = un tenant). Le slug est immuable ensuite.
   * Aucune donnée métier n'est provisionnée ici : consentements, pièces et
   * contenus se saisissent au back-office (ou via le seed pour les marchés
   * connus). Le tenant reste donc supprimable tant que rien n'y est saisi.
   */
  public async create(caller: { tenantId: string; userId: string }, input: TenantCreateInput) {
    TenantLifecycleRules.assertValidSlug(input.slug);
    const timezone = TenantLifecycleRules.resolveTimezone(input);
    const countries = TenantLifecycleRules.countriesToAttach(input);

    const created = await this.prisma.$privileged(async (tx) => {
      // Slug déjà pris, y compris par un tenant archivé logiquement : la contrainte
      // d'unicité ne distingue pas `deletedAt`, et un slug ne se recycle pas.
      if (await tx.tenant.findUnique({ where: { slug: input.slug }, select: { id: true } })) {
        throw new BusinessRuleViolationError('TENANT_SLUG_TAKEN', 'Cet identifiant est déjà utilisé', {
          issues: [`slug: « ${input.slug} » existe déjà`],
        });
      }

      const known = await tx.country.findMany({ where: { code: { in: countries }, isActive: true } });
      const issues = countries
        .filter((code) => !known.some((c) => c.code === code))
        .map((code) => `countries: « ${code} » n'est pas un pays actif`);
      const defaultCountry = known.find((c) => c.code === input.defaultCountry);
      const currency = input.defaultCurrency ?? defaultCountry?.currencyCode;
      if (currency && !(await tx.currency.findUnique({ where: { code: currency } }))) {
        issues.push(`defaultCurrency: « ${currency} » n'est pas une devise connue`);
      }
      if (issues.length || !currency) throw new BusinessRuleViolationError('TENANT_INVALID', 'Référence inconnue', { issues });

      const data = TenantLifecycleRules.toTenantCreate(input, { timezone, currency });
      const row = await tx.tenant.create({ data: data as Prisma.TenantCreateInput, select: TENANT_SELECT });
      await tx.tenantCountry.createMany({
        data: countries.map((countryCode) => ({
          tenantId: row.id,
          countryCode,
          isDefault: countryCode === input.defaultCountry,
        })),
      });

      // Trace dans le tenant CRÉÉ : c'est là qu'on la cherchera. `audit_logs`
      // est une table technique — elle n'empêche pas une suppression ultérieure.
      await tx.auditLog.create({
        data: {
          tenantId: row.id,
          actorId: caller.userId,
          action: 'tenant.created',
          resourceType: 'Tenant',
          resourceId: row.id,
          after: { ...data, countries, createdFromTenantId: caller.tenantId },
        },
      });
      return row;
    });

    await this.registry.invalidate(created.id, created.slug);
    return this.present(created, caller.tenantId);
  }

  /**
   * Ce que l'écran affiche avant de proposer « Supprimer » : supprimable ou
   * non, et pourquoi. Lecture seule — la vérification est REFAITE, sous
   * verrou, au moment de la suppression.
   */
  public async deletionCheck(callerTenantId: string, id: string) {
    return this.prisma.$privileged(async (tx) => {
      const tenant = await tx.tenant.findFirst({ where: { id, deletedAt: null }, select: { id: true, slug: true } });
      if (!tenant) throw new ResourceNotFoundError('Organisation', id);
      const tables = TenantLifecycleRules.businessTables(await this.inventory.tablesWithTenantColumn(tx));
      const blocking = await this.inventory.usage(tx, id, tables);
      const isCurrent = tenant.id === callerTenantId;
      return {
        id: tenant.id,
        slug: tenant.slug,
        deletable: !isCurrent && blocking.length === 0,
        isCurrent,
        blocking,
      };
    }, AdminTenantsService.LIFECYCLE_TX);
  }

  /**
   * Supprime DÉFINITIVEMENT une organisation sans données. Avec des données,
   * 422 `TENANT_HAS_DATA` (la réponse liste les tables) : on archive alors
   * via `PATCH { status: 'ARCHIVED' }`.
   *
   * Atomicité : le tenant est verrouillé (`FOR UPDATE`) avant l'inventaire.
   * La création concurrente d'un compte (clé étrangère `users → tenants`)
   * attend ce verrou puis échoue : impossible de supprimer « entre » une
   * vérification et une insertion.
   */
  public async remove(caller: { tenantId: string; userId: string }, id: string, confirmSlug: string | undefined) {
    const removed = await this.prisma.$privileged(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${id}::uuid FOR UPDATE`;
      const tenant = await tx.tenant.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, slug: true, name: true, status: true, defaultCountry: true, domains: { select: { domain: true } } },
      });
      if (!tenant) throw new ResourceNotFoundError('Organisation', id);

      const tables = await this.inventory.tablesWithTenantColumn(tx);
      const usage = await this.inventory.usage(tx, id, TenantLifecycleRules.businessTables(tables));
      TenantLifecycleRules.assertDeletable(caller.tenantId, tenant, confirmSlug, usage);

      await this.inventory.purge(tx, id, TenantLifecycleRules.purgeableTables(tables));
      await tx.tenant.delete({ where: { id } });

      // Trace dans le tenant de l'APPELANT : celui supprimé n'est plus consultable.
      await tx.auditLog.create({
        data: {
          tenantId: caller.tenantId,
          actorId: caller.userId,
          action: 'tenant.deleted',
          resourceType: 'Tenant',
          resourceId: id,
          before: {
            slug: tenant.slug,
            name: tenant.name,
            status: tenant.status,
            defaultCountry: tenant.defaultCountry,
          },
        },
      });
      return tenant;
    }, AdminTenantsService.LIFECYCLE_TX);

    // Sans invalidation, l'annuaire servirait encore le tenant supprimé pendant le TTL.
    await this.registry.invalidate(removed.id, removed.slug, removed.domains.map((d) => d.domain));
    return { id: removed.id, slug: removed.slug, deleted: true as const };
  }

  private present(row: TenantRow, callerTenantId: string) {
    const branding = (row.branding ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      legalName: row.legalName,
      status: row.status,
      isolation: row.isolation,
      defaultLocale: row.defaultLocale,
      defaultCountry: row.defaultCountry,
      defaultCurrency: row.defaultCurrency,
      timezone: row.timezone,
      branding: {
        primaryColor: typeof branding.primaryColor === 'string' ? branding.primaryColor : null,
        logoUrl: typeof branding.logoUrl === 'string' ? branding.logoUrl : null,
      },
      featureFlags: (row.featureFlags ?? {}) as Record<string, boolean>,
      domains: row.domains,
      userCount: row._count.users,
      /** Organisation de la session de l'appelant : ne peut pas être suspendue d'ici. */
      isCurrent: row.id === callerTenantId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
