import { ValidationPipe, type Type } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ResourceNotFoundError } from '@shared/kernel/errors/domain.error';
import type { AuthenticatedUser } from '@shared/kernel/types/authenticated-user';
import type { PrismaService } from '@infra/persistence/prisma/prisma.service';
import type { TenantRegistryService } from '@infra/tenancy/registry/tenant-registry.service';
import { AdminTenantsService } from '../application/admin-tenants.service';
import type { TenantDataInventoryPort } from '../domain/ports/tenant-data-inventory.port';
import {
  COUNTRY_DEFAULT_TIMEZONES,
  RESERVED_TENANT_SLUGS,
  TENANT_TECHNICAL_TABLES,
  TenantLifecycleRules,
  type TenantDataUsage,
} from '../domain/services/tenant-admin-rules';
import { PrismaTenantDataInventory } from '../infrastructure/persistence/tenant-data-inventory';
import { CreateTenantDto, DeleteTenantQueryDto } from '../presentation/http/dto/admin-tenant.dto';
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

const CALLER_TENANT = '11111111-2f0b-4d8e-9a55-1f2e3d4c5b6a';
const TARGET = '7d3c6c1e-2f0b-4d8e-9a55-1f2e3d4c5b6a';
const SUPER = {
  id: 'super-1',
  tenantId: CALLER_TENANT,
  email: null,
  roles: ['SUPER_ADMIN'],
  permissions: [],
  sessionId: 's',
} as AuthenticatedUser;

const COUNTRIES = [
  { code: 'CI', currencyCode: 'XOF', isActive: true },
  { code: 'BF', currencyCode: 'XOF', isActive: true },
  { code: 'MA', currencyCode: 'MAD', isActive: true },
  { code: 'ZZ', currencyCode: 'XOF', isActive: true },
];
const ALL_TABLES = ['applications', 'audit_logs', 'auth_challenges', 'idempotency_keys', 'outbox_messages', 'tenant_countries', 'tenant_domains', 'users'];

function rowFrom(data: Record<string, unknown>) {
  return {
    id: TARGET,
    isolation: 'SHARED_RLS',
    createdAt: new Date(),
    updatedAt: new Date(),
    domains: [],
    _count: { users: 0 },
    ...data,
  };
}

