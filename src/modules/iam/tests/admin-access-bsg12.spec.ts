/* eslint-disable @typescript-eslint/unbound-method */
import { ValidationPipe, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '@shared/decorators/permissions.decorator';
import { canReadApplication } from '@shared/kernel/access/application-scope';
import { canSeeCountry, effectiveCountryScope, restrictCountries } from '@shared/kernel/access/country-scope';
import { BusinessRuleViolationError, ForbiddenActionError, ResourceNotFoundError } from '@shared/kernel/errors/domain.error';
import type { UnitOfWorkPort } from '@shared/kernel/ports/unit-of-work.port';
import type { AuthenticatedUser } from '@shared/kernel/types/authenticated-user';
import type { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import { ManageAccessUseCase } from '../application/commands/manage-access.usecase';
import { AdminAccessQuery } from '../application/queries/admin-access.query';
import { AccessAdminRules, changedKeys, type Actor, type TargetUser } from '../domain/services/access-admin-rules';
import { AdminRolesController, AdminUsersController } from '../presentation/http/admin-access.controller';
import {
  CreateRoleDto,
  CreateUserDto,
  ListUsersDto,
  SetRolePermissionsDto,
  SetUserCountriesDto,
  UpdateUserDto,
} from '../presentation/http/dto/admin-access.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
async function parse<T>(metatype: Type<T>, value: Record<string, unknown>, type: 'query' | 'body' = 'body') {
  return (await pipe.transform(value, { type, metatype })) as T;
}

const ADMIN_PERMS = ['user:manage', 'pool:read', 'pool:export', 'application:read', 'application:read:any'];
const MANAGER_PERMS = ['application:read', 'application:read:assigned', 'pool:read'];

const ADMIN: Actor = { id: 'admin-1', roles: ['ADMIN'], permissions: ADMIN_PERMS, countries: ['SN'] };
const SUPER: Actor = { id: 'super-1', roles: ['SUPER_ADMIN'], permissions: [...ADMIN_PERMS, 'tenant:manage'], countries: null };

const role = (key: string, permissions: string[]) => ({ key, permissions });
const target = (overrides: Partial<TargetUser> = {}): TargetUser => ({
  id: 'u-1',
  countryCode: 'SN',
  allCountries: false,
  roles: [role('MANAGER', MANAGER_PERMS)],
  ...overrides,
});

// ── Kernel : périmètre pays ─────────────────────────────────────────────────

describe('BSG-12 — périmètre pays (kernel)', () => {
  it('null = tout voir ; liste = liste blanche ; donnée sans pays invisible si restreint', () => {
    expect(canSeeCountry(null, 'MA')).toBe(true);
    expect(canSeeCountry(['SN'], 'SN')).toBe(true);
    expect(canSeeCountry(['SN'], 'MA')).toBe(false);
    expect(canSeeCountry(['SN'], null)).toBe(false);
  });

  it('borne le filtre demandé : un pays hors périmètre donne une liste vide', () => {
    expect(restrictCountries(null)).toBeUndefined();
    expect(restrictCountries(null, ['MA'])).toEqual(['MA']);
    expect(restrictCountries(['SN'])).toEqual(['SN']);
    expect(restrictCountries(['SN'], ['MA'])).toEqual([]);
    expect(restrictCountries(['SN', 'MA'], ['MA'])).toEqual(['MA']);
  });

  it('périmètre scellé au jeton : SUPER_ADMIN et allCountries voient tout', () => {
    const base = { roles: ['MANAGER'], allCountries: false, countryCode: 'SN', countryScope: [] as string[] };
    expect(effectiveCountryScope(base)).toEqual(['SN']);
    expect(effectiveCountryScope({ ...base, countryScope: ['MA', 'SN'] })).toEqual(['MA', 'SN']);
    expect(effectiveCountryScope({ ...base, allCountries: true })).toBeNull();
    expect(effectiveCountryScope({ ...base, roles: ['SUPER_ADMIN'] })).toBeNull();
    expect(effectiveCountryScope({ ...base, countryCode: null })).toEqual([]);
  });

  it('un gestionnaire du Sénégal ne lit pas un dossier du Maroc, même avec read:any', () => {
    const user = {
      id: 'm-1',
      tenantId: 't',
      email: null,
      roles: ['ADMIN'],
      permissions: ['application:read:any'],
      sessionId: 's',
      countries: ['SN'],
    } as AuthenticatedUser;
    expect(canReadApplication(user, { userId: 'c', assignedToId: null, countryCode: 'SN' })).toBe(true);
    expect(canReadApplication(user, { userId: 'c', assignedToId: null, countryCode: 'MA' })).toBe(false);
    // Jeton sans revendication (émis avant BSG-12) : comportement d'avant.
    expect(canReadApplication({ ...user, countries: undefined }, { userId: 'c', assignedToId: null, countryCode: 'MA' })).toBe(true);
    // Le candidat lit toujours son propre dossier.
    expect(canReadApplication({ ...user, id: 'c' }, { userId: 'c', assignedToId: null, countryCode: 'MA' })).toBe(true);
  });
});

// ── Règles d'administration ─────────────────────────────────────────────────

describe('BSG-12 — AccessAdminRules', () => {
  it('changedKeys : ajouts et retraits', () => {
    expect(changedKeys(['a', 'b'], ['b', 'c'])).toEqual(['a', 'c']);
  });

  it('anti-escalade : on n’attribue pas un rôle plus puissant que soi', () => {
    expect(AccessAdminRules.canHandleRole(ADMIN, role('MANAGER', MANAGER_PERMS))).toBe(false); // read:assigned absent
    expect(AccessAdminRules.canHandleRole(ADMIN, role('VIEWER', ['pool:read']))).toBe(true);
    expect(AccessAdminRules.canHandleRole(ADMIN, role('SUPER_ADMIN', []))).toBe(false);
    expect(AccessAdminRules.canHandleRole(SUPER, role('SUPER_ADMIN', []))).toBe(true);
  });

  it('SELF_LOCKOUT : on ne se retire pas user:manage', () => {
    const self = target({ id: ADMIN.id, roles: [role('ADMIN', ADMIN_PERMS)] });
    expect(() => AccessAdminRules.assertRoleChange(ADMIN, self, [role('VIEWER', ['pool:read'])], 2)).toThrow(
      expect.objectContaining({ code: 'SELF_LOCKOUT' }),
    );
    expect(() => AccessAdminRules.assertStatusChange(ADMIN, self, 'SUSPENDED', 2)).toThrow(
      expect.objectContaining({ code: 'SELF_LOCKOUT' }),
    );
  });

  it('LAST_SUPER_ADMIN : la plateforme en garde toujours un', () => {
    const lastSuper = target({ id: 'other', roles: [role('SUPER_ADMIN', [])] });
    expect(() => AccessAdminRules.assertRoleChange(SUPER, lastSuper, [], 1)).toThrow(
      expect.objectContaining({ code: 'LAST_SUPER_ADMIN' }),
    );
    expect(() => AccessAdminRules.assertRoleChange(SUPER, lastSuper, [], 2)).not.toThrow();
  });

  it('un compte hors pays ou plus puissant ne s’administre pas', () => {
    expect(AccessAdminRules.manageBlocker(ADMIN, target({ countryCode: 'MA', roles: [] }))).toBe('OUT_OF_SCOPE');
    expect(AccessAdminRules.manageBlocker(ADMIN, target({ roles: [role('X', ['tenant:manage'])] }))).toBe('OUTRANKS');
    expect(AccessAdminRules.manageBlocker(ADMIN, target({ allCountries: true, roles: [] }))).toBe('OUTRANKS');
    expect(AccessAdminRules.manageBlocker(ADMIN, target({ roles: [role('V', ['pool:read'])] }))).toBeNull();
    expect(() => AccessAdminRules.assertCanManage(ADMIN, target({ countryCode: 'MA' }))).toThrow(ForbiddenActionError);
  });

  it('matrice : SUPER_ADMIN verrouillé, permission non détenue refusée, verrouillage de soi refusé', () => {
    expect(() => AccessAdminRules.assertRolePermissionsChange(SUPER, role('SUPER_ADMIN', []), ['pool:read'], [])).toThrow(
      expect.objectContaining({ code: 'ROLE_LOCKED' }),
    );
    expect(() =>
      AccessAdminRules.assertRolePermissionsChange(ADMIN, role('MANAGER', ['pool:read']), ['pool:read', 'tenant:manage'], []),
    ).toThrow(expect.objectContaining({ code: 'PERMISSION_NOT_GRANTABLE', details: expect.objectContaining({ permissions: ['tenant:manage'] }) }));
    expect(() =>
      AccessAdminRules.assertRolePermissionsChange(ADMIN, role('ADMIN', ADMIN_PERMS), ['pool:read'], [role('ADMIN', ['pool:read'])]),
    ).toThrow(expect.objectContaining({ code: 'SELF_LOCKOUT' }));
    expect(() =>
      AccessAdminRules.assertRolePermissionsChange(ADMIN, role('MANAGER', ['pool:read']), ['pool:read', 'pool:export'], [role('ADMIN', ADMIN_PERMS)]),
    ).not.toThrow();
  });

  it('périmètre pays : seul un SUPER_ADMIN l’élargit ; rattachement dans son propre périmètre', () => {
    expect(() => AccessAdminRules.assertCanEditCountryScope(ADMIN)).toThrow(ForbiddenActionError);
    expect(() => AccessAdminRules.assertCanEditCountryScope(SUPER)).not.toThrow();
    expect(() => AccessAdminRules.assertHomeCountry(ADMIN, 'MA')).toThrow(expect.objectContaining({ code: 'COUNTRY_OUT_OF_SCOPE' }));
    expect(() => AccessAdminRules.assertHomeCountry(ADMIN, 'SN')).not.toThrow();
    expect(() => AccessAdminRules.assertHomeCountry(SUPER, 'MA')).not.toThrow();
  });
});

// ── DTO et contrôleurs ──────────────────────────────────────────────────────

describe('BSG-12 — DTO', () => {
  it('liste : tri whitelisté, perPage ≤ 100', async () => {
    await expect(parse(ListUsersDto, { sortBy: 'lastLoginAt', roles: 'ADMIN,MANAGER' }, 'query')).resolves.toMatchObject({
      roles: ['ADMIN', 'MANAGER'],
    });
    await expect(parse(ListUsersDto, { sortBy: 'passwordHash' }, 'query')).rejects.toBeDefined();
    await expect(parse(ListUsersDto, { perPage: '101' }, 'query')).rejects.toBeDefined();
  });

  it('pas de mot de passe, pas de périmètre ni de tenant dans un profil', async () => {
    await expect(parse(CreateUserDto, { email: 'a@b.co', roleKeys: ['MANAGER'], password: 'x' })).rejects.toBeDefined();
    await expect(parse(UpdateUserDto, { allCountries: true })).rejects.toBeDefined();
    await expect(parse(UpdateUserDto, { tenantId: 'x' })).rejects.toBeDefined();
    await expect(parse(UpdateUserDto, { firstName: '  ', countryCode: 'SN' })).resolves.toEqual({ firstName: null, countryCode: 'SN' });
    await expect(parse(UpdateUserDto, { countryCode: 'sn' })).rejects.toBeDefined();
  });

  it('rôles et permissions : formats bornés', async () => {
    await expect(parse(CreateRoleDto, { key: 'regional_manager', name: 'Régional' })).resolves.toMatchObject({ key: 'REGIONAL_MANAGER' });
    await expect(parse(CreateRoleDto, { key: 'x', name: 'Régional' })).rejects.toBeDefined();
    await expect(parse(SetRolePermissionsDto, { permissionKeys: ['pool:read', 'DROP TABLE'] })).rejects.toBeDefined();
    await expect(parse(SetUserCountriesDto, { allCountries: false, countryScope: ['MA'] })).resolves.toBeDefined();
  });
});

describe('BSG-12 — contrôleurs', () => {
  it('user:manage sur CHAQUE route', () => {
    const reflector = new Reflector();
    const u = AdminUsersController.prototype;
    const r = AdminRolesController.prototype;
    const handlers = [u.list, u.countries, u.detail, u.create, u.update, u.roles, u.status, u.countriesOf, u.revoke,
      r.roles, r.permissions, r.create, r.update, r.setPermissions, r.remove];
    for (const handler of handlers) expect(reflector.get(PERMISSIONS_KEY, handler)).toEqual(['user:manage']);
  });

  it('l’acteur vient du JETON : son périmètre pays est transmis', async () => {
    const listUsers = jest.fn(async () => ({}));
    const controller = new AdminUsersController({ listUsers } as unknown as AdminAccessQuery, {} as ManageAccessUseCase);
    const q = await parse(ListUsersDto, {}, 'query');
    await controller.list(q, { id: 'a', tenantId: 't', email: null, roles: ['ADMIN'], permissions: ADMIN_PERMS, sessionId: 's', countries: ['SN'] });
    expect(listUsers).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', countries: ['SN'] }), expect.anything());
  });
});

// ── Use case ───────────────────────────────────────────────────────────────

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u-1',
    email: 'awa@a.test',
    phoneE164: null,
    firstName: 'Awa',
    lastName: 'Diop',
    status: 'ACTIVE',
    countryCode: 'SN',
    allCountries: false,
    countryScope: [],
    lastLoginAt: null,
    createdAt: new Date(),
    roles: [{ grantedAt: new Date(), role: { key: 'VIEWER', name: 'Lecteur', permissions: [{ permission: { key: 'pool:read' } }] } }],
    ...overrides,
  };
}

