import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PaginatedResult } from '@shared/kernel/application/pagination';
import { effectiveCountryScope } from '@shared/kernel/access/country-scope';
import { ResourceNotFoundError } from '@shared/kernel/errors/domain.error';
import { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import {
  AccessAdminRules,
  LOCKED_ROLES,
  type Actor,
  type TargetUser,
} from '../../domain/services/access-admin-rules';

export const USER_SORT_FIELDS = ['createdAt', 'lastLoginAt', 'email', 'lastName'] as const;
export type UserSortField = (typeof USER_SORT_FIELDS)[number];
export const USER_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED'] as const;

/**
 * Prisma n'accepte `{ sort, nulls }` que sur les colonnes nullables :
 * `createdAt` (NOT NULL) exige un `SortOrder` simple.
 */
function userOrderBy(field: UserSortField, dir: 'asc' | 'desc'): Prisma.UserOrderByWithRelationInput {
  return field === 'createdAt' ? { createdAt: dir } : { [field]: { sort: dir, nulls: 'last' } };
}

export interface UserCriteria {
  readonly roles?: readonly string[];
  readonly statuses?: readonly string[];
  readonly search?: string;
  readonly countryCode?: string;
  readonly page: number;
  readonly perPage: number;
  readonly sortBy?: UserSortField;
  readonly sortDir: 'asc' | 'desc';
}

/** Jamais `passwordHash`, `metadata` ni les sessions : l'écran n'en a pas besoin. */
const USER_SELECT = {
  id: true,
  email: true,
  phoneE164: true,
  firstName: true,
  lastName: true,
  status: true,
  countryCode: true,
  allCountries: true,
  countryScope: true,
  lastLoginAt: true,
  createdAt: true,
  roles: {
    select: {
      grantedAt: true,
      role: { select: { key: true, name: true, permissions: { select: { permission: { select: { key: true } } } } } },
    },
  },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

export function toTarget(row: Pick<UserRow, 'id' | 'countryCode' | 'allCountries' | 'roles'>): TargetUser {
  return {
    id: row.id,
    countryCode: row.countryCode,
    allCountries: row.allCountries,
    roles: row.roles.map((ur) => ({ key: ur.role.key, permissions: ur.role.permissions.map((rp) => rp.permission.key) })),
  };
}

/**
 * BSG-12 — lectures de l'écran Utilisateurs, derrière `user:manage`.
 *
 * Tout ce qui décide de ce que l'écran PERMET est calculé ici (`manageable`,
 * `grantable`, `locked`), à partir des mêmes règles que les écritures : le
 * back-office affiche, il ne recalcule pas les droits.
 */
@Injectable()
export class AdminAccessQuery {
  constructor(private readonly prisma: TenantPrismaService) {}

  /** Périmètre de la LISTE : un acteur restreint ne voit que ses pays. */
  private scopeWhere(actor: Actor): Prisma.UserWhereInput {
    return actor.countries === null ? {} : { countryCode: { in: [...actor.countries] } };
  }

  public async listUsers(actor: Actor, criteria: UserCriteria) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...this.scopeWhere(actor),
      ...(criteria.statuses?.length ? { status: { in: [...criteria.statuses] as never } } : {}),
      ...(criteria.roles?.length ? { roles: { some: { role: { key: { in: [...criteria.roles] } } } } } : {}),
      ...(criteria.countryCode ? { AND: [{ countryCode: criteria.countryCode }] } : {}),
      ...(criteria.search
        ? {
            OR: [
              { email: { contains: criteria.search, mode: 'insensitive' } },
              { firstName: { contains: criteria.search, mode: 'insensitive' } },
              { lastName: { contains: criteria.search, mode: 'insensitive' } },
              { phoneE164: { contains: criteria.search } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: [userOrderBy(criteria.sortBy ?? 'createdAt', criteria.sortDir), { id: 'asc' }],
        skip: (criteria.page - 1) * criteria.perPage,
        take: criteria.perPage,
      }),
      this.prisma.client.user.count({ where }),
    ]);
    return PaginatedResult.offset(
      rows.map((row) => this.present(actor, row, false)),
      total,
      criteria.page,
      criteria.perPage,
    );
  }

  public async userDetail(actor: Actor, id: string) {
    const row = await this.findVisibleUser(actor, id);
    const activeSessions = await this.prisma.client.authSession.count({
      where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    return { ...this.present(actor, row, true), activeSessions };
  }

  /**
   * Un compte hors du périmètre pays de l'acteur est « introuvable » — la
   * même 404 qu'un identifiant inconnu ou d'un autre tenant.
   */
  public async findVisibleUser(actor: Actor, id: string): Promise<UserRow> {
    const row = await this.prisma.client.user.findFirst({
      where: { id, deletedAt: null, ...this.scopeWhere(actor) },
      select: USER_SELECT,
    });
    if (!row) throw new ResourceNotFoundError('Utilisateur', id);
    return row;
  }

  private present(actor: Actor, row: UserRow, withPermissions: boolean) {
    const target = toTarget(row);
    const blocker = AccessAdminRules.manageBlocker(actor, target);
    const isSuper = actor.roles.includes('SUPER_ADMIN');
    return {
      id: row.id,
      email: row.email,
      phoneE164: row.phoneE164,
      firstName: row.firstName,
      lastName: row.lastName,
      status: row.status,
      countryCode: row.countryCode,
      allCountries: row.allCountries,
      countryScope: row.countryScope ?? [],
      /** Pays effectivement visibles, tels qu'ils seront scellés au prochain jeton. */
      effectiveCountries: effectiveCountryScope({ ...target, roles: target.roles.map((r) => r.key), countryScope: row.countryScope ?? [] }),
      lastLoginAt: row.lastLoginAt,
      createdAt: row.createdAt,
      isSelf: row.id === actor.id,
      roles: row.roles.map((ur) => ({ key: ur.role.key, name: ur.role.name, grantedAt: ur.grantedAt })),
      ...(withPermissions
        ? { effectivePermissions: [...new Set(target.roles.flatMap((r) => r.permissions))].sort() }
        : {}),
      manageable: {
        canManage: blocker === null,
        reason: blocker,
        canEditCountries: isSuper,
      },
    };
  }

  public async listRoles(actor: Actor) {
    const roles = await this.prisma.client.role.findMany({
      include: {
        permissions: { select: { permission: { select: { key: true } } } },
        _count: { select: { users: true } },
      },
      orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
    });
    return roles.map((role) => {
      const permissions = role.permissions.map((rp) => rp.permission.key).sort();
      return {
        id: role.id,
        key: role.key,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        locked: LOCKED_ROLES.includes(role.key),
        userCount: role._count.users,
        permissions,
        /** L'acteur peut-il attribuer ce rôle à quelqu'un ? */
        assignable: AccessAdminRules.canHandleRole(actor, { key: role.key, permissions }),
        updatedAt: role.updatedAt,
      };
    });
  }

  /**
   * Catalogue des permissions RÉELLEMENT vérifiées par l'API. `grantable` :
   * l'acteur peut la cocher ou la décocher (il la possède lui-même).
   */
  public async permissionCatalog(actor: Actor) {
    const permissions = await this.prisma.client.permission.findMany({ orderBy: [{ resource: 'asc' }, { key: 'asc' }] });
    return permissions.map((p) => ({
      key: p.key,
      resource: p.resource,
      action: p.action,
      description: p.description,
      grantable: AccessAdminRules.grantable(actor, p.key),
    }));
  }

  /** Pays du tenant : les seuls qu'on peut rattacher ou accorder. */
  public async tenantCountries() {
    const rows = await this.prisma.client.tenantCountry.findMany({ orderBy: { countryCode: 'asc' } });
    return rows.map((r) => ({ countryCode: r.countryCode, isDefault: r.isDefault }));
  }
}