function setup(opts: { existingSlug?: boolean; target?: { id: string; slug: string } | null; usage?: TenantDataUsage[] } = {}) {
  const target = opts.target === undefined ? { id: TARGET, slug: 'kaay-cote-ivoire' } : opts.target;
  const tx = {
    $queryRaw: jest.fn(async () => []),
    tenant: {
      findUnique: jest.fn(async () => (opts.existingSlug ? { id: 'x' } : null)),
      findFirst: jest.fn(async () =>
        target
          ? { ...target, name: 'Gaatshort CI', status: 'ACTIVE', defaultCountry: 'CI', domains: [{ domain: 'ci.gaatshort.com' }] }
          : null,
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => rowFrom(data)),
      delete: jest.fn(async () => ({})),
    },
    tenantCountry: { createMany: jest.fn(async () => ({ count: 1 })) },
    country: {
      findMany: jest.fn(async ({ where }: { where: { code: { in: string[] } } }) =>
        COUNTRIES.filter((c) => where.code.in.includes(c.code)),
      ),
    },
    currency: {
      findUnique: jest.fn(async ({ where }: { where: { code: string } }) =>
        ['XOF', 'MAD'].includes(where.code) ? { code: where.code } : null,
      ),
    },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma = { $privileged: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;
  const invalidate = jest.fn(async () => undefined);
  const inventory = {
    tablesWithTenantColumn: jest.fn(async () => ALL_TABLES),
    usage: jest.fn(async () => opts.usage ?? []),
    purge: jest.fn(async () => undefined),
  } satisfies TenantDataInventoryPort;
  const service = new AdminTenantsService(prisma, { invalidate } as unknown as TenantRegistryService, inventory);
  return { tx, invalidate, inventory, service, controller: new TenantsController(service) };
}

describe('Tenants — DTO de création et de suppression', () => {
  it('normalise slug (minuscules) et codes pays (majuscules), refuse les champs d’infrastructure', async () => {
    await expect(
      parse(CreateTenantDto, { slug: ' Kaay-CI ', name: 'Gaatshort CI', defaultCountry: 'ci', countries: ['bf'] }),
    ).resolves.toMatchObject({ slug: 'kaay-ci', defaultCountry: 'CI', countries: ['BF'] });
    for (const forbidden of [{ isolation: 'SCHEMA' }, { schemaName: 'x' }, { id: TARGET }, { settings: {} }, { deletedAt: null }]) {
      await expect(parse(CreateTenantDto, { slug: 'kaay-ci', name: 'Gaatshort CI', defaultCountry: 'CI', ...forbidden })).rejects.toBeDefined();
    }
  });

  it('exige slug, nom et pays ; refuse un statut ARCHIVED à la création et les pays en double', async () => {
    await expect(parse(CreateTenantDto, { name: 'Gaatshort CI', defaultCountry: 'CI' })).rejects.toBeDefined();
    await expect(parse(CreateTenantDto, { slug: 'kaay-ci', defaultCountry: 'CI' })).rejects.toBeDefined();
    await expect(parse(CreateTenantDto, { slug: 'kaay-ci', name: 'Gaatshort CI' })).rejects.toBeDefined();
    await expect(
      parse(CreateTenantDto, { slug: 'kaay-ci', name: 'Gaatshort CI', defaultCountry: 'CI', status: 'ARCHIVED' }),
    ).rejects.toBeDefined();
    await expect(
      parse(CreateTenantDto, { slug: 'kaay-ci', name: 'Gaatshort CI', defaultCountry: 'CI', countries: ['BF', 'BF'] }),
    ).rejects.toBeDefined();
  });

  it('suppression : confirmation obligatoire', async () => {
    await expect(parse(DeleteTenantQueryDto, {}, 'query')).rejects.toBeDefined();
    await expect(parse(DeleteTenantQueryDto, { confirm: 'kaay-ci' }, 'query')).resolves.toMatchObject({ confirm: 'kaay-ci' });
  });
});

describe('Tenants — règles de cycle de vie', () => {
  it('slug : format sous-domaine, 3 à 63 caractères, mots réservés refusés', () => {
    for (const ok of ['abc', 'kaay-cote-ivoire', 'kaay-2', 'a'.repeat(63)]) {
      expect(() => TenantLifecycleRules.assertValidSlug(ok)).not.toThrow();
    }
    for (const ko of ['ab', '-kaay', 'kaay-', 'Gaatshort', 'gaatshort_ci', 'kaay--ci', 'a'.repeat(64), 'kaay.ci']) {
      expect(() => TenantLifecycleRules.assertValidSlug(ko)).toThrow(expect.objectContaining({ code: 'TENANT_INVALID' }));
    }
    for (const reserved of RESERVED_TENANT_SLUGS) {
      expect(() => TenantLifecycleRules.assertValidSlug(reserved)).toThrow(expect.objectContaining({ code: 'TENANT_INVALID' }));
    }
  });

  it('fuseau : explicite, sinon celui du pays, sinon erreur', () => {
    expect(TenantLifecycleRules.resolveTimezone({ defaultCountry: 'CI' })).toBe('Africa/Abidjan');
    expect(TenantLifecycleRules.resolveTimezone({ defaultCountry: 'CI', timezone: 'UTC' })).toBe('UTC');
    expect(() => TenantLifecycleRules.resolveTimezone({ defaultCountry: 'ZZ' })).toThrow(
      expect.objectContaining({ code: 'TENANT_INVALID' }),
    );
    expect(() => TenantLifecycleRules.resolveTimezone({ defaultCountry: 'CI', timezone: 'Mars/Olympus' })).toThrow(
      expect.objectContaining({ code: 'TENANT_INVALID' }),
    );
    // Tous les fuseaux par défaut sont des fuseaux IANA valides.
    for (const tz of Object.values(COUNTRY_DEFAULT_TIMEZONES)) {
      expect(TenantLifecycleRules.resolveTimezone({ defaultCountry: 'ZZ', timezone: tz })).toBe(tz);
    }
  });

  it('pays rattachés : pays par défaut en premier, sans doublon, 20 au plus', () => {
    expect(TenantLifecycleRules.countriesToAttach({ defaultCountry: 'CI', countries: ['BF', 'CI', 'ml'] })).toEqual(['CI', 'BF', 'ML']);
    const many = Array.from({ length: 20 }, (_, i) => `A${String.fromCharCode(65 + i)}`);
    expect(() => TenantLifecycleRules.countriesToAttach({ defaultCountry: 'CI', countries: many })).toThrow(
      expect.objectContaining({ code: 'TENANT_INVALID' }),
    );
  });

  it('tables techniques : ni bloquantes, ni oubliées ; tout le reste compte', () => {
    expect(TenantLifecycleRules.businessTables(ALL_TABLES)).toEqual(['applications', 'users']);
    expect(TenantLifecycleRules.purgeableTables(['audit_logs', 'tenant_countries', 'users'])).toEqual(['tenant_countries']);
    expect(TENANT_TECHNICAL_TABLES.keep).toContain('audit_logs');
    expect(TENANT_TECHNICAL_TABLES.purge).not.toContain('audit_logs');
  });

  it('suppression : jamais sa propre organisation, confirmation exacte, aucune donnée', () => {
    const tenant = { id: TARGET, slug: 'kaay-ci' };
    expect(() => TenantLifecycleRules.assertDeletable(TARGET, tenant, 'kaay-ci', [])).toThrow(
      expect.objectContaining({ code: 'TENANT_SELF_DELETE' }),
    );
    expect(() => TenantLifecycleRules.assertDeletable(CALLER_TENANT, tenant, 'Kaay-CI', [])).toThrow(
      expect.objectContaining({ code: 'TENANT_DELETE_CONFIRMATION' }),
    );
    expect(() =>
      TenantLifecycleRules.assertDeletable(CALLER_TENANT, tenant, 'kaay-ci', [{ table: 'users', rows: 2 }]),
    ).toThrow(
      expect.objectContaining({
        code: 'TENANT_HAS_DATA',
        details: expect.objectContaining({ tables: [{ table: 'users', rows: 2 }], issues: ['users: 2 ligne(s)'] }),
      }),
    );
    expect(() => TenantLifecycleRules.assertDeletable(CALLER_TENANT, tenant, 'kaay-ci', [])).not.toThrow();
  });
});

describe('Tenants — création (POST /admin/tenants)', () => {
  it('crée le tenant, rattache les pays, déduit devise et fuseau, trace et invalide', async () => {
    const { controller, tx, invalidate } = setup();
    const dto = await parse(CreateTenantDto, {
      slug: 'kaay-cote-ivoire',
      name: ' Gaatshort Côte d’Ivoire ',
      defaultCountry: 'CI',
      countries: ['BF'],
      featureFlags: { academy: true },
    });
    const result = await controller.create(dto, SUPER);

    expect(tx.tenant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          slug: 'kaay-cote-ivoire',
          name: 'Gaatshort Côte d’Ivoire',
          legalName: null,
          status: 'ACTIVE',
          defaultLocale: 'fr',
          defaultCountry: 'CI',
          defaultCurrency: 'XOF',
          timezone: 'Africa/Abidjan',
          branding: {},
          featureFlags: { academy: true },
        },
      }),
    );
    expect(tx.tenantCountry.createMany).toHaveBeenCalledWith({
      data: [
        { tenantId: TARGET, countryCode: 'CI', isDefault: true },
        { tenantId: TARGET, countryCode: 'BF', isDefault: false },
      ],
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: TARGET, actorId: 'super-1', action: 'tenant.created' }),
    });
    expect(invalidate).toHaveBeenCalledWith(TARGET, 'kaay-cote-ivoire');
    expect(result).toMatchObject({ slug: 'kaay-cote-ivoire', isCurrent: false, userCount: 0 });
    expect(result).not.toHaveProperty('schemaName');
  });

  it('refuse un slug déjà pris, un pays inactif ou une devise inconnue — rien n’est écrit', async () => {
    const taken = setup({ existingSlug: true });
    await expect(
      taken.service.create({ tenantId: CALLER_TENANT, userId: 'u' }, { slug: 'kaay-ci', name: 'X', defaultCountry: 'CI' }),
    ).rejects.toMatchObject({ code: 'TENANT_SLUG_TAKEN' });
    expect(taken.tx.tenant.create).not.toHaveBeenCalled();

    const { service, tx } = setup();
    await expect(
      service.create({ tenantId: CALLER_TENANT, userId: 'u' }, { slug: 'kaay-ci', name: 'X', defaultCountry: 'CI', countries: ['XX'] }),
    ).rejects.toMatchObject({ code: 'TENANT_INVALID', details: { issues: ["countries: « XX » n'est pas un pays actif"] } });
    await expect(
      service.create({ tenantId: CALLER_TENANT, userId: 'u' }, { slug: 'kaay-ci', name: 'X', defaultCountry: 'CI', defaultCurrency: 'USD' }),
    ).rejects.toMatchObject({ code: 'TENANT_INVALID' });
    await expect(
      service.create({ tenantId: CALLER_TENANT, userId: 'u' }, { slug: 'www', name: 'X', defaultCountry: 'CI' }),
    ).rejects.toMatchObject({ code: 'TENANT_INVALID' });
    expect(tx.tenant.create).not.toHaveBeenCalled();
    expect(tx.tenantCountry.createMany).not.toHaveBeenCalled();
  });
});