function setup(row = userRow()) {
  const client = {
    user: {
      findFirst: jest.fn(async () => row),
      update: jest.fn(async () => row),
      count: jest.fn(async () => 2),
    },
    role: {
      findMany: jest.fn(async ({ where }: { where: { key: { in: string[] } } }) =>
        where.key.in.map((key) => ({ id: `r-${key}`, tenantId: 't', key, permissions: [{ permission: { key: 'pool:read' } }] })),
      ),
    },
    userRole: { deleteMany: jest.fn(async () => ({})), createMany: jest.fn(async () => ({})) },
    authSession: { updateMany: jest.fn(async () => ({ count: 3 })), count: jest.fn(async () => 1) },
    tenantCountry: { findMany: jest.fn(async () => [{ countryCode: 'SN', isDefault: true }, { countryCode: 'MA', isDefault: false }]) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma = { client } as unknown as TenantPrismaService;
  const uow = { execute: jest.fn(async (work: () => Promise<unknown>) => work()) } as unknown as UnitOfWorkPort;
  const useCase = new ManageAccessUseCase(prisma, new AdminAccessQuery(prisma), uow);
  return { useCase, client };
}

describe('BSG-12 — ManageAccessUseCase', () => {
  it('remplace les rôles en transaction et trace avant / après', async () => {
    const { useCase, client } = setup();
    await useCase.setRoles(ADMIN, 'u-1', ['VIEWER']);
    expect(client.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u-1' } });
    expect(client.userRole.createMany).toHaveBeenCalled();
    expect(client.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'user.roles_changed', actorId: ADMIN.id, before: { roles: ['VIEWER'] } }),
    });
  });

  it('se retirer son accès d’administration : refusé, rien n’est écrit', async () => {
    const self = userRow({
      id: ADMIN.id,
      roles: [{ grantedAt: new Date(), role: { key: 'ADMIN', name: 'Admin', permissions: [{ permission: { key: 'user:manage' } }] } }],
    });
    const { useCase, client } = setup(self);
    await expect(useCase.setRoles(ADMIN, ADMIN.id, ['VIEWER'])).rejects.toMatchObject({ code: 'SELF_LOCKOUT' });
    expect(client.userRole.deleteMany).not.toHaveBeenCalled();
  });

  it('suspendre révoque toutes les sessions', async () => {
    const { useCase, client } = setup();
    await useCase.setStatus(ADMIN, 'u-1', 'SUSPENDED');
    expect(client.user.update).toHaveBeenCalledWith({ where: { id: 'u-1' }, data: { status: 'SUSPENDED' } });
    expect(client.authSession.updateMany).toHaveBeenCalledWith({ where: { userId: 'u-1', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
  });

  it('périmètre pays : réservé au SUPER_ADMIN, pays du tenant uniquement', async () => {
    const { useCase, client } = setup();
    await expect(useCase.setCountries(ADMIN, 'u-1', { allCountries: false, countryScope: ['MA'] })).rejects.toBeInstanceOf(ForbiddenActionError);
    await expect(useCase.setCountries(SUPER, 'u-1', { allCountries: false, countryScope: ['FR'] })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
    await useCase.setCountries(SUPER, 'u-1', { allCountries: false, countryScope: ['ma'] });
    expect(client.user.update).toHaveBeenLastCalledWith({ where: { id: 'u-1' }, data: { allCountries: false, countryScope: ['MA'] } });
  });

  it('compte hors périmètre pays de l’acteur : 404 neutre', async () => {
    const { useCase, client } = setup();
    client.user.findFirst.mockResolvedValueOnce(null as never);
    await expect(useCase.revokeSessions(ADMIN, 'u-ma')).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});
