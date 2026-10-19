import { fakeTenantPrisma } from '@shared/tests/test-utils/fake-tenant-prisma';
import type { Prisma } from '@prisma/client';
import type { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import { BasePrismaRepository } from '../persistence/repository/base.repository';
import { TransactionHost } from '../persistence/prisma/transaction-host.service';

class TestRepository extends BasePrismaRepository {
  constructor(tenantPrisma: TenantPrismaService) {
    super(tenantPrisma);
  }
  public expose() {
    return this.db;
  }
}

describe('BasePrismaRepository', () => {
  it('expose le client scopé du tenant courant', () => {
    const client = { activity: {} };
    const repository = new TestRepository(fakeTenantPrisma(client));
    expect(repository.expose()).toBe(client);
  });
});

describe('TransactionHost', () => {
  it('n’est pas en transaction par défaut', () => {
    const host = new TransactionHost();
    expect(host.isInTransaction).toBe(false);
    expect(host.current).toBeNull();
  });

  it('expose la transaction courante à l’intérieur de run()', async () => {
    const host = new TransactionHost();
    const tx = {} as Prisma.TransactionClient;
    await host.run(tx, async () => {
      expect(host.isInTransaction).toBe(true);
      expect(host.current).toBe(tx);
    });
  });

  it('ne fuit pas la transaction hors de run()', async () => {
    const host = new TransactionHost();
    await host.run({} as Prisma.TransactionClient, async () => undefined);
    expect(host.isInTransaction).toBe(false);
  });
});
