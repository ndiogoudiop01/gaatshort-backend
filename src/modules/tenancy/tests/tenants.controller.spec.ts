/* eslint-disable @typescript-eslint/unbound-method */
import { ValidationPipe, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, ROLES_KEY } from '@shared/decorators/permissions.decorator';
import { BusinessRuleViolationError, ResourceNotFoundError } from '@shared/kernel/errors/domain.error';
import type { TenantContextData } from '@shared/kernel/ports/tenant-context.port';
import type { AuthenticatedUser } from '@shared/kernel/types/authenticated-user';
import type { PrismaService } from '@infra/persistence/prisma/prisma.service';
import type { TenantRegistryService } from '@infra/tenancy/registry/tenant-registry.service';
import { AdminTenantsService } from '../application/admin-tenants.service';
import { TENANT_EDITABLE_FIELDS, TenantAdminRules } from '../domain/services/tenant-admin-rules';
import { ListTenantsDto, UpdateTenantDto } from '../presentation/http/dto/admin-tenant.dto';
import { TenantsController } from '../presentation/http/tenants.controller';

/** Même configuration que le `ValidationPipe` global (`main.ts`). */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
async function parse<T>(metatype: Type<T>, value: Record<string, unknown>, type: 'query' | 'body' = 'body') {
  return (await pipe.transform(value, { type, metatype })) as T;
}

const ID = '7d3c6c1e-2f0b-4d8e-9a55-1f2e3d4c5b6a';
const OTHER = '11111111-2f0b-4d8e-9a55-1f2e3d4c5b6a';
const SUPER = {
  id: 'super-1',
  tenantId: OTHER,
  email: null,
  roles: ['SUPER_ADMIN'],
  permissions: [],
  sessionId: 's',
} as AuthenticatedUser;

const ROW = {
  id: ID,
  slug: 'gaatshort',
  name: 'Gaatshort',
  legalName: null,
  status: 'ACTIVE',
  isolation: 'SHARED_RLS',
  schemaName: null,
  defaultLocale: 'fr',
  defaultCountry: 'SN',
  defaultCurrency: 'XOF',
  timezone: 'Africa/Dakar',
  branding: { primaryColor: '#0F5132', logoUrl: null, font: 'Inter' },
  featureFlags: { simulator: true, academy: false },
  settings: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  domains: [{ domain: 'kaay.gaatshort.com', isPrimary: true, verifiedAt: null }],
  _count: { users: 12 },
};

function setup(current: typeof ROW | null = ROW) {
  const tx = {
    tenant: {
      findMany: jest.fn(async () => [ROW]),
      count: jest.fn(async () => 1),
      findFirst: jest.fn(async () => current),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...ROW, ...data })),
    },
    country: {
      findFirst: jest.fn(async ({ where }: { where: { code: string } }) =>
        where.code === 'SN' || where.code === 'MA' ? { code: where.code } : null,
      ),
    },
    currency: {
      findUnique: jest.fn(async ({ where }: { where: { code: string } }) => (where.code === 'XOF' ? { code: 'XOF' } : null)),
    },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma = { $privileged: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;
  const invalidate = jest.fn(async () => undefined);
  const inventory = { tablesWithTenantColumn: jest.fn(), usage: jest.fn(), purge: jest.fn() };
  const service = new AdminTenantsService(prisma, { invalidate } as unknown as TenantRegistryService, inventory);
  return { tx, invalidate, service, controller: new TenantsController(service) };
}

describe('TenantsController — accès', () => {
  it('renvoie le contexte du tenant courant', () => {
    const tenant = { tenantId: 'tenant-1', slug: 'gaatshort' } as TenantContextData;
    expect(setup().controller.current(tenant)).toBe(tenant);
  });

  it('RÔLE SUPER_ADMIN sur toutes les routes d’administration — jamais tenant:manage', () => {
    const reflector = new Reflector();
    const proto = TenantsController.prototype;
    for (const handler of [proto.list, proto.detail, proto.update, proto.reference, proto.create, proto.deletionCheck, proto.remove]) {
      expect(reflector.get(ROLES_KEY, handler)).toEqual(['SUPER_ADMIN']);
      expect(reflector.get(PERMISSIONS_KEY, handler)).toBeUndefined();
    }
  });
});