describe('Tenants — suppression (DELETE /admin/tenants/:id)', () => {
  it('supprime un tenant sans données : verrou, purge technique, trace chez l’appelant, invalidation', async () => {
    const { controller, tx, inventory, invalidate } = setup();
    const result = await controller.remove(TARGET, await parse(DeleteTenantQueryDto, { confirm: 'kaay-cote-ivoire' }, 'query'), SUPER);

    expect(tx.$queryRaw).toHaveBeenCalled(); // SELECT … FOR UPDATE
    expect(inventory.usage).toHaveBeenCalledWith(tx, TARGET, ['applications', 'users']);
    expect(inventory.purge).toHaveBeenCalledWith(tx, TARGET, [
      'tenant_countries',
      'tenant_domains',
      'idempotency_keys',
      'outbox_messages',
      'auth_challenges',
    ]);
    expect(tx.tenant.delete).toHaveBeenCalledWith({ where: { id: TARGET } });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: CALLER_TENANT, action: 'tenant.deleted', resourceId: TARGET }),
    });
    expect(invalidate).toHaveBeenCalledWith(TARGET, 'kaay-cote-ivoire', ['ci.gaatshort.com']);
    expect(result).toEqual({ id: TARGET, slug: 'kaay-cote-ivoire', deleted: true });
  });

  it('refuse un tenant qui a des données et n’écrit rien', async () => {
    const { service, tx, inventory, invalidate } = setup({ usage: [{ table: 'users', rows: 3 }] });
    await expect(
      service.remove({ tenantId: CALLER_TENANT, userId: 'u' }, TARGET, 'kaay-cote-ivoire'),
    ).rejects.toMatchObject({ code: 'TENANT_HAS_DATA' });
    expect(inventory.purge).not.toHaveBeenCalled();
    expect(tx.tenant.delete).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('refuse sa propre organisation et une mauvaise confirmation ; 404 pour un tenant inconnu', async () => {
    const own = setup({ target: { id: CALLER_TENANT, slug: 'gaatshort' } });
    await expect(own.service.remove({ tenantId: CALLER_TENANT, userId: 'u' }, CALLER_TENANT, 'gaatshort')).rejects.toMatchObject({
      code: 'TENANT_SELF_DELETE',
    });
    const { service, tx } = setup();
    await expect(service.remove({ tenantId: CALLER_TENANT, userId: 'u' }, TARGET, 'autre')).rejects.toMatchObject({
      code: 'TENANT_DELETE_CONFIRMATION',
    });
    expect(tx.tenant.delete).not.toHaveBeenCalled();
    const missing = setup({ target: null });
    await expect(missing.service.remove({ tenantId: CALLER_TENANT, userId: 'u' }, TARGET, 'x')).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });

  it('deletion-check : dit si la suppression est possible et ce qui bloque', async () => {
    const empty = setup();
    await expect(empty.controller.deletionCheck(TARGET, SUPER)).resolves.toEqual({
      id: TARGET,
      slug: 'kaay-cote-ivoire',
      deletable: true,
      isCurrent: false,
      blocking: [],
    });
    const used = setup({ usage: [{ table: 'applications', rows: 5 }] });
    await expect(used.service.deletionCheck(CALLER_TENANT, TARGET)).resolves.toMatchObject({
      deletable: false,
      blocking: [{ table: 'applications', rows: 5 }],
    });
    const own = setup({ target: { id: CALLER_TENANT, slug: 'gaatshort' } });
    await expect(own.service.deletionCheck(CALLER_TENANT, CALLER_TENANT)).resolves.toMatchObject({ deletable: false, isCurrent: true });
  });
});

describe('Tenants — inventaire SQL', () => {
  it('une requête UNION ALL, noms de table interpolés, identifiant du tenant en paramètre lié', () => {
    const query = PrismaTenantDataInventory.usageQuery(TARGET, ['users', 'applications']);
    expect(query.text).toContain('FROM "public"."users" WHERE tenant_id = $2::uuid');
    expect(query.text).toContain(' UNION ALL ');
    expect(query.text).not.toContain(TARGET);
    expect(query.values).toContain(TARGET);
  });

  it('ignore tout nom de table qui ne ressemble pas à un identifiant du catalogue', async () => {
    const tx = { $queryRaw: jest.fn(async () => []), $executeRaw: jest.fn(async () => 0) };
    const inventory = new PrismaTenantDataInventory();
    await expect(
      inventory.usage(tx as unknown as Prisma.TransactionClient, TARGET, ['users"; DROP TABLE users; --']),
    ).resolves.toEqual([]);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    await inventory.purge(tx as unknown as Prisma.TransactionClient, TARGET, ['Robert"); --', 'tenant_countries']);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
