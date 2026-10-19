import { MissingTenantContextError } from '@shared/kernel/errors/tenant.error';
import type { PrismaService } from '../persistence/prisma/prisma.service';
import { TenantContextService } from '../tenancy/context/tenant-context.service';
import type { TransactionHost } from '../persistence/prisma/transaction-host.service';
import { TenantPrismaService } from '../persistence/prisma/tenant-prisma.service';

interface AllOperationsParams {
  model: string;
  operation: string;
  args: Record<string, unknown>;
  query: (args: unknown) => Promise<unknown>;
}

function buildFakePrisma() {
  let handler!: (params: AllOperationsParams) => Promise<unknown>;
  const prisma = {
    $extends: (config: { query: { $allModels: { $allOperations: typeof handler } } }) => {
      handler = config.query.$allModels.$allOperations;
      return prisma;
    },
    $transaction: async (ops: unknown[]) => Promise.all(ops),
    $executeRaw: jest.fn(() => 'set_config_call'),
  };
  return { prisma: prisma as unknown as PrismaService, run: (params: AllOperationsParams) => handler(params) };
}

function build(tenantId = 'tenant-1', txCurrent: unknown = null) {
  const { prisma, run } = buildFakePrisma();
  const tenantContext = { tenantId } as unknown as TenantContextService;
  const txHost = { current: txCurrent } as unknown as TransactionHost;
  const service = new TenantPrismaService(prisma, tenantContext, txHost);
  return { service, run };
}

describe('TenantPrismaService', () => {
  it('échoue fermé : `client` hors de tout contexte tenant lève MissingTenantContextError', () => {
    // Critère d'acceptation : « un accès base sans contexte tenant lève
    // MissingTenantContextError (fail-closed) » — vérifié ici à la frontière
    // que tous les repositories utilisent, avec le vrai TenantContextService.
    const { prisma } = buildFakePrisma();
    const service = new TenantPrismaService(
      prisma,
      new TenantContextService(),
      { current: null } as unknown as TransactionHost,
    );
    expect(() => service.client).toThrow(MissingTenantContextError);
  });

  it('renvoie la transaction en cours plutôt qu’un nouveau client scopé', () => {
    const tx = { marker: 'tx' };
    const { service } = build('tenant-1', tx);
    expect(service.client).toBe(tx);
  });

  it('met en cache le client scopé pour un même tenant', () => {
    const { service } = build('tenant-1');
    expect(service.forTenant('tenant-1')).toBe(service.forTenant('tenant-1'));
  });

  it('laisse passer les modèles globaux sans injecter tenantId', async () => {
    const { service, run } = build('tenant-1');
    void service.client;
    const query = jest.fn(async (args: unknown) => args);
    await run({ model: 'Country', operation: 'findMany', args: { where: {} }, query });
    expect(query).toHaveBeenCalledWith({ where: {} });
  });

  it('injecte tenantId dans le where d’une lecture', async () => {
    const { service, run } = build('tenant-1');
    void service.client;
    const query = jest.fn(async (args: unknown) => args);
    await run({
      model: 'Application',
      operation: 'findMany',
      args: { where: { status: 'DRAFT' } },
      query,
    });
    expect(query).toHaveBeenCalledWith({ where: { status: 'DRAFT', tenantId: 'tenant-1' } });
  });

  it('injecte tenantId sur update/delete au même titre qu’une lecture', async () => {
    const { service, run } = build('tenant-1');
    void service.client;
    const query = jest.fn(async (args: unknown) => args);
    await run({ model: 'Application', operation: 'deleteMany', args: { where: {} }, query });
    expect(query).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1' } });
  });

  it('ne fait jamais confiance à un tenantId fourni par l’appelant', async () => {
    const { service, run } = build('tenant-1');
    void service.client;
    const query = jest.fn(async (args: unknown) => args);
    await run({
      model: 'Application',
      operation: 'findFirst',
      args: { where: { tenantId: 'tenant-hostile' } },
      query,
    });
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-1' }) }),
    );
  });

  it('injecte tenantId dans les données d’une création', async () => {
    const { service, run } = build('tenant-1');
    void service.client;
    const query = jest.fn(async (args: unknown) => args);
    await run({ model: 'Application', operation: 'create', args: { data: { reference: 'IG-1' } }, query });
    expect(query).toHaveBeenCalledWith({ data: { reference: 'IG-1', tenantId: 'tenant-1' } });
  });

  it('injecte tenantId dans chaque ligne d’une création en masse', async () => {
    const { service, run } = build('tenant-1');
    void service.client;
    const query = jest.fn(async (args: unknown) => args);
    await run({
      model: 'ConsentRecord',
      operation: 'createMany',
      args: { data: [{ key: 'a' }, { key: 'b' }] },
      query,
    });
    expect(query).toHaveBeenCalledWith({
      data: [
        { key: 'a', tenantId: 'tenant-1' },
        { key: 'b', tenantId: 'tenant-1' },
      ],
    });
  });

  it('estampille le `create` d’un upsert sans toucher au sélecteur `where`', async () => {
    const { service, run } = build('tenant-1');
    void service.client;
    const query = jest.fn(async (args: unknown) => args);
    await run({
      model: 'NewsletterSubscriber',
      operation: 'upsert',
      // Clé unique composite : y injecter tenantId au niveau racine donnerait
      // un sélecteur invalide. Le `where` doit passer intact.
      args: { where: { tenantId_email: { tenantId: 'tenant-1', email: 'x' } }, create: { email: 'x' }, update: {} },
      query,
    });
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_email: { tenantId: 'tenant-1', email: 'x' } },
        create: { email: 'x', tenantId: 'tenant-1' },
      }),
    );
  });
});