describe('BSG-13 — DTO : liste blanche', () => {
  it('refuse tout champ hors liste, y compris dans branding', async () => {
    for (const forbidden of [
      { slug: 'pirate' },
      { isolation: 'SCHEMA' },
      { schemaName: 'public' },
      { deletedAt: null },
      { settings: {} },
      { id: ID },
      { domains: [] },
      { branding: { primaryColor: '#000000', script: '<x>' } },
    ]) {
      await expect(parse(UpdateTenantDto, forbidden)).rejects.toBeDefined();
    }
  });

  it('accepte les champs de la liste, formats vérifiés', async () => {
    await expect(
      parse(UpdateTenantDto, {
        name: ' Gaatshort ',
        legalName: '',
        status: 'SUSPENDED',
        defaultLocale: 'fr',
        defaultCountry: 'SN',
        defaultCurrency: 'XOF',
        timezone: 'Africa/Dakar',
        branding: { primaryColor: '#0F5132', logoUrl: 'https://cdn.test/logo.svg' },
        featureFlags: { simulator: false },
      }),
    ).resolves.toMatchObject({ name: 'Gaatshort', legalName: null });
    await expect(parse(UpdateTenantDto, { branding: { logoUrl: 'http://x.test/a.png' } })).rejects.toBeDefined();
    await expect(parse(UpdateTenantDto, { branding: { primaryColor: 'red' } })).rejects.toBeDefined();
    await expect(parse(UpdateTenantDto, { featureFlags: { simulator: 'yes' } })).rejects.toBeDefined();
    await expect(parse(UpdateTenantDto, { featureFlags: { 'drop table': true } })).rejects.toBeDefined();
    await expect(parse(UpdateTenantDto, { status: 'DELETED' })).rejects.toBeDefined();
  });

  it('liste : tri whitelisté, perPage ≤ 100', async () => {
    await expect(
      parse(ListTenantsDto, { sortBy: 'createdAt', statuses: 'ACTIVE,SUSPENDED' }, 'query'),
    ).resolves.toMatchObject({ statuses: ['ACTIVE', 'SUSPENDED'] });
    await expect(parse(ListTenantsDto, { sortBy: 'schemaName' }, 'query')).rejects.toBeDefined();
    await expect(parse(ListTenantsDto, { perPage: '101' }, 'query')).rejects.toBeDefined();
  });
});

describe('BSG-13 — règles', () => {
  it('toTenantUpdate : champ par champ, fusion de branding et featureFlags', () => {
    expect(TENANT_EDITABLE_FIELDS).not.toContain('slug');
    const data = TenantAdminRules.toTenantUpdate(ROW, {
      branding: { primaryColor: '#111111' },
      featureFlags: { academy: true },
    });
    expect(data).toEqual({
      branding: { primaryColor: '#111111', logoUrl: null, font: 'Inter' },
      featureFlags: { simulator: true, academy: true },
    });
    expect(TenantAdminRules.toTenantUpdate(ROW, {})).toEqual({});
  });

  it('interdit de suspendre ou archiver l’organisation de sa propre session', () => {
    expect(() => TenantAdminRules.assertNotSelfLockout(ID, ROW, { status: 'SUSPENDED' })).toThrow(
      expect.objectContaining({ code: 'TENANT_SELF_LOCKOUT' }),
    );
    expect(() => TenantAdminRules.assertNotSelfLockout(ID, ROW, { name: 'x' })).not.toThrow();
    expect(() => TenantAdminRules.assertNotSelfLockout(OTHER, ROW, { status: 'SUSPENDED' })).not.toThrow();
  });

  it('fuseaux horaires IANA', () => {
    expect(TenantAdminRules.isValidTimezone('Africa/Dakar')).toBe(true);
    expect(TenantAdminRules.isValidTimezone('UTC')).toBe(true);
    expect(TenantAdminRules.isValidTimezone('Mars/Olympus')).toBe(false);
  });
});

describe('BSG-13 — AdminTenantsService', () => {
  it('liste paginée via un accès privilégié, sans schemaName', async () => {
    const { service, tx } = setup();
    const page = await service.list(OTHER, { page: 1, perPage: 20, sortDir: 'asc' });
    expect(tx.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 20 }),
    );
    expect(page.meta).toMatchObject({ total: 1, page: 1 });
    expect(page.items[0]).not.toHaveProperty('schemaName');
    expect(page.items[0]).toMatchObject({ userCount: 12, isCurrent: false });
  });

  it('met à jour, trace dans le tenant modifié, puis invalide le cache de l’annuaire', async () => {
    const { controller, tx, invalidate } = setup();
    const dto = await parse(UpdateTenantDto, { name: 'Gaatshort SN', status: 'SUSPENDED' });
    await controller.update(ID, dto, SUPER);
    expect(tx.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID }, data: { name: 'Gaatshort SN', status: 'SUSPENDED' } }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: ID,
        actorId: 'super-1',
        action: 'tenant.updated',
        before: { name: 'Gaatshort', status: 'ACTIVE' },
      }),
    });
    expect(invalidate).toHaveBeenCalledWith(ID, 'gaatshort', ['kaay.gaatshort.com']);
  });

  it('refuse sa propre organisation, les références inconnues et le patch vide — rien n’est écrit', async () => {
    const { service, tx, invalidate } = setup();
    await expect(service.update({ tenantId: ID, userId: 'u' }, ID, { status: 'ARCHIVED' })).rejects.toMatchObject({
      code: 'TENANT_SELF_LOCKOUT',
    });
    await expect(service.update({ tenantId: OTHER, userId: 'u' }, ID, { defaultCurrency: 'EUR' })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
    await expect(
      service.update({ tenantId: OTHER, userId: 'u' }, ID, { timezone: 'Mars/Olympus' }),
    ).rejects.toMatchObject({ code: 'TENANT_INVALID' });
    await expect(service.update({ tenantId: OTHER, userId: 'u' }, ID, {})).rejects.toMatchObject({
      code: 'TENANT_PATCH_EMPTY',
    });
    expect(tx.tenant.update).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('404 neutre pour un tenant inconnu ou supprimé', async () => {
    const { service } = setup(null);
    await expect(service.detail(OTHER, ID)).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});
