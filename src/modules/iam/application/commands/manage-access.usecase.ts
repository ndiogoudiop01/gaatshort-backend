import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, type UnitOfWorkPort } from '@shared/kernel/ports/unit-of-work.port';
import { BusinessRuleViolationError, ResourceNotFoundError } from '@shared/kernel/errors/domain.error';
import { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import {
  AccessAdminRules,
  LOCKED_ROLES,
  SUPER_ADMIN,
  SYSTEM_ROLE_KEYS,
  type Actor,
  type RoleSnapshot,
} from '../../domain/services/access-admin-rules';
import { AdminAccessQuery, toTarget } from '../queries/admin-access.query';

export interface CreateUserInput {
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly phoneE164: string | null;
  readonly countryCode: string | null;
  readonly roleKeys: readonly string[];
}

export interface UpdateProfileInput {
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly phoneE164: string | null;
  readonly countryCode: string | null;
}


/**
 * BSG-12 — écritures de l'écran Utilisateurs.
 *
 * Rappel qui justifie le message affiché par le back-office : rôles,
 * permissions et périmètre pays sont FIGÉS dans le jeton d'accès. Rien de ce
 * qui suit ne change les droits d'une personne déjà connectée avant son
 * prochain jeton — sauf `revokeSessions`, qui la force à se reconnecter.
 *
 * Chaque écriture laisse une trace dans `audit_logs` (avant / après).
 */
@Injectable()
export class ManageAccessUseCase {
  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly query: AdminAccessQuery,
    // Transaction tenant-scopée : à l'intérieur, `prisma.client` est lié à la transaction.
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
  ) {}

  // ─────────────────────────── Comptes ───────────────────────────

  public async createUser(actor: Actor, input: CreateUserInput) {
    AccessAdminRules.assertHomeCountry(actor, input.countryCode);
    await this.assertKnownCountries(input.countryCode ? [input.countryCode] : []);
    const roles = await this.rolesByKeys(input.roleKeys);
    AccessAdminRules.assertRoleChange(actor, { id: '', countryCode: input.countryCode, allCountries: false, roles: [] }, roles, 2);

    const email = input.email.toLowerCase().trim();
    // Pas de mot de passe : la personne prouvera son identité par
    // `POST /auth/challenge` puis `/auth/verify` (lien ou code).
    const user = await this.prisma.client.user.create({
      data: {
        email,
        firstName: input.firstName,
        lastName: input.lastName,
        phoneE164: input.phoneE164,
        countryCode: input.countryCode,
        status: 'ACTIVE',
        roles: { create: roles.map((r) => ({ roleId: r.id, tenantId: this.tenantId(r), grantedBy: actor.id })) },
      } as never,
      select: { id: true },
    });
    await this.audit(actor, 'user.created', 'User', user.id, null, { email, roles: input.roleKeys, countryCode: input.countryCode });
    return this.query.userDetail(actor, user.id);
  }

  public async updateProfile(actor: Actor, id: string, input: UpdateProfileInput) {
    const row = await this.query.findVisibleUser(actor, id);
    AccessAdminRules.assertCanManage(actor, toTarget(row));
    if (input.countryCode !== row.countryCode) {
      AccessAdminRules.assertHomeCountry(actor, input.countryCode);
      await this.assertKnownCountries(input.countryCode ? [input.countryCode] : []);
    }
    await this.prisma.client.user.update({ where: { id }, data: { ...input } });
    await this.audit(actor, 'user.profile_updated', 'User', id, pick(row, ['firstName', 'lastName', 'phoneE164', 'countryCode']), input);
    return this.query.userDetail(actor, id);
  }

  public async setRoles(actor: Actor, id: string, roleKeys: readonly string[]) {
    const row = await this.query.findVisibleUser(actor, id);
    const target = toTarget(row);
    // Se modifier soi-même est permis (dans la limite des règles ci-dessous) ;
    // administrer quelqu'un de plus puissant ne l'est pas.
    if (row.id !== actor.id) AccessAdminRules.assertCanManage(actor, target);
    const next = await this.rolesByKeys(roleKeys);
    AccessAdminRules.assertRoleChange(actor, target, next, await this.superAdminCount());

    await this.uow.execute(async () => {
      await this.prisma.client.userRole.deleteMany({ where: { userId: id } });
      if (next.length) {
        await this.prisma.client.userRole.createMany({
          data: next.map((r) => ({ userId: id, roleId: r.id, tenantId: this.tenantId(r), grantedBy: actor.id })) as never,
        });
      }
    });
    await this.audit(actor, 'user.roles_changed', 'User', id, { roles: target.roles.map((r) => r.key) }, { roles: [...roleKeys] });
    return this.query.userDetail(actor, id);
  }

  public async setStatus(actor: Actor, id: string, status: 'ACTIVE' | 'SUSPENDED') {
    const row = await this.query.findVisibleUser(actor, id);
    const target = toTarget(row);
    AccessAdminRules.assertStatusChange(actor, target, status, await this.superAdminCount());
    AccessAdminRules.assertCanManage(actor, target);
    await this.prisma.client.user.update({ where: { id }, data: { status } });
    // Suspendre sans révoquer laisserait la personne travailler jusqu'à la
    // fin de ses sessions (30 jours de refresh token).
    if (status === 'SUSPENDED') await this.revokeAll(id);
    await this.audit(actor, 'user.status_changed', 'User', id, { status: row.status }, { status });
    return this.query.userDetail(actor, id);
  }

  public async setCountries(actor: Actor, id: string, input: { allCountries: boolean; countryScope: readonly string[] }) {
    AccessAdminRules.assertCanEditCountryScope(actor);
    const row = await this.query.findVisibleUser(actor, id);
    const countryScope = [...new Set(input.countryScope.map((c) => c.toUpperCase()))].sort();
    await this.assertKnownCountries(countryScope);
    await this.prisma.client.user.update({ where: { id }, data: { allCountries: input.allCountries, countryScope } });
    await this.audit(
      actor,
      'user.countries_changed',
      'User',
      id,
      { allCountries: row.allCountries, countryScope: row.countryScope },
      { allCountries: input.allCountries, countryScope },
    );
    return this.query.userDetail(actor, id);
  }

  /** Force la reconnexion : c'est le seul moyen d'appliquer un changement tout de suite. */
  public async revokeSessions(actor: Actor, id: string) {
    const row = await this.query.findVisibleUser(actor, id);
    if (row.id !== actor.id) AccessAdminRules.assertCanManage(actor, toTarget(row));
    const revoked = await this.revokeAll(id);
    await this.audit(actor, 'user.sessions_revoked', 'User', id, null, { revoked });
    return { revoked };
  }

  // ─────────────────────────── Rôles ───────────────────────────

  public async createRole(actor: Actor, input: { key: string; name: string; description: string | null; copyFrom?: string }) {
    const key = input.key.toUpperCase();
    if (SYSTEM_ROLE_KEYS.includes(key)) {
      throw new BusinessRuleViolationError('ROLE_KEY_RESERVED', `« ${key} » est un rôle système`, {
        issues: [`key: « ${key} » est réservé`],
      });
    }
    let permissions: string[] = [];
    if (input.copyFrom) {
      const source = await this.prisma.client.role.findFirst({
        where: { key: input.copyFrom },
        include: { permissions: { select: { permission: { select: { key: true } } } } },
      });
      if (!source) throw new ResourceNotFoundError('Rôle', input.copyFrom);
      permissions = source.permissions.map((rp) => rp.permission.key);
    }
    // Copier un rôle, c'est accorder ses permissions au nouveau : même règle.
    AccessAdminRules.assertRolePermissionsChange(actor, { key, permissions: [] }, permissions, []);
    const ids = await this.permissionIds(permissions);
    const role = await this.prisma.client.role.create({
      data: {
        key,
        name: input.name,
        description: input.description,
        isSystem: false,
        permissions: { create: ids.map((permissionId) => ({ permissionId })) },
      } as never,
      select: { id: true },
    });
    await this.audit(actor, 'role.created', 'Role', role.id, null, { key, name: input.name, permissions });
    return this.roleView(actor, role.id);
  }

  public async updateRole(actor: Actor, id: string, input: { name: string; description: string | null }) {
    const role = await this.findRole(id);
    await this.prisma.client.role.update({ where: { id }, data: { name: input.name, description: input.description } });
    await this.audit(actor, 'role.updated', 'Role', id, { name: role.name, description: role.description }, input);
    return this.roleView(actor, id);
  }

  public async setRolePermissions(actor: Actor, id: string, permissionKeys: readonly string[]) {
    const role = await this.findRole(id);
    const before = role.permissions.map((rp) => rp.permission.key);
    const next = [...new Set(permissionKeys)].sort();
    const ids = await this.permissionIds(next);

    // Rôles de l'acteur APRÈS la modification, lus en base (pas dans le jeton) :
    // c'est ce qu'il aura au prochain jeton qui décide du verrouillage.
    const actorRoles = await this.prisma.client.userRole.findMany({
      where: { userId: actor.id },
      include: { role: { include: { permissions: { select: { permission: { select: { key: true } } } } } } },
    });
    const actorRolesAfter: RoleSnapshot[] = actorRoles.map((ur) => ({
      key: ur.role.key,
      permissions: ur.role.id === id ? next : ur.role.permissions.map((rp) => rp.permission.key),
    }));
    AccessAdminRules.assertRolePermissionsChange(actor, { key: role.key, permissions: before }, next, actorRolesAfter);

    await this.uow.execute(async () => {
      await this.prisma.client.rolePermission.deleteMany({ where: { roleId: id } });
      if (ids.length) {
        await this.prisma.client.rolePermission.createMany({ data: ids.map((permissionId) => ({ roleId: id, permissionId })) });
      }
      await this.prisma.client.role.update({ where: { id }, data: { updatedAt: new Date() } });
    });
    await this.audit(actor, 'role.permissions_changed', 'Role', id, { permissions: before }, { permissions: next });
    return this.roleView(actor, id);
  }

  public async deleteRole(actor: Actor, id: string) {
    const role = await this.findRole(id);
    if (role.isSystem || LOCKED_ROLES.includes(role.key)) {
      throw new BusinessRuleViolationError('ROLE_LOCKED', 'Un rôle système ne se supprime pas', { issues: [`role: ${role.key}`] });
    }
    if (role._count.users > 0) {
      throw new BusinessRuleViolationError('ROLE_IN_USE', `Ce rôle est encore attribué à ${role._count.users} compte(s)`, {
        userCount: role._count.users,
        issues: [`role: ${role._count.users} compte(s) l'utilisent encore`],
      });
    }
    await this.prisma.client.role.delete({ where: { id } });
    await this.audit(actor, 'role.deleted', 'Role', id, { key: role.key }, null);
    return { id, deleted: true as const };
  }

  // ─────────────────────────── Outils ───────────────────────────

  private async roleView(actor: Actor, id: string) {
    const all = await this.query.listRoles(actor);
    const found = all.find((r) => r.id === id);
    if (!found) throw new ResourceNotFoundError('Rôle', id);
    return found;
  }

  private async findRole(id: string) {
    const role = await this.prisma.client.role.findFirst({
      where: { id },
      include: { permissions: { select: { permission: { select: { key: true } } } }, _count: { select: { users: true } } },
    });
    if (!role) throw new ResourceNotFoundError('Rôle', id);
    return role;
  }

  private async rolesByKeys(keys: readonly string[]) {
    const unique = [...new Set(keys)];
    const rows = await this.prisma.client.role.findMany({
      where: { key: { in: unique } },
      include: { permissions: { select: { permission: { select: { key: true } } } } },
    });
    const missing = unique.filter((k) => !rows.some((r) => r.key === k));
    if (missing.length) {
      throw new BusinessRuleViolationError('ROLE_UNKNOWN', 'Rôle inconnu', {
        issues: missing.map((k) => `roles: « ${k} » n'existe pas`),
      });
    }
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      key: r.key,
      permissions: r.permissions.map((rp) => rp.permission.key),
    }));
  }

  private async permissionIds(keys: readonly string[]): Promise<string[]> {
    const rows = await this.prisma.client.permission.findMany({ where: { key: { in: [...keys] } }, select: { id: true, key: true } });
    const missing = keys.filter((k) => !rows.some((r) => r.key === k));
    if (missing.length) {
      throw new BusinessRuleViolationError('PERMISSION_UNKNOWN', 'Permission inconnue', {
        issues: missing.map((k) => `permissions: « ${k} » n'existe pas`),
      });
    }
    return rows.map((r) => r.id);
  }

  private async assertKnownCountries(codes: readonly string[]): Promise<void> {
    if (!codes.length) return;
    const known = (await this.query.tenantCountries()).map((c) => c.countryCode);
    const unknown = codes.filter((c) => !known.includes(c));
    if (unknown.length) {
      throw new BusinessRuleViolationError('COUNTRY_UNKNOWN', "Pays non couvert par l'organisation", {
        issues: unknown.map((c) => `countries: « ${c} » n'est pas un pays du tenant`),
      });
    }
  }

  private superAdminCount(): Promise<number> {
    return this.prisma.client.user.count({
      where: { deletedAt: null, status: { not: 'SUSPENDED' }, roles: { some: { role: { key: SUPER_ADMIN } } } },
    });
  }

  private async revokeAll(userId: string): Promise<number> {
    const { count } = await this.prisma.client.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /** `user_roles.tenant_id` est obligatoire ; un rôle système partagé prend le tenant courant. */
  private tenantId(role: { tenantId: string | null }): string | undefined {
    return role.tenantId ?? undefined;
  }

  private async audit(actor: Actor, action: string, resourceType: string, resourceId: string, before: unknown, after: unknown) {
    await this.prisma.client.auditLog.create({
      data: {
        actorId: actor.id,
        action,
        resourceType,
        resourceId,
        before: (before ?? undefined) as never,
        after: (after ?? undefined) as never,
      } as never,
    });
  }
}

function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((k) => [k, source[k]])) as Pick<T, K>;
}
