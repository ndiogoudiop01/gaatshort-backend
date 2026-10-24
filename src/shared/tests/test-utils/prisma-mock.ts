import type { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';

type Op = jest.Mock;
export type ModelMock = Record<string, Op>;
export type ClientMock = Record<string, ModelMock> & { $queryRaw: Op; $executeRaw: Op };

/**
 * Faux client Prisma : chaque `client.<modèle>.<opération>` est un `jest.fn()`
 * créé à la demande. `transaction(run)` exécute `run` avec le même client, comme
 * le ferait une transaction réelle vue depuis le code applicatif.
 */
export function prismaMock(): { prisma: TenantPrismaService; client: ClientMock } {
  const models: Record<string, ModelMock> = {};
  const raw = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
  const client = new Proxy(raw as unknown as ClientMock, {
    get(target, prop: string) {
      if (prop in target) return (target as Record<string, unknown>)[prop];
      models[prop] ??= new Proxy<ModelMock>({}, {
        get(model: ModelMock, op: string): jest.Mock {
          model[op] ??= jest.fn();
          return model[op];
        },
      });
      return models[prop];
    },
  });
  const prisma = {
    client,
    transaction: jest.fn((run: (tx: unknown) => Promise<unknown>) => run(client)),
    runRawInTenantScope: jest.fn((run: (tx: unknown) => Promise<unknown>) => run(client)),
  } as unknown as TenantPrismaService;
  return { prisma, client };
}

export function tenantContext(overrides: Partial<{ tenantId: string; isFirstParty: boolean; defaultCountry: string; defaultLocale: string; slug: string; defaultCurrency: string }> = {}) {
  const data = {
    tenantId: 't-1', slug: 'gaatshort', isolation: 'SHARED_RLS' as const, defaultLocale: 'fr', defaultCountry: 'SN',
    defaultCurrency: 'XOF', timezone: 'Africa/Dakar', isFirstParty: true, featureFlags: {}, ...overrides,
  };
  return {
    get: () => data,
    getOrNull: () => data,
    get tenantId() { return data.tenantId; },
    runWith: jest.fn(),
    runPrivileged: jest.fn(),
    isPrivileged: () => false,
  };
}
